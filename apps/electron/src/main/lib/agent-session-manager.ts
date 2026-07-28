/**
 * Agent 会话管理器
 *
 * 负责 Agent 会话的 CRUD 操作和消息持久化。
 * - 会话索引：~/.proma/agent-sessions.json（轻量元数据）
 * - 消息存储：~/.proma/agent-sessions/{id}.jsonl（JSONL 格式，逐行追加）
 *
 * 照搬 conversation-manager.ts 的模式。
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { writeJsonFileAtomic, writeTextFileAtomic, readJsonFileSafe } from './safe-file'
import { randomUUID } from 'node:crypto'
import { rmSyncWithRetry, renameWithRetry } from './fs-retry'
import { join } from 'node:path'
import {
  getAgentSessionsIndexPath,
  getAgentSessionsDir,
  getAgentSessionMessagesPath,
  getAgentSessionAttachmentsDir,
  resolveAgentSessionAttachmentsDir,
  getConfigDir,
} from './config-paths'
import { getAgentWorkspace, getWorkspaceAutoMemoryDir } from './agent-workspace-manager'
import { getSettings } from './settings-service'
import { applyClaudeSdkAttributionSettings, isGitAttributionEnabled } from './agent-git-attribution'
import type {
  AgentSessionMeta,
  AgentMessage,
  SDKMessage,
  ForkSessionInput,
  AgentMessageSearchResult,
  AgentSessionReferenceSearchInput,
  AgentSessionReferenceSearchResult,
  AgentRuntimeSessionSummary,
} from '@proma/shared'
import { migratePermissionMode } from '@proma/shared'
import { getConversationMessages } from './conversation-manager'
// 旧格式 → SDKMessage 的转换逻辑下沉到 @proma/session-core 作为唯一真源，避免主进程与渲染层各存一份。
import { convertLegacyMessage } from '@proma/session-core'
import { clearNanoBananaAgentHistory } from './chat-tools/nano-banana-mcp'
import { assertEnabledModelForChannel } from './agent-model-selection'
import { copyForkWorkspaceFiles } from './agent-fork-workspace-copy'
import { promaBuiltinMcpHttpHost } from './builtin-mcp/http-host'

/**
 * 会话索引文件格式
 */
interface AgentSessionsIndex {
  /** 配置版本号 */
  version: number
  /** 会话元数据列表 */
  sessions: AgentSessionMeta[]
}

/** 当前索引版本 */
const INDEX_VERSION = 2

function createEmptyIndex(): AgentSessionsIndex {
  return {
    version: INDEX_VERSION,
    sessions: [],
  }
}

/**
 * 项目尚未上线时不迁移 Claude SDK/Pi 开发期 Session。
 * 发现旧 Schema 后将索引、消息与旧 SDK 配置非破坏性移动到时间戳目录。
 */
function archiveLegacyAgentData(indexPath: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archiveDir = join(getConfigDir(), 'legacy-agent-data', timestamp)
  mkdirSync(archiveDir, { recursive: true })
  const candidates = [
    { source: indexPath, name: 'agent-sessions.json' },
    { source: join(getConfigDir(), 'agent-sessions'), name: 'agent-sessions' },
    { source: join(getConfigDir(), 'sdk-config'), name: 'sdk-config' },
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate.source)) continue
    renameWithRetry(candidate.source, join(archiveDir, candidate.name))
  }
  console.log(`[Agent 会话] 已备份旧 Runtime 开发数据: ${archiveDir}`)
}

/**
 * 会话引用最大返回数。
 *
 * 无搜索词时只返回索引中的轻量元数据，200 条可以显著扩大可选范围，
 * 同时避免极端会话数量下向渲染进程传输过大列表。
 */
const MAX_SESSION_REFERENCE_LIMIT = 200

interface JsonlParseError {
  lineNumber: number
  message: string
}

/**
 * 逐行解析 JSONL，调用方按业务场景决定容错或严格失败。
 */
