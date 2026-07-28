import type {
  AgentRuntimeSessionCatalog,
  AgentRuntimeSessionTranscript,
  AgentSessionMeta,
  SDKMessage,
} from '@proma/shared'
import {
  getAgentSessionSDKMessages,
  getAgentSessionMeta,
  listAgentSessions,
  mergeAgentSessionSDKMessages,
  syncRuntimeSessionCatalog,
} from '../agent-session-manager'
import {
  getAgentWorkspace,
  listAgentWorkspaces,
} from '../agent-workspace-manager'
import { ccbDesktopRuntimeClient } from './runtime-client'
import { getCcbUserConfigDir } from './user-config'

const CATALOG_SYNC_TTL_MS = 30_000
const TRANSCRIPT_SYNC_TTL_MS = 5_000

interface CcbSessionCatalogSyncResult {
  sessions: AgentSessionMeta[]
  changed: boolean
  synchronized: boolean
}

export interface CcbSessionTranscriptSyncResult {
  transcript?: AgentRuntimeSessionTranscript
  messages: SDKMessage[]
  changed: boolean
  synchronized: boolean
}

let catalogSyncInFlight: Promise<CcbSessionCatalogSyncResult> | undefined
let catalogLastSyncAt = 0
const transcriptSyncInFlight = new Map<
  string,
  Promise<CcbSessionTranscriptSyncResult>
>()
const transcriptLastSyncAt = new Map<string, number>()

function runtimeEnvironment(): {
  variables: Record<string, string>
  configDir: string
} {
  return {
    variables: {},
    configDir: getCcbUserConfigDir(),
  }
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value)
}

/** 按所有已添加项目 pwd 从 CCB Transcript 目录同步会话列表。 */
async function performCcbSessionCatalogSync(): Promise<CcbSessionCatalogSyncResult> {
  const before = listAgentSessions()
  for (const workspace of listAgentWorkspaces()) {
    const cwd = workspace.canonicalPath || workspace.path
    const sessions: AgentRuntimeSessionCatalog['sessions'] = []
    let offset = 0
    while (true) {
      const catalog =
        await ccbDesktopRuntimeClient.request<AgentRuntimeSessionCatalog>(
        {
          type: 'session.list',
          cwd,
          environment: runtimeEnvironment(),
          limit: 500,
          offset,
        },
        `__session-catalog__:${workspace.id}:${offset}`,
        30_000,
      )
      sessions.push(...catalog.sessions)
      if (catalog.nextOffset === undefined) break
      offset = catalog.nextOffset
    }
    syncRuntimeSessionCatalog(workspace.id, sessions)
  }
  const sessions = listAgentSessions()
  return {
    sessions,
    changed: fingerprint(before) !== fingerprint(sessions),
    synchronized: true,
  }
}

/**
 * 后台同步 CCB Session Catalog。
 *
 * 高频的 listAgentSessions() 只读 Proma 本地索引；这里使用 in-flight 去重和
 * 短 TTL，避免侧栏刷新、模型切换、Turn 完成等操作反复创建无状态 Worker。
 */
export function syncCcbSessionCatalogs(
  force = false,
): Promise<CcbSessionCatalogSyncResult> {
  const now = Date.now()
  if (!force && now - catalogLastSyncAt < CATALOG_SYNC_TTL_MS) {
    return Promise.resolve({
      sessions: listAgentSessions(),
      changed: false,
      synchronized: false,
    })
  }
  if (catalogSyncInFlight) return catalogSyncInFlight

  const task = performCcbSessionCatalogSync()
    .then(result => {
      catalogLastSyncAt = Date.now()
      return result
    })
    .finally(() => {
      if (catalogSyncInFlight === task) catalogSyncInFlight = undefined
    })
  catalogSyncInFlight = task
  return task
}

/** 将 CCB Transcript 增量合并到 Proma 本地 UI 投影。 */
async function performCcbSessionTranscriptSync(
  promaSessionId: string,
): Promise<CcbSessionTranscriptSyncResult> {
  const localMessages = getAgentSessionSDKMessages(promaSessionId)
  const session = getAgentSessionMeta(promaSessionId)
  if (!session?.runtimeSessionId || !session.workspaceId) {
    return {
      messages: localMessages,
      changed: false,
      synchronized: false,
    }
  }
  const workspace = getAgentWorkspace(session.workspaceId)
  if (!workspace) {
    return {
      messages: localMessages,
      changed: false,
      synchronized: false,
    }
  }
  const cwd = workspace.canonicalPath || workspace.path
  const transcript =
    await ccbDesktopRuntimeClient.request<AgentRuntimeSessionTranscript>(
      {
        type: 'session.getTranscript',
        cwd,
        environment: runtimeEnvironment(),
        runtimeSessionId: session.runtimeSessionId,
      },
      `__session-transcript__:${session.runtimeSessionId}`,
      30_000,
    )
  const messages = mergeAgentSessionSDKMessages(
    promaSessionId,
    transcript.messages,
  )
  return {
    transcript,
    messages,
    changed: fingerprint(localMessages) !== fingerprint(messages),
    synchronized: true,
  }
}

/**
 * 后台增量同步单个 Transcript。
 *
 * Proma JSONL 始终先返回给 Renderer；CCB 只在后台补齐 Runtime 消息。相同
 * Session 的并发请求共享一个 Promise，并在短 TTL 内直接命中本地投影。
 */
export function syncCcbSessionTranscript(
  promaSessionId: string,
  force = false,
): Promise<CcbSessionTranscriptSyncResult> {
  const now = Date.now()
  const lastSyncAt = transcriptLastSyncAt.get(promaSessionId) ?? 0
  if (!force && now - lastSyncAt < TRANSCRIPT_SYNC_TTL_MS) {
    return Promise.resolve({
      messages: getAgentSessionSDKMessages(promaSessionId),
      changed: false,
      synchronized: false,
    })
  }
  const inFlight = transcriptSyncInFlight.get(promaSessionId)
  if (inFlight) return inFlight

  const task = performCcbSessionTranscriptSync(promaSessionId)
    .then(result => {
      if (result.synchronized) {
        transcriptLastSyncAt.set(promaSessionId, Date.now())
      }
      return result
    })
    .finally(() => {
      if (transcriptSyncInFlight.get(promaSessionId) === task) {
        transcriptSyncInFlight.delete(promaSessionId)
      }
    })
  transcriptSyncInFlight.set(promaSessionId, task)
  return task
}

/** 删除 Proma 会话对应的 CCB 原生 Transcript。 */
export async function deleteCcbSessionTranscript(
  promaSessionId: string,
): Promise<void> {
  const session = getAgentSessionMeta(promaSessionId)
  if (!session?.runtimeSessionId || !session.workspaceId) return
  const workspace = getAgentWorkspace(session.workspaceId)
  if (!workspace) return
  const cwd = workspace.canonicalPath || workspace.path
  await ccbDesktopRuntimeClient.request<{ deleted: boolean }>(
    {
      type: 'session.delete',
      cwd,
      environment: runtimeEnvironment(),
      runtimeSessionId: session.runtimeSessionId,
    },
    `__session-delete__:${session.runtimeSessionId}`,
    30_000,
  )
  transcriptLastSyncAt.delete(promaSessionId)
}

/** 仅供 BDD 测试清理模块级同步状态。 */
export function resetCcbSessionSyncCacheForTests(): void {
  catalogSyncInFlight = undefined
  catalogLastSyncAt = 0
  transcriptSyncInFlight.clear()
  transcriptLastSyncAt.clear()
}