function parseJsonlLines<T>(lines: string[]): { records: T[]; errors: JsonlParseError[] } {
  const records: T[] = []
  const errors: JsonlParseError[] = []
  for (let i = 0; i < lines.length; i++) {
    try {
      records.push(JSON.parse(lines[i]!) as T)
    } catch (err) {
      errors.push({
        lineNumber: i + 1,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { records, errors }
}

/**
 * 展示/检索类读取：跳过损坏行，保留其它可读消息。
 */
function parseJsonlLenient<T>(lines: string[], context: string): T[] {
  const { records, errors } = parseJsonlLines<T>(lines)
  for (const error of errors) {
    console.warn(`[Agent 会话] ${context} — JSONL 第 ${error.lineNumber} 行解析失败，已跳过:`, error.message)
  }
  return records
}

/**
 * 回退/文件恢复类读取：任何损坏行都可能破坏消息顺序或快照完整性，必须停止。
 */
function parseJsonlStrict<T>(lines: string[], context: string): T[] {
  const { records, errors } = parseJsonlLines<T>(lines)
  if (errors.length > 0) {
    const first = errors[0]!
    throw new Error(`${context} 失败：JSONL 第 ${first.lineNumber} 行解析失败: ${first.message}`)
  }
  return records
}

function normalizePersistedSDKMessage(parsed: unknown): SDKMessage {
  // 旧格式检测：AgentMessage 有 `role` 字段，SDKMessage 有 `type` 字段
  if (parsed && typeof parsed === 'object' && 'role' in parsed && !('type' in parsed)) {
    return convertLegacyMessage(parsed as AgentMessage)
  }
  return parsed as SDKMessage
}

function migrateLegacyPermissionMode(index: AgentSessionsIndex): boolean {
  let changed = false
  for (const session of index.sessions) {
    const rawMode = session.permissionMode as string | undefined
    if (!rawMode) continue
    const nextMode = migratePermissionMode(rawMode)
    if (nextMode !== rawMode) {
      session.permissionMode = nextMode
      changed = true
    }
  }
  return changed
}

/**
 * 读取会话索引文件
 */
function readIndex(): AgentSessionsIndex {
  const indexPath = getAgentSessionsIndexPath()
  const data = readJsonFileSafe<AgentSessionsIndex>(indexPath)
  if (data) {
    if (data.version !== INDEX_VERSION) {
      archiveLegacyAgentData(indexPath)
      const fresh = createEmptyIndex()
      writeIndex(fresh)
      return fresh
    }
    const permissionModeMigrated = migrateLegacyPermissionMode(data)
    if (permissionModeMigrated) {
      writeIndex(data)
      console.log('[Agent 会话] 已迁移历史权限模式 auto → bypassPermissions')
    }
    return data
  }
  return createEmptyIndex()
}

/**
 * 写入会话索引文件
 */
function writeIndex(index: AgentSessionsIndex): void {
  const indexPath = getAgentSessionsIndexPath()

  try {
    writeJsonFileAtomic(indexPath, index)
  } catch (error) {
    console.error('[Agent 会话] 写入索引文件失败:', error)
    throw new Error('写入 Agent 会话索引失败')
  }
}

/**
 * 获取所有会话（按 updatedAt 降序）
 */
export function listAgentSessions(): AgentSessionMeta[] {
  const index = readIndex()
  return index.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 将 CCB Transcript 目录同步为 Proma UI 投影。
 *
 * CCB runtimeSessionId 是执行上下文真源；Proma 索引仅保留置顶、归档、
 * Channel、Workspace 等桌面展示字段。
 */
export function syncRuntimeSessionCatalog(
  workspaceId: string,
  runtimeSessions: AgentRuntimeSessionSummary[],
): AgentSessionMeta[] {
  const index = readIndex()
  const runtimeSessionIds = new Set(
    runtimeSessions.map(session => session.runtimeSessionId),
  )
  const removedSessions = index.sessions.filter(
    session =>
      session.workspaceId === workspaceId
      && Boolean(session.runtimeSessionId)
      && !runtimeSessionIds.has(session.runtimeSessionId!),
  )
  if (removedSessions.length > 0) {
    const removedIds = new Set(removedSessions.map(session => session.id))
    index.sessions = index.sessions.filter(
      session => !removedIds.has(session.id),
    )
  }
  let changed = false
  for (const runtimeSession of runtimeSessions) {
    const existing = index.sessions.find(
      session => session.runtimeSessionId === runtimeSession.runtimeSessionId,
    )
    if (existing) {
      const nextTitle = runtimeSession.title || runtimeSession.summary
      if (
        existing.workspaceId !== workspaceId
        || existing.title !== nextTitle
        || existing.updatedAt !== runtimeSession.updatedAt
      ) {
        existing.workspaceId = workspaceId
        existing.title = nextTitle
        existing.updatedAt = runtimeSession.updatedAt
        changed = true
      }
      continue
    }
    const now = runtimeSession.createdAt ?? runtimeSession.updatedAt
    index.sessions.push({
      id: index.sessions.some(session => session.id === runtimeSession.runtimeSessionId)
        ? randomUUID()
        : runtimeSession.runtimeSessionId,
      runtimeSessionId: runtimeSession.runtimeSessionId,
      title: runtimeSession.title || runtimeSession.summary,
      workspaceId,
      createdAt: now,
      updatedAt: runtimeSession.updatedAt,
      runtimeWorkerState: 'cold',
    })
    changed = true
  }
  if (removedSessions.length > 0) changed = true
  if (changed) writeIndex(index)
  for (const removed of removedSessions) {
    cleanupAgentSessionProjectionFiles(removed.id)
    console.log(
      `[Agent 会话] CCB Transcript 已不存在，移除桌面投影: ${removed.title} (${removed.id})`,
    )
  }
  return index.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 获取单个会话的元数据
 */
export function getAgentSessionMeta(id: string): AgentSessionMeta | undefined {
  const index = readIndex()
  return index.sessions.find((s) => s.id === id)
}

/**
 * 创建新会话
 */
export function createAgentSession(
  title?: string,
  channelId?: string,
  workspaceId?: string,
  modelId?: string,
): AgentSessionMeta {
  const index = readIndex()
  const now = Date.now()

  const meta: AgentSessionMeta = {
    id: randomUUID(),
    title: title || '新 Agent 会话',
    channelId,
    modelId,
    workspaceId,
    createdAt: now,
    updatedAt: now,
  }

  index.sessions.push(meta)
  writeIndex(index)

  // 确保消息目录存在
  getAgentSessionsDir()

  // v3 项目模型下，Agent cwd 直接使用用户选择的本机项目目录。
  // 不再为每个会话创建独立工作目录，也不向用户项目写入 .claude 配置。

  console.log(`[Agent 会话] 已创建会话: ${meta.title} (${meta.id})`)
  return meta
}

/**
 * 读取会话的所有消息
 */
export function getAgentSessionMessages(id: string): AgentMessage[] {
  const filePath = getAgentSessionMessagesPath(id)

  if (!existsSync(filePath)) {
    return []
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter((line) => line.trim())
    return parseJsonlLenient<AgentMessage>(lines, `读取会话消息 (${id})`)
  } catch (error) {
    console.error(`[Agent 会话] 读取消息失败 (${id}):`, error)
    return []
  }
}

/**
 * 追加一条消息到会话的 JSONL 文件
 */
export function appendAgentMessage(id: string, message: AgentMessage): void {
  const filePath = getAgentSessionMessagesPath(id)

  try {
    const line = JSON.stringify(message) + '\n'
    appendFileSync(filePath, line, 'utf-8')

    // 追加消息时更新 updatedAt，若已归档则自动恢复活跃
    const index = readIndex()
    const idx = index.sessions.findIndex((s) => s.id === id)
    if (idx !== -1) {
      const session = index.sessions[idx]!
      session.updatedAt = Date.now()
      if (session.archived) session.archived = false
      writeIndex(index)
    }
  } catch (error) {
    console.error(`[Agent 会话] 追加消息失败 (${id}):`, error)
    throw new Error('追加 Agent 消息失败')
  }
}

/** 单条 SDKMessage 序列化后最大长度（UTF-16 code units，超出则截断内容） */
const MAX_SDK_MESSAGE_LENGTH = 256 * 1024 // ~256K chars
/** 截断后保留的预览文本长度 */
const TRUNCATED_PREVIEW_LENGTH = 2000

/**
 * 追加 SDKMessage 到会话的 JSONL 文件（Phase 4 新持久化格式）
 *
 * 每条 SDKMessage 单独一行 JSON。读取时通过 `type` 字段区分新旧格式。
 * 超过 256K chars 的消息会被自动截断以防止存储膨胀。
 */
export function appendSDKMessages(id: string, messages: SDKMessage[]): void {
  if (messages.length === 0) return

  const filePath = getAgentSessionMessagesPath(id)

  try {
    for (const message of messages) {
      appendFileSync(filePath, serializeSDKMessageForStorage(message) + '\n', 'utf-8')
    }
  } catch (error) {
    console.error(`[Agent 会话] 追加 SDKMessage 失败 (${id}):`, error)
    throw new Error('追加 SDKMessage 失败')
  }
}

/**
 * 截断超大 SDKMessage 的内容，保留元数据结构。
 * 处理三类膨胀源：超长 text block、超大 tool_result、内嵌 base64 图片。
 */
function sanitizeOversizedMessage(msg: SDKMessage, originalLength: number): SDKMessage {
  const truncationNote = `\n[内容已截断: 原始 ${(originalLength / 1024).toFixed(0)}K chars 超出存储限制]`
  const truncationThreshold = MAX_SDK_MESSAGE_LENGTH / 2

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clone: any = JSON.parse(JSON.stringify(msg))
  const content = clone.message?.content
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) {
      const block = content[i]
      if (!block || typeof block !== 'object') continue

      // 截断超长 text block
      if (block.type === 'text' && typeof block.text === 'string' && block.text.length > truncationThreshold) {
        block.text = block.text.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
      }

      // 截断超大 tool_result
      if (block.type === 'tool_result') {
        if (typeof block.content === 'string' && block.content.length > truncationThreshold) {
          block.content = block.content.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
        }
        // 剥离 base64 图片数据
        if (Array.isArray(block.content)) {
          block.content = block.content.map((item: Record<string, unknown>) => {
            if (item?.type === 'image' && (item.source as Record<string, unknown>)?.data) {
              const dataLen = String((item.source as Record<string, unknown>).data).length
              return { type: 'image', _truncated: true, _originalLength: dataLen }
            }
            return item
          })
        }
      }
    }
  }

  // 截断 error.message
  if (clone.error && typeof clone.error === 'object' && typeof clone.error.message === 'string' && clone.error.message.length > truncationThreshold) {
    clone.error.message = clone.error.message.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
  }

  return clone as SDKMessage
}

/**
 * 读取会话的所有 SDKMessage（兼容旧 AgentMessage 格式）
 *
 * 旧格式（有 `role` 字段）会被转换为近似的 SDKMessage。
 * 新格式（有 `type` 字段）直接返回。
 */
export function getAgentSessionSDKMessages(id: string): SDKMessage[] {
  const filePath = getAgentSessionMessagesPath(id)

  if (!existsSync(filePath)) {
    return []
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter((line) => line.trim())
    return parseJsonlLenient<unknown>(lines, `读取 SDKMessage (${id})`).map(normalizePersistedSDKMessage)
  } catch (error) {
    console.error(`[Agent 会话] 读取 SDKMessage 失败 (${id}):`, error)
    return []
  }
}

/** 使用 CCB Transcript 重建 Proma JSONL UI 投影。 */
export function replaceAgentSessionSDKMessages(
  id: string,
  messages: SDKMessage[],
): void {
  const filePath = getAgentSessionMessagesPath(id)
  const content = messages.length > 0
    ? `${messages.map(message => serializeSDKMessageForStorage(message)).join('\n')}\n`
    : ''
  writeTextFileAtomic(filePath, content)
}

/**
 * convertLegacyMessage 已迁移至 @proma/session-core（本文件从该包 import 使用）。
 */

/**
 * 更新会话元数据
 */
export function updateAgentSessionMeta(
  id: string,
  updates: Partial<Pick<AgentSessionMeta, 'title' | 'channelId' | 'modelId' | 'runtimeSessionId' | 'runtimeVersion' | 'runtimeArtifactCommit' | 'runtimeProtocolVersion' | 'runtimeLastSequence' | 'runtimeWorkerState' | 'workspaceId' | 'pinned' | 'starred' | 'archived' | 'attachedDirectories' | 'attachedFiles' | 'resumeAtMessageUuid' | 'stoppedByUser' | 'permissionMode' | 'completedButUnconfirmed' | 'sourceAutomationId' | 'automationGraduated' | 'parentSessionId' | 'rootSessionId' | 'sourceDelegationId' | 'delegationRole' | 'delegationStatus' | 'delegationDepth' | 'delegationGoal'>>,
): AgentSessionMeta {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === id)

  if (idx === -1) {
    throw new Error(`Agent 会话不存在: ${id}`)
  }

  const existing = index.sessions[idx]!
  const updateKeys = Object.keys(updates)
  // 星标只是侧栏的视觉标记，不应改变会话的新鲜度或归档状态。
  const isStarredOnly = updateKeys.every((key) => key === 'starred')
  // 非手动归档操作时，若会话已归档则自动恢复为活跃（仅更新 stoppedByUser 或 starred 不触发解归档）
  const isStoppedByUserOnly = updateKeys.every((key) => key === 'stoppedByUser')
  const autoUnarchive = existing.archived && !('archived' in updates) && !isStoppedByUserOnly && !isStarredOnly
  const updated: AgentSessionMeta = {
    ...existing,
    ...updates,
    ...(autoUnarchive ? { archived: false } : {}),
    updatedAt: isStarredOnly ? existing.updatedAt : Date.now(),
  }

  index.sessions[idx] = updated
  writeIndex(index)

  console.log(`[Agent 会话] 已更新会话: ${updated.title} (${updated.id})`)
  return updated
}

/**
 * 删除会话
 */
function cleanupAgentSessionProjectionFiles(id: string): void {
  // 删除消息文件
  const filePath = getAgentSessionMessagesPath(id)
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath)
    } catch (error) {
      console.warn(`[Agent 会话] 删除消息文件失败 (${id}):`, error)
    }
  }

  // 清理 Proma 私有附件；用户项目目录永远不由会话删除逻辑处理。
  try {
    const attachmentsDir = resolveAgentSessionAttachmentsDir(id)
    if (existsSync(attachmentsDir)) {
      rmSyncWithRetry(attachmentsDir, { recursive: true, force: true })
      console.log(`[Agent 会话] 已清理 session 附件目录: ${attachmentsDir}`)
    }
  } catch (error) {
    console.warn(`[Agent 会话] 清理 session 附件目录失败 (${id}):`, error)
  }

  // 清理 Nano Banana 生图历史
  clearNanoBananaAgentHistory(id)
  void promaBuiltinMcpHttpHost.releaseSession(id)
}

export function deleteAgentSession(id: string): void {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === id)

  if (idx === -1) {
    console.warn(`[Agent 会话] 会话不存在，跳过删除: ${id}`)
    return
  }

  const removed = index.sessions.splice(idx, 1)[0]!
  writeIndex(index)
  cleanupAgentSessionProjectionFiles(id)
  console.log(`[Agent 会话] 已删除会话: ${removed.title} (${removed.id})`)
}

/**
 * 收集会话及其全部委派子会话。
 */
function collectSessionTreeIds(sessions: AgentSessionMeta[], sessionId: string): Set<string> {
  const ids = new Set<string>([sessionId])
  let changed = true

  while (changed) {
    changed = false
    for (const session of sessions) {
      if (ids.has(session.id)) continue
      // 仅收集协作委派子会话。parent/root 负责维护树结构，sourceDelegationId 负责限定来源。
      if (!session.sourceDelegationId) continue
      if (session.parentSessionId && ids.has(session.parentSessionId)) {
        ids.add(session.id)
        changed = true
        continue
      }
      if (session.rootSessionId === sessionId) {
        ids.add(session.id)
        changed = true
      }
    }
  }

  return ids
}

/**
 * 迁移 Agent 会话到另一个工作区
 *
 * 操作步骤：
 * 1. 验证会话和目标工作区存在
 * 2. 收集目标会话及其委派子会话
 * 3. 更新元数据（workspaceId + 清空 Runtime Session 映射）
 * 5. JSONL 消息文件保持原位（全局目录）
 */
export function moveSessionToWorkspace(sessionId: string, targetWorkspaceId: string): AgentSessionMeta {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) {
    throw new Error(`Agent 会话不存在: ${sessionId}`)
  }

  const session = index.sessions[idx]!

  const targetWs = getAgentWorkspace(targetWorkspaceId)
  if (!targetWs) {
    throw new Error(`目标工作区不存在: ${targetWorkspaceId}`)
  }

  const sessionTreeIds = collectSessionTreeIds(index.sessions, sessionId)
  const sessionsToMove = index.sessions.filter((item) => sessionTreeIds.has(item.id) && item.workspaceId !== targetWorkspaceId)
  if (sessionsToMove.length === 0) return session

  const now = Date.now()
  let updatedRoot = session
  let movedCount = 0

  for (let i = 0; i < index.sessions.length; i++) {
    const current = index.sessions[i]!
    if (!sessionTreeIds.has(current.id) || current.workspaceId === targetWorkspaceId) continue

    const updated: AgentSessionMeta = {
      ...current,
      workspaceId: targetWorkspaceId,
      runtimeSessionId: undefined,
      runtimeWorkerState: 'cold',
      updatedAt: now,
    }
    index.sessions[i] = updated
    writeIndex(index)
    movedCount++
    if (current.id === sessionId) {
      updatedRoot = updated
    }
  }

  console.log(`[Agent 会话] 已迁移会话及子会话到工作区: ${updatedRoot.title}（${movedCount} 个）→ ${targetWs.name}`)
  return updatedRoot
}

/**
 * 迁移 Chat 对话记录到 Agent 会话
 *
 * 读取 Chat 对话的消息，转换为 AgentMessage 格式，
 * 追加到目标 Agent 会话的 JSONL 文件中。
 *
 * 仅迁移 user 和 assistant 角色的消息文本内容，
 * 工具活动、推理、附件等 Chat 特有字段不迁移。
 */
export function migrateChatToAgentSession(conversationId: string, agentSessionId: string): void {
  const chatMessages = getConversationMessages(conversationId)

  if (chatMessages.length === 0) {
    console.log(`[Agent 会话] Chat 对话无消息，跳过迁移 (${conversationId})`)
    return
  }

  let count = 0
  for (const cm of chatMessages) {
    // 仅迁移 user 和 assistant 消息
    if (cm.role !== 'user' && cm.role !== 'assistant') continue
    if (!cm.content.trim()) continue

    const agentMsg: AgentMessage = {
      id: randomUUID(),
      role: cm.role,
      content: cm.content,
      createdAt: cm.createdAt,
      model: cm.role === 'assistant' ? cm.model : undefined,
    }

    appendAgentMessage(agentSessionId, agentMsg)
    count++
  }

  console.log(`[Agent 会话] 已迁移 ${count} 条消息到 Agent 会话 (${conversationId} → ${agentSessionId})`)
}

/**
 * 使用 CCB Runtime 已完成分叉后，创建 Proma 侧的新会话投影。
 *
 * Runtime transcript 是执行上下文真源；这里仅复制 UI JSONL 与工作目录，
 * 并把新 Proma Session 映射到 Runtime 返回的 session ID。
 */
export async function createForkedAgentSessionProjection(
  input: ForkSessionInput,
  runtimeSessionId: string,
): Promise<AgentSessionMeta> {
  const sourceMeta = getAgentSessionMeta(input.sessionId)
  if (!sourceMeta) throw new Error(`源 Agent 会话不存在: ${input.sessionId}`)

  const forkModelId = input.modelId !== undefined
    ? assertEnabledModelForChannel({
        channelId: sourceMeta.channelId,
        modelId: input.modelId,
        purpose: '分叉 Agent 会话',
      })
    : sourceMeta.modelId
  const sourceDir = resolveAgentSessionAttachmentsDir(sourceMeta.id)
  const newMeta = createAgentSession(
    `${sourceMeta.title} (fork)`,
    sourceMeta.channelId,
    sourceMeta.workspaceId,
    forkModelId,
  )

  try {
    const updated = updateAgentSessionMeta(newMeta.id, {
      runtimeSessionId,
      permissionMode: sourceMeta.permissionMode,
    })
    const destDir = getAgentSessionAttachmentsDir(newMeta.id)
    if (existsSync(sourceDir)) {
      copyForkWorkspaceFiles(sourceDir, destDir)
    }
    await copyForkStoredSDKMessages({
      sourceSessionId: sourceMeta.id,
      destSessionId: newMeta.id,
      upToMessageUuid: input.upToMessageUuid,
      sourceDir,
      destDir,
    })
    console.log(
      `[Agent 会话] 已创建 CCB Runtime 分叉投影: ${sourceMeta.id} → ${updated.id} (${runtimeSessionId})`,
    )
    return updated
  } catch (error) {
    try { deleteAgentSession(newMeta.id) } catch { /* 保留原始错误 */ }
    throw error
  }
}

interface CopyForkStoredSDKMessagesInput {
  sourceSessionId: string
  destSessionId: string
  upToMessageUuid?: string
  sourceDir?: string
  destDir?: string
}

async function copyForkStoredSDKMessages({
  sourceSessionId,
  destSessionId,
  upToMessageUuid,
  sourceDir,
  destDir,
}: CopyForkStoredSDKMessagesInput): Promise<number> {
  const sourcePath = getAgentSessionMessagesPath(sourceSessionId)
  if (!existsSync(sourcePath)) return 0

  const destPath = getAgentSessionMessagesPath(destSessionId)
  const out = createWriteStream(destPath, { flags: 'a', encoding: 'utf-8' })
  let copiedCount = 0

  try {
    for await (const msg of readStoredSDKMessages(sourcePath)) {
      await writeJsonlLine(out, serializeSDKMessageForStorage(msg, sourceDir, destDir))
      copiedCount += 1

      if (upToMessageUuid && getStoredMessageUuid(msg) === upToMessageUuid) {
        break
      }
    }
    await endWriteStream(out)
  } catch (err) {
    out.destroy()
    throw err
  }

  return copiedCount
}

async function* readStoredSDKMessages(filePath: string): AsyncGenerator<SDKMessage> {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if ('role' in parsed && !('type' in parsed)) {
        yield convertLegacyMessage(parsed as AgentMessage)
      } else {
        yield parsed as SDKMessage
      }
    } catch (err) {
      console.warn(`[Agent 会话] 跳过无法解析的 SDKMessage 行 (${filePath}):`, err)
    }
  }
}

function getStoredMessageUuid(msg: SDKMessage): string | undefined {
  return 'uuid' in msg ? (msg as { uuid?: string }).uuid : undefined
}

function serializeSDKMessageForStorage(
  msg: SDKMessage,
  sourceDir?: string,
  destDir?: string,
): string {
  let serialized = JSON.stringify(msg)
  if (sourceDir && destDir) {
    serialized = rewriteSourceToDest(serialized, sourceDir, destDir)
  }
  if (serialized.length <= MAX_SDK_MESSAGE_LENGTH) return serialized

  let sanitized = JSON.stringify(sanitizeOversizedMessage(msg, serialized.length))
  if (sourceDir && destDir) {
    sanitized = rewriteSourceToDest(sanitized, sourceDir, destDir)
  }
  if (sanitized.length > MAX_SDK_MESSAGE_LENGTH) {
    console.warn(`[Agent 会话] 消息截断后仍超限 (${(sanitized.length / 1024).toFixed(0)}K chars)`)
  }
  return sanitized
}

async function writeJsonlLine(stream: WriteStream, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(line + '\n', (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function endWriteStream(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject)
    stream.end(resolve)
  })
}

/**
 * 将一段字符串中所有出现的 sourceDir 替换为 destDir。
 *
 * 用于 fork 会话时把历史中嵌入的源会话绝对路径迁移到新会话目录。
 * 处理 JSON 字符串中可能出现的两种编码形式：
 * 1. 原始路径（如 /Users/a/b）
 * 2. JSON 字符串编码后的形式（路径中的 `/` JSON 标准下不会转义，所以通常与 1 一致；
 *    但保留对反斜杠的处理以兼容 Windows 路径）
 *
 * sourceDir 和 destDir 都会规范化去除末尾斜杠，避免不同形式导致漏替换。
 */
function rewriteSourceToDest(content: string, sourceDir: string, destDir: string): string {
  const normalizedSource = sourceDir.replace(/[\\/]+$/, '')
  const normalizedDest = destDir.replace(/[\\/]+$/, '')
  if (!normalizedSource || normalizedSource === normalizedDest) return content
  let rewritten = content.split(normalizedSource).join(normalizedDest)
  // Windows 路径在 JSON 中会被转义为双反斜杠，单独处理一次
  if (normalizedSource.includes('\\')) {
    const sourceEscaped = normalizedSource.replace(/\\/g, '\\\\')
    const destEscaped = normalizedDest.replace(/\\/g, '\\\\')
    rewritten = rewritten.split(sourceEscaped).join(destEscaped)
  }
  return rewritten
}

/**
 * 截断 Agent 会话的 SDK 消息到指定 UUID（inclusive）
 *
 * 保留 uuid 匹配消息及之前的所有消息，删除之后的消息。
 * 通过原子替换全量重写 JSONL 文件。
 *
 * @returns 截断后保留的消息列表
 */
export function truncateSDKMessages(id: string, upToUuidInclusive: string): SDKMessage[] {
  const filePath = getAgentSessionMessagesPath(id)
  if (!existsSync(filePath)) {
    throw new Error(`[Agent 会话] 截断失败: 会话消息文件不存在, sessionId=${id}`)
  }

  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n').filter((line) => line.trim())
  const messages = parseJsonlStrict<unknown>(lines, `截断读取 SDKMessage (${id})`).map(normalizePersistedSDKMessage)
  const cutIndex = messages.findIndex(
    (m) => 'uuid' in m && (m as { uuid?: string }).uuid === upToUuidInclusive,
  )
  if (cutIndex < 0) {
    throw new Error(`[Agent 会话] 截断失败: 未找到 uuid=${upToUuidInclusive}, sessionId=${id}`)
  }
  const kept = messages.slice(0, cutIndex + 1)

  const content = kept.map((m) => JSON.stringify(m)).join('\n') + (kept.length > 0 ? '\n' : '')
  writeTextFileAtomic(filePath, content)

  console.log(`[Agent 会话] 消息已截断: sessionId=${id}, 保留 ${kept.length}/${messages.length} 条`)
  return kept
}

/**
 * 删除指定 UUID 的持久化错误消息。
 *
 * 仅删除 assistant error，避免调用方误删普通回复；找不到时保持幂等。
 */
export function removeSDKErrorMessage(id: string, errorUuid: string): boolean {
  const filePath = getAgentSessionMessagesPath(id)
  if (!existsSync(filePath)) return false

  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n').filter((line) => line.trim())
  const messages = parseJsonlStrict<unknown>(lines, `删除错误消息 (${id})`).map(normalizePersistedSDKMessage)
  const targetIndex = messages.findIndex((message) =>
    message.type === 'assistant'
      && (message as { uuid?: string }).uuid === errorUuid
      && Boolean((message as { error?: unknown }).error),
  )
  if (targetIndex < 0) return false

  const kept = messages.filter((_, index) => index !== targetIndex)
  const content = kept.map((message) => JSON.stringify(message)).join('\n') + (kept.length > 0 ? '\n' : '')
  writeTextFileAtomic(filePath, content)
  console.log(`[Agent 会话] 已删除重试前错误: sessionId=${id}, uuid=${errorUuid}`)
  return true
}

/**
 * 自动归档超过指定天数未更新的 Agent 会话
 *
 * 置顶会话不会被归档。
 *
 * @param daysThreshold 天数阈值
 * @returns 本次归档的会话数量
 */
export function autoArchiveAgentSessions(daysThreshold: number): number {
  const index = readIndex()
  const threshold = Date.now() - daysThreshold * 86_400_000
  let count = 0

  for (const session of index.sessions) {
    if (!session.pinned && !session.archived && session.updatedAt < threshold) {
      session.archived = true
      count++
    }
  }

  if (count > 0) {
    writeIndex(index)
    console.log(`[Agent 会话] 自动归档 ${count} 个会话（阈值: ${daysThreshold} 天）`)
  }

  return count
}

/**
 * 启动时收敛遗留的委派子会话状态
 *
 * 委派子会话的运行态只在主进程内存中维护，应用退出后无法续跑。
 * 若上次退出时仍有 delegationStatus 为 'running' 的子会话，本次启动需要
 * 把它们标记为 'interrupted'，避免状态永久卡在 running、父会话也无法收敛。
 *
 * @returns 被标记为中断的子会话数量
 */
export function markRunningDelegationsAsInterrupted(): number {
  const index = readIndex()
  let count = 0

  for (const session of index.sessions) {
    if (session.sourceDelegationId && session.delegationStatus === 'running') {
      session.delegationStatus = 'interrupted'
      session.updatedAt = Date.now()
      count++
    }
  }

  if (count > 0) {
    writeIndex(index)
    console.log(`[Agent 会话] 启动收敛 ${count} 个遗留的运行中委派子会话为 interrupted`)
  }

  return count
}

/**
 * 清理所有会话中不存在的附加目录和附加文件
 * @returns 清理的条目总数
 */
export function cleanupStaleAttachedPaths(): number {
  const index = readIndex()
  let count = 0

  for (const session of index.sessions) {
    let changed = false

    if (session.attachedDirectories?.length) {
      const valid = session.attachedDirectories.filter((d) => existsSync(d))
      if (valid.length < session.attachedDirectories.length) {
        count += session.attachedDirectories.length - valid.length
        session.attachedDirectories = valid.length > 0 ? valid : undefined
        changed = true
      }
    }

    if (session.attachedFiles?.length) {
      const valid = session.attachedFiles.filter((f) => existsSync(f))
      if (valid.length < session.attachedFiles.length) {
        count += session.attachedFiles.length - valid.length
        session.attachedFiles = valid.length > 0 ? valid : undefined
        changed = true
      }
    }

    if (changed) {
      session.updatedAt = Date.now()
    }
  }

  if (count > 0) {
    writeIndex(index)
    console.log(`[Agent 会话] 清理了 ${count} 个不存在的附加路径`)
  }

  return count
}

/**
 *
 * 按行流式读取每个会话的 JSONL 文件，命中即早退。兼容旧 AgentMessage 和新 SDKMessage 格式。
 * 每个会话最多返回 1 条匹配，总计达到 maxResults 即停止扫描后续会话。
 *
 * @param query 搜索关键词
 * @returns 匹配结果列表
 */
export async function searchAgentSessionMessages(query: string): Promise<AgentMessageSearchResult[]> {
  if (!query || query.length < 2) return []

  const index = readIndex()
  const results: AgentMessageSearchResult[] = []
  const queryLower = query.toLowerCase()
  const maxResults = 30

  for (const session of index.sessions) {
    if (results.length >= maxResults) break

    const filePath = getAgentSessionMessagesPath(session.id)
    if (!existsSync(filePath)) continue

    const hit = await findFirstMatchInAgentJsonl(filePath, queryLower, query.length)
    if (hit) {
      results.push({
        sessionId: session.id,
        sessionTitle: session.title,
        messageId: hit.messageId,
        role: hit.role,
        snippet: hit.snippet,
        matchStart: hit.matchStart,
        matchLength: query.length,
        archived: session.archived,
      })
    }
  }

  return results
}

/**
 * 在单个 Agent 会话 JSONL 中按行流式查找第一条匹配。
 *
 * Agent 消息存在两种历史格式（旧 AgentMessage 与新 SDKMessage），都要兼容。
 */
async function findFirstMatchInAgentJsonl(
  filePath: string,
  queryLower: string,
  queryLength: number
): Promise<{ messageId: string; role: AgentMessageSearchResult['role']; snippet: string; matchStart: number } | null> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      let parsed: {
        role?: string
        id?: string
        uuid?: string
        content?: unknown
        message?: { role?: string; id?: string; content?: Array<{ type: string; text?: string }> }
      }
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      const rawRole = parsed.role ?? parsed.message?.role ?? 'assistant'
      // 收窄到 AgentMessageSearchResult.role 允许的联合类型；不在白名单的退化为 assistant
      const role: AgentMessageSearchResult['role'] =
        rawRole === 'user' || rawRole === 'assistant' || rawRole === 'tool' || rawRole === 'status'
          ? rawRole
          : 'assistant'
      const messageId = parsed.id ?? parsed.uuid ?? parsed.message?.id ?? ''

      let textContent = ''
      if (typeof parsed.content === 'string') {
        textContent = parsed.content
      } else if (Array.isArray(parsed.message?.content)) {
        textContent = parsed.message.content
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('\n')
      }
      if (!textContent) continue

      const contentLower = textContent.toLowerCase()
      const matchIndex = contentLower.indexOf(queryLower)
      if (matchIndex === -1) continue

      const snippetStart = Math.max(0, matchIndex - 40)
      const snippetEnd = Math.min(textContent.length, matchIndex + queryLength + 40)
      const snippet = (snippetStart > 0 ? '...' : '') +
        textContent.slice(snippetStart, snippetEnd) +
        (snippetEnd < textContent.length ? '...' : '')
      const matchStart = matchIndex - snippetStart + (snippetStart > 0 ? 3 : 0)

      return { messageId, role, snippet, matchStart }
    }
    return null
  } finally {
    rl.close()
    stream.destroy()
  }
}

function extractTextFromPersistedMessage(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return ''
  const record = parsed as {
    content?: unknown
    message?: { content?: Array<{ type: string; text?: string }> }
  }

  if (typeof record.content === 'string') {
    return record.content
  }

  if (Array.isArray(record.message?.content)) {
    return record.message.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n')
  }

  return ''
}

function createSnippet(text: string, matchIndex: number, matchLength: number): string {
  const snippetStart = Math.max(0, matchIndex - 48)
  const snippetEnd = Math.min(text.length, matchIndex + matchLength + 48)
  return (snippetStart > 0 ? '...' : '') +
    text.slice(snippetStart, snippetEnd) +
    (snippetEnd < text.length ? '...' : '')
}

function findSessionMessageSnippet(sessionId: string, query: string): string | undefined {
  if (!query || query.length < 2) return undefined

  const filePath = getAgentSessionMessagesPath(sessionId)
  if (!existsSync(filePath)) return undefined

  const queryLower = query.toLowerCase()
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter((line) => line.trim())

    for (const line of lines) {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch (error) {
        console.warn(`[Agent 会话] 会话引用摘要跳过无法解析的 JSONL 行 (${sessionId}):`, error)
        continue
      }
      const textContent = extractTextFromPersistedMessage(parsed)
      if (!textContent) continue

      const matchIndex = textContent.toLowerCase().indexOf(queryLower)
      if (matchIndex === -1) continue

      return createSnippet(textContent, matchIndex, query.length)
    }
  } catch {
    return undefined
  }

  return undefined
}

/**
 * 搜索当前工作区可引用的 Agent 会话。
 *
 * 仅返回当前工作区、未归档、非当前会话的结果；无关键词时返回最近更新的会话。
 */
export function searchAgentSessionReferences(input: AgentSessionReferenceSearchInput): AgentSessionReferenceSearchResult[] {
  const workspaceId = input?.workspaceId?.trim()
  if (!workspaceId) return []

  const query = (input?.query ?? '').trim()
  const queryLower = query.toLowerCase()
  const requestedLimit = Number.isFinite(input?.limit) ? input.limit! : 20
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_SESSION_REFERENCE_LIMIT)

  const candidates = listAgentSessions()
    .filter((session) => session.workspaceId === workspaceId)
    .filter((session) => !session.archived)
    .filter((session) => session.id !== input?.excludeSessionId)

  const results: AgentSessionReferenceSearchResult[] = []

  for (const session of candidates) {
    if (results.length >= limit) break

    if (!queryLower) {
      results.push({
        sessionId: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        matchSource: 'recent',
      })
      continue
    }

    if (session.title.toLowerCase().includes(queryLower)) {
      results.push({
        sessionId: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        matchSource: 'title',
      })
      continue
    }

    const snippet = findSessionMessageSnippet(session.id, query)
    if (snippet) {
      results.push({
        sessionId: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        snippet,
        matchSource: 'message',
      })
    }
  }

  return results
}
