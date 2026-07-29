/**
 * AgentOrchestrator — Agent 编排层
 *
 * 从 agent-service.ts 提取的核心业务逻辑，负责：
 * - 并发守卫（同一会话不允许并行请求）
 * - 渠道查找 + API Key 解密
 * - 环境变量构建 + SDK 路径解析
 * - 用户/助手消息持久化
 * - 事件流遍历 + 文本累积 + 事件持久化
 * - 错误处理 + 部分内容保存
 * - 自动标题生成
 *
 * 通过 EventBus 分发 AgentEvent，通过 SessionCallbacks 发送控制信号，
 * 完全解耦 Electron IPC，可独立测试（mock Adapter + EventBus）。
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { existsSync } from 'node:fs'
import type { AgentSendInput, AgentMessage, AgentGenerateTitleInput, AgentProviderAdapter, AgentSessionMeta, AgentRuntimeProviderConfiguration, AgentRuntimeSessionOperationInput, ForkSessionInput, TypedError, RetryAttempt, SDKMessage, SDKAssistantMessage, AgentStreamPayload, RewindSessionResult, ProviderType, CodexOAuthCredentials } from '@proma/shared'
import {
  PROMA_DEFAULT_PERMISSION_MODE,
  PROMA_PERMISSION_MODE_CONFIG,
  CCB_NATIVE_CHANNEL_ID,
  THINKING_SIGNATURE_ERROR_CODE,
  THINKING_SIGNATURE_ERROR_MESSAGE,
  THINKING_SIGNATURE_ERROR_TITLE,
  isPersistableSDKSystemMessage,
  normalizeMcpTransportType,
} from '@proma/shared'
import type {
  PromaPermissionMode,
  PermissionRequest,
  AskUserRequest,
  ExitPlanModeRequest,
  SDKSystemMessage,
} from '@proma/shared'
import { isPromptTooLongError, isThinkingSignatureError, friendlyErrorMessage, mapSDKErrorToTypedError, extractErrorDetails, shouldKeepChannelOpen } from './agent-runtime-errors'
import type { CcbAgentQueryOptions } from './ccb-runtime/ccb-agent-adapter'
import { isTransientNetworkError, isMalformedResponseError, isSessionNotFoundError } from './error-patterns'
import { AgentEventBus } from './agent-event-bus'
import { decryptApiKey, getChannelById, listChannels, resolveCodexOAuthCredentials } from './channel-manager'
import { normalizeAnthropicBaseUrlForSdk, getPromaUserAgent } from '@proma/core'
import pkg from '../../../package.json' with { type: 'json' }
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { appendSDKMessages, updateAgentSessionMeta, getAgentSessionMeta, getAgentSessionMessages, truncateSDKMessages, removeSDKErrorMessage, createForkedAgentSessionProjection } from './agent-session-manager'
import { getAgentWorkspace, getWorkspaceMcpConfig, ensurePluginManifest, getWorkspaceAttachedDirectories, getWorkspaceAttachedFiles } from './agent-workspace-manager'
import { getWorkspaceFilesDir, getWorkspaceSkillsDir } from './config-paths'
import { getRuntimeStatus } from './runtime-init'
import { getSettings } from './settings-service'
import { buildSystemPrompt, buildDynamicContext } from './agent-prompt-builder'
import { buildRecoveryPrompt, buildReferencedSessionsPrompt } from './agent-session-context-prompt'
import { permissionService } from './agent-permission-service'
import type { PermissionResult, CanUseToolOptions } from './agent-permission-service'
import { askUserService } from './agent-ask-user-service'
import { exitPlanService, type ExitPlanPermissionResult } from './agent-exit-plan-service'
import { validateToolInput } from './agent-tool-input-validator'
import { estimateTokenCount, WRITE_CONTENT_TOKEN_THRESHOLD } from './agent-tool-token-estimator'
import { injectBuiltinMcpServers } from './builtin-mcp/registry'
import { injectChromeDevtoolsMcpServer } from './builtin-mcp/chrome-devtools'
import { isBuiltinMcpUserEnabled } from './builtin-mcp/settings'
import { buildAgentRuntimeEnv, mergeRuntimeEnv, type AgentRuntimeEnv } from './agent-runtime-env'
import { isVisibleRunMessage } from './agent-run-message-visibility'
import { getAgentSdkMaxOutputTokens } from './agent-sdk-output-limits'
import { createFallbackTitle } from './title-generation'
import {
  buildCcbProviderConfiguration,
  buildCcbNativeProviderConfiguration,
  buildCcbProviderEnvironment,
} from './ccb-runtime/provider-environment'

// ===== 类型定义 =====

/**
 * 会话控制信号回调
 *
 * 解耦 Electron webContents，使 Orchestrator 可独立测试。
 * agent-service.ts 负责将这些回调绑定到 webContents.send()。
 */
export interface SessionCallbacks {
  /** 发送流式错误 */
  onError: (error: string) => void
  /** 发送流式完成（携带已持久化的消息列表） */
  onComplete: (messages?: AgentMessage[], opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string; resultErrors?: string[]; backgroundTasksPending?: boolean }) => void
  /** 发送标题更新 */
  onTitleUpdated: (title: string) => void
  /** 用户消息已持久化，外部入口可据此通知前端切到实时会话 */
  onRunStarted?: (opts: { startedAt: number }) => void
}

type RecoverableAgentQueryOptions = {
  prompt: string
  resumeSessionId?: string
}

// ===== 工具函数 =====

function sdkPermissionModeForPromaMode(mode: PromaPermissionMode): PromaPermissionMode {
  return PROMA_PERMISSION_MODE_CONFIG[mode].sdkMode
}

const EMPTY_RESPONSE_RESULT_SUBTYPE = 'empty_response'

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingActiveQueueChannelError(error: unknown): boolean {
  return errorMessageOf(error).includes('无活跃消息通道可注入队列消息')
}

function isPartialSDKMessage(message: SDKMessage): boolean {
  return (message as Record<string, unknown>)._partial === true
}

/**
 * 从 stderr 中提取 API 错误信息
 *
 * 解析类似这样的错误：
 * "401 {\"error\":{\"message\":\"...\"}}"
 * "API error: 400 Bad Request ..."
 */
function extractApiError(stderr: string): { statusCode: number; message: string } | null {
  if (!stderr) return null

  // 模式 1：JSON 错误格式 - "401 {...}"
  const jsonMatch = stderr.match(/(\d{3})\s+(\{[^}]*"error"[^}]*\})/s)
  if (jsonMatch) {
    try {
      const statusCode = parseInt(jsonMatch[1]!)
      const errorObj = JSON.parse(jsonMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch {
      // JSON 解析失败，继续尝试其他模式
    }
  }

  // 模式 2：API error 格式 - "API error (attempt X/Y): 401 401 {...}"
  const apiErrorMatch = stderr.match(/API error[^:]*:\s+(\d{3})\s+\d{3}\s+(\{.*?\})/s)
  if (apiErrorMatch) {
    try {
      const statusCode = parseInt(apiErrorMatch[1]!)
      const errorObj = JSON.parse(apiErrorMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch {
      // JSON 解析失败
    }
  }

  // 模式 3：直接的状态码 + 消息
  const simpleMatch = stderr.match(/(\d{3})[:\s]+(.+?)(?:\n|$)/i)
  if (simpleMatch) {
    const statusCode = parseInt(simpleMatch[1]!)
    const message = simpleMatch[2]!.trim()
    if (statusCode >= 400 && statusCode < 600) {
      return { statusCode, message }
    }
  }

  return null
}

// ===== 自动重试工具函数 =====

/** 可自动重试的 TypedError 错误码 */
const AUTO_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'rate_limited',
  'provider_error',      // overloaded 映射为 provider_error
  'service_error',
  'service_unavailable',
  'network_error',
])

/** 判断 typed_error 事件是否可自动重试 */
function isAutoRetryableTypedError(error: TypedError): boolean {
  return AUTO_RETRYABLE_ERROR_CODES.has(error.code)
}

/** 判断 catch 块中的 API 错误是否可自动重试（HTTP 429 / 5xx / 已知可恢复错误模式 / 瞬时网络错误） */
function isAutoRetryableCatchError(
  apiError: { statusCode: number; message: string } | null,
  rawErrorMessage?: string,
  stderr?: string,
): boolean {
  if (apiError) {
    // 529 是 Anthropic 的过载状态码，通常很快恢复；与 429 / 5xx 一并重试。
    if (apiError.statusCode === 429 || apiError.statusCode >= 500) return true
  }
  // 已知的可恢复错误模式（无 HTTP 状态码但可重试）
  if (rawErrorMessage) {
    if (rawErrorMessage.includes('context_management')) return true
  }
  // 兜底：extractApiError 未识别但 stderr / 错误文本中包含 502 / 529 或 overloaded 关键字时也视为可重试
  // 502 (Bad Gateway) 通常是上游网关瞬时异常，与 529 一样很快自行恢复
  const text = `${rawErrorMessage ?? ''}\n${stderr ?? ''}`
  if (/\b502\b|\b529\b|overloaded/i.test(text)) return true
  // 瞬时网络错误（terminated / ECONNRESET / socket hang up 等）
  if (isTransientNetworkError(rawErrorMessage, stderr)) return true
  // 上游响应体解析失败（JSON Parse error 等）：网关瞬时异常返回非 JSON 体，重试通常即可恢复
  if (isMalformedResponseError(rawErrorMessage, stderr)) return true
  return false
}

/** 最大自动重试次数 */
const MAX_AUTO_RETRIES = 25

/** 重试可见性阈值：前 N 次重试不通知 UI，避免偶发瞬时波动频繁惊扰用户 */
const RETRY_VISIBILITY_THRESHOLD = 5

/** 自动重试累计等待预算（毫秒） */
const MAX_AUTO_RETRY_WAIT_MS = 5 * 60_000

/** 重试单次延迟上限（毫秒） */
const RETRY_MAX_DELAY_MS = 15_000

/**
 * 计算重试延迟（指数退避 + ±20% jitter）
 *
 * 基础序列：1s, 2s, 4s, 8s, 15s, 15s...（cap = 15s）
 * 叠加 ±20% 随机抖动，避免大量 session 同时重试造成惊群。
 * 累计等待会被限制在 5 分钟以内。
 */
function getRetryDelayMs(attempt: number, elapsedRetryDelayMs: number): number {
  const remainingMs = MAX_AUTO_RETRY_WAIT_MS - elapsedRetryDelayMs
  if (remainingMs <= 0) return 0

  const base = Math.min(1000 * Math.pow(2, attempt - 1), RETRY_MAX_DELAY_MS)
  const jitter = base * (Math.random() * 0.4 - 0.2)
  return Math.min(remainingMs, Math.max(0, Math.round(base + jitter)))
}

/** 默认会话标题（用于判断是否需要自动生成） */
const DEFAULT_SESSION_TITLE = '新 Agent 会话'

/** 默认模型 ID */
const DEFAULT_MODEL_ID = 'claude-sonnet-5'

/**
 * 聚合一次 SDK 调用涉及的所有附加目录（去重，保持插入顺序）。
 *
 * 发消息（sendMessage）和回退恢复文件（rewindSession）必须使用同一份聚合结果，
 * 否则 SDK 写入 file-history-snapshot 时使用的目录范围，与回退时校验路径越界的目录范围不一致，
 * 会导致 attachedDirectories 内的文件在回退时被静默跳过（"会话回退、代码不回退"）。
 *
 * 来源：
 *   1. extraDirs：调用方传入的临时附加目录（例如 sendMessage 时用户当次提交的目录）
 *   2. 会话级 attachedDirectories + attachedFiles 的父目录
 *   3. 工作区级 attachedDirectories + attachedFiles 的父目录
 *   4. 工作区文件目录 workspace-files/
 */
function collectAttachedDirectories(params: {
  sessionMeta?: AgentSessionMeta
  workspaceSlug?: string
  extraDirs?: string[]
}): string[] {
  const { sessionMeta, workspaceSlug, extraDirs } = params
  const result: string[] = []
  const push = (dir: string | undefined | null) => {
    if (!dir) return
    if (!result.includes(dir)) result.push(dir)
  }

  for (const d of extraDirs ?? []) push(d)
  for (const d of sessionMeta?.attachedDirectories ?? []) push(d)
  for (const file of sessionMeta?.attachedFiles ?? []) push(dirname(file))

  if (workspaceSlug) {
    for (const d of getWorkspaceAttachedDirectories(workspaceSlug)) push(d)
    for (const f of getWorkspaceAttachedFiles(workspaceSlug)) push(dirname(f))
    push(getWorkspaceFilesDir(workspaceSlug))
  }

  return result
}

function escapePromptXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buildAdditionalDirectoriesPrompt(directories: string[]): string {
  if (directories.length === 0) return ''
  const directoryLines = directories
    .map((dir, index) => `  <directory index="${index + 1}">${escapePromptXml(dir)}</directory>`)
    .join('\n')
  return `

<attached_directories>
这些目录已由 Proma 授权给当前会话，和当前工作目录同属于用户允许访问的范围。
如需读取或修改这些目录中的内容，请直接使用绝对路径，不要先复制到当前工作目录。
${directoryLines}
</attached_directories>`
}

// ===== AgentOrchestrator =====

export class AgentOrchestrator {
  private adapter: AgentProviderAdapter
  private eventBus: AgentEventBus
  private activeSessions = new Map<string, number>()

  /** 队列消息本地记录（sessionId → UUID 集合，用于防重） */
  private queuedMessageUuids = new Map<string, Set<string>>()

  /** 被用户手动中止的会话集合（在 stop 中标记，catch block 中消费） */
  private stoppedBySessions = new Set<string>()

  /** 运行中会话的当前权限模式（支持运行时动态切换） */
  private sessionPermissionModes = new Map<string, PromaPermissionMode>()

  constructor(adapter: AgentProviderAdapter, eventBus: AgentEventBus) {
    this.adapter = adapter
    this.eventBus = eventBus
  }

  /**
   * 消费一次用户手动停止标记。
   *
   * SDK 在 query.close() 后不一定走异常路径：某些版本会先正常 yield result 再结束迭代。
   * 因此停止标记必须在所有终态路径统一消费，而不能只依赖 catch 块。
   */
  private consumeStoppedByUser(sessionId: string): boolean {
    const stoppedByUser = this.stoppedBySessions.has(sessionId)
    this.stoppedBySessions.delete(sessionId)
    return stoppedByUser
  }

  /**
   * 构建 SDK 环境变量
   *
   * 注入 API Key、Base URL、代理、Shell 配置等。
   * 对 Kimi Coding Plan / MiniMax Coding Plan：使用 Bearer 认证（ANTHROPIC_AUTH_TOKEN）。
   */
  private buildCcbRuntimeEnv(
    apiKey: string | undefined,
    baseUrl: string | undefined,
    provider: ProviderType | undefined,
    modelId: string | undefined,
    proxyUrl: string | undefined,
    codexCredentials?: CodexOAuthCredentials,
  ): AgentRuntimeEnv {
    const DEFAULT_ANTHROPIC_URL = 'https://api.anthropic.com'

    // CCB Worker 仅接受 Main 显式传入的 Provider 配置，避免 Shell 或用户配置
    // 中残留的其它 Provider 变量改变会话路由。
    const cleanEnv: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(process.env)) {
      const providerManaged =
        key.startsWith('ANTHROPIC_')
        || key.startsWith('OPENAI_')
        || key.startsWith('GEMINI_')
        || key.startsWith('GOOGLE_')
        || key === 'CLAUDE_CODE_USE_OPENAI'
        || key === 'CLAUDE_CODE_USE_GEMINI'
        || key === 'CLAUDE_CODE_USE_GROK'
        || key === 'CLAUDE_CODE_USE_BEDROCK'
        || key === 'CLAUDE_CODE_USE_VERTEX'
        || key === 'CLAUDE_CODE_USE_FOUNDRY'
        || key === 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'
        || key === 'CLAUDE_CODE_MAX_OUTPUT_TOKENS'
      if (!providerManaged) {
        cleanEnv[key] = value
      }
    }

    const maxOutputTokens = getAgentSdkMaxOutputTokens(modelId)
    const normalizedBaseUrl = baseUrl && provider && provider !== 'google'
      && !['openai', 'openai-responses', 'opencode-go-openai', 'zhipu', 'doubao', 'qwen', 'custom', 'openai-codex'].includes(provider)
      ? baseUrl === DEFAULT_ANTHROPIC_URL
        ? undefined
        : normalizeAnthropicBaseUrlForSdk(baseUrl)
      : baseUrl
    const providerEnvironment = provider && apiKey !== undefined
      ? buildCcbProviderEnvironment({
          provider,
          apiKey,
          baseUrl: normalizedBaseUrl,
          modelId,
          userAgent: getPromaUserAgent(pkg.version),
          codexCredentials,
        })
      : {}

    const ccbEnv: Record<string, string | undefined> = {
      ...cleanEnv,
      ...providerEnvironment,
      // 仅 Claude 模型显式提高输出上限；其它兼容模型不注入 max_tokens 覆盖。
      ...(maxOutputTokens ? { CLAUDE_CODE_MAX_OUTPUT_TOKENS: maxOutputTokens } : {}),
      // 启用 Tasks 功能
      CLAUDE_CODE_ENABLE_TASKS: 'true',
      // 禁用实验性 beta 功能，使用稳定模式
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
      // 禁用 Tool Search：Claude 模型连接第一方 Anthropic API 时，SDK CLI 会自动启用
      // Tool Search（optimistic 模式），将外部 MCP 工具标记为 deferred 而非 eager 注册，
      // 导致 HTTP MCP 服务器（如 Nowledge Mem）的工具无法直接调用。
      // Proma 自行管理工具呈现和 MCP 连接，不依赖此机制。
      ENABLE_TOOL_SEARCH: 'false',
      // 禁用 attribution block：SDK 默认会在 system prompt 最前面注入一段
      // 文本（含客户端版本号与基于会话内容计算的指纹），且每次请求都变化。
      // 经第三方 Anthropic 兼容代理/网关中转时，会导致缓存前缀变化、命中率骤降。
      // 官方文档确认直连 Anthropic API 不受此设置影响，故对所有 provider 无条件禁用。
      CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
    }

    if (provider === 'minimax') {
      ccbEnv.API_TIMEOUT_MS = '3000000'
      ccbEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    }

    // 全局 API 超时保护：防止网络环境变化（代理断开/WiFi 切换等）导致 Worker 的
    // HTTP 请求无限挂起。MiniMax 有自己的超时值，不覆盖。
    if (!ccbEnv.API_TIMEOUT_MS) {
      ccbEnv.API_TIMEOUT_MS = '300000' // 5 分钟
    }

    const runtimeEnv = buildAgentRuntimeEnv({
      proxyUrl,
      runtimeStatus: getRuntimeStatus(),
      windowsShellPreference: getSettings().windowsShellPreference,
      processEnv: ccbEnv,
    })

    if (process.platform === 'win32') {
      if (runtimeEnv.shellKind === 'wsl') {
        console.log(`[Agent 编排] 配置 Shell 环境: WSL (${runtimeEnv.wslDistro ?? '默认发行版'})`)
      } else if (runtimeEnv.shellKind === 'git-bash') {
        console.log(`[Agent 编排] 配置 Shell 环境: Git Bash (${runtimeEnv.shellPath})`)
      } else {
        console.warn('[Agent 编排] Windows 平台未检测到可用的 Shell 环境（Git Bash / WSL）')
      }
      ccbEnv.CLAUDE_BASH_NO_LOGIN = '1'
    }

    return {
      ...runtimeEnv,
      env: mergeRuntimeEnv(ccbEnv, runtimeEnv.env),
    }
  }

  /**
   * 构建工作区 MCP 服务器配置
   */
  private buildMcpServers(workspaceSlug: string | undefined): Record<string, Record<string, unknown>> {
    const mcpServers: Record<string, Record<string, unknown>> = {}
    if (!workspaceSlug) return mcpServers

    const mcpConfig = getWorkspaceMcpConfig(workspaceSlug)
    for (const [name, entry] of Object.entries(mcpConfig.servers ?? {})) {
      if (!entry.enabled) continue
      if (name === 'memos-cloud') continue
      const type = normalizeMcpTransportType((entry as { type?: unknown }).type)

      if (type === 'stdio' && entry.command) {
        const mergedEnv: Record<string, string> = {
          ...(process.env.PATH && { PATH: process.env.PATH }),
          ...entry.env,
        }
        mcpServers[name] = {
          type: 'stdio',
          command: entry.command,
          ...(entry.args && entry.args.length > 0 && { args: entry.args }),
          ...(Object.keys(mergedEnv).length > 0 && { env: mergedEnv }),
          required: false,
          startup_timeout_sec: entry.timeout ?? 30,
        }
      } else if ((type === 'http' || type === 'sse') && entry.url) {
        mcpServers[name] = {
          type,
          url: entry.url,
          ...(entry.headers && Object.keys(entry.headers).length > 0 && { headers: entry.headers }),
          required: false,
        }
      } else {
        console.warn(`[Agent 编排] MCP 服务器 "${name}" 配置不完整，已跳过（type=${entry.type}, command=${entry.command ?? '无'}, url=${entry.url ?? '无'}）`)
      }
    }

    if (Object.keys(mcpServers).length > 0) {
      console.log(`[Agent 编排] 已加载 ${Object.keys(mcpServers).length} 个 MCP 服务器`)
    }

    return mcpServers
  }

  /**
   * 生成 Agent 会话标题
   *
   * 使用 Provider 适配器系统，支持所有渠道。任何错误返回 null。
   */
  async generateTitle(input: AgentGenerateTitleInput): Promise<string | null> {
    const { userMessage, channelId, modelId } = input
    const title = createFallbackTitle(userMessage)
    console.log('[Agent 标题生成] 使用本地标题投影:', {
      channelId,
      modelId,
      title,
    })
    return title
  }

  /**
   * 流完成后自动生成标题
   *
   * 如果会话标题仍为默认值，自动调用标题生成并通过回调通知。
   */
  private async autoGenerateTitle(
    sessionId: string,
    userMessage: string,
    channelId: string,
    modelId: string,
    callbacks: SessionCallbacks,
  ): Promise<void> {
    try {
      const meta = getAgentSessionMeta(sessionId)
      if (!meta || meta.title !== DEFAULT_SESSION_TITLE) return

      const title = await this.generateTitle({ userMessage, channelId, modelId })
      if (!title) return

      updateAgentSessionMeta(sessionId, { title, titleSource: 'generated' })
      callbacks.onTitleUpdated(title)
      console.log(`[Agent 编排] 自动标题生成完成: "${title}"`)
    } catch (error) {
      console.warn('[Agent 编排] 自动标题生成失败:', error)
    }
  }

  /**
   * Session-not-found 恢复：保留磁盘 runtimeSessionId，本轮切换到上下文回填模式
   *
   * 当 resume 的目标 session 报 "No conversation found" 时触发。注意该错误可能是
   * listSessions 路径哈希不匹配导致的误检（见步骤 9.6 注释），不代表会话真正失效，
   * 因此不清除磁盘 meta：本轮以非 resume 模式恢复，若失败下一轮仍可尝试 resume（#903）。
   * 调用方负责清理本地 existingRuntimeSessionId 并控制重试流程。
   *
   * @returns lastRetryableError 描述字符串
   */
  private prepareSessionNotFoundRecovery(
    sessionId: string,
    queryOptions: RecoverableAgentQueryOptions,
    contextualMessage: string,
    agentCwd: string,
    workspaceSlug: string | undefined,
    accumulatedMessages: SDKMessage[],
    queryStartedAt: number,
  ): string {
    return this.prepareResumeFallbackRecovery(
      sessionId,
      queryOptions,
      contextualMessage,
      agentCwd,
      workspaceSlug,
      accumulatedMessages,
      queryStartedAt,
      '检测到 session-not-found（可能为误检），保留 runtimeSessionId 并切换到上下文回填模式',
      'Session 暂不可 resume，切换到上下文回填模式',
    )
  }

  /**
   * Resume 失败恢复：本轮切到「非 resume + 历史回填恢复」模式，注入 session 自引用让 Agent
   * 优先通过 session-cleaner 读取干净历史继续工作。使用 <session_recovery> 标签指向当前会话，
   * 比 buildContextPrompt（仅注入 20 条摘要）提供完整得多的上下文连续性。
   *
   * 关于磁盘 meta 的 runtimeSessionId（由 clearPersistedSession 控制，默认 false 即保留）：
   * - 默认保留：本轮恢复只改本地 queryOptions，不动磁盘；若本轮成功，CCB 新会话的 ID 会经
   *   onSessionId 回调自动覆盖 meta；若本轮失败到终止，下一轮仍可尝试 resume 旧 ID（#903）。
   *   这是「迷了就别删」的安全默认，适用于 session-not-found（可能为误检）等不确定场景。
   * - 仅 thinking-signature 跨模型不兼容时传 true：旧 ID 指向的 JSONL 焊死了旧模型思考块，
   *   当前模型 resume 必然再次失败，此时主动清除可避免下一轮无谓的失败往返。
   */
  private prepareResumeFallbackRecovery(
    sessionId: string,
    queryOptions: RecoverableAgentQueryOptions,
    contextualMessage: string,
    agentCwd: string,
    workspaceSlug: string | undefined,
    accumulatedMessages: SDKMessage[],
    queryStartedAt: number,
    logMessage: string,
    retryReason: string,
    clearPersistedSession = false,
  ): string {
    console.log(`[Agent 编排] ${logMessage}`)
    // 先持久化当前已累积的消息，确保 JSONL 文件包含最新内容
    this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
    accumulatedMessages.length = 0
    // 仅在确定旧会话永久无效时（thinking-signature）才清除磁盘 meta；
    // 其余场景保留，新 CCB 会话产生的 runtimeSessionId 会通过 onSessionId 回调自动覆盖。
    if (clearPersistedSession) {
      try { updateAgentSessionMeta(sessionId, { runtimeSessionId: undefined }) } catch { /* 忽略 */ }
    }
    queryOptions.resumeSessionId = undefined
    queryOptions.prompt = buildRecoveryPrompt(sessionId, contextualMessage, { agentCwd, workspaceSlug })
    return retryReason
  }

  /**
   * 持久化累积的 SDKMessage（Phase 4: 直接存储原始 SDKMessage）
   *
   * 只持久化 assistant、user、result 和需要长期可见的 system 消息。
   */
  private persistSDKMessages(
    sessionId: string,
    accumulatedMessages: SDKMessage[],
    durationMs?: number,
  ): void {
    if (accumulatedMessages.length === 0) return

    const hasCompactBoundary = accumulatedMessages.some((m) => {
      return m.type === 'system' && (m as SDKSystemMessage).subtype === 'compact_boundary'
    })

    const toPersist = accumulatedMessages.filter(
      (m) => m.type === 'assistant' || m.type === 'user' || m.type === 'result'
        || (m.type === 'system' && isPersistableSDKSystemMessage(m as SDKSystemMessage))
    ).filter((m) => {
      if (isPartialSDKMessage(m)) return false
      if (m.type === 'system') {
        const sysMsg = m as SDKSystemMessage
        if (hasCompactBoundary && sysMsg.subtype === 'status' && sysMsg.compact_result === 'success') {
          return false
        }
      }
      // 过滤 SDK 内部生成的 user 文本消息（如 Skill 展开 prompt），与实时流过滤逻辑一致
      if (m.type === 'user') {
        const content = (m as { message?: { content?: Array<{ type: string }> } }).message?.content
        const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
        if (!hasToolResult) return false
      }
      return true
    })

    if (toPersist.length === 0) return

    // 为没有 _createdAt 的消息补上时间戳（assistant 消息来自 SDK 原始输出，不含时间）
    const now = Date.now()
    const withTimestamps = toPersist.map((m) => {
      const msg = m as Record<string, unknown>
      if (typeof msg._createdAt === 'number') return m
      // 为 result 消息附加 _durationMs
      if (m.type === 'result' && durationMs != null) {
        return { ...m, _createdAt: now, _durationMs: durationMs } as unknown as SDKMessage
      }
      return { ...m, _createdAt: now } as unknown as SDKMessage
    })

    appendSDKMessages(sessionId, withTimestamps)
  }

  private persistUserMessage(sessionId: string, userMessage: string, createdAt = Date.now()): void {
    const userSDKMsg: SDKMessage = {
      type: 'user',
      message: {
        content: [{ type: 'text', text: userMessage }],
      },
      parent_tool_use_id: null,
      _createdAt: createdAt,
    } as unknown as SDKMessage
    appendSDKMessages(sessionId, [userSDKMsg])
  }

  private persistEmptyResponseError(
    sessionId: string,
    resultSubtype: string | undefined,
    resultErrors: string[] | undefined,
  ): string {
    const detail = resultErrors?.find((error) => error.trim().length > 0)?.trim()
    const subtype = resultSubtype ?? 'unknown'
    const errorContent = detail
      ? `Agent 本轮结束了，但没有返回任何可展示内容。错误详情：${detail}`
      : resultSubtype === 'success'
        ? 'Agent 本轮结束了，但没有返回任何可展示内容。你的消息已保留，可以直接重试或切换模型。'
        : `Agent 本轮异常结束（${subtype}），但没有返回任何可展示内容。你的消息已保留，可以直接重试或切换模型。`
    const errorSDKMsg: SDKMessage = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: errorContent }],
      },
      parent_tool_use_id: null,
      uuid: randomUUID(),
      error: { message: errorContent, errorType: EMPTY_RESPONSE_RESULT_SUBTYPE },
      _createdAt: Date.now(),
      _errorCode: 'unknown_error',
      _errorTitle: '没有收到模型回复',
      _errorCanRetry: true,
      _errorActions: [
        { key: 'r', label: '重试', action: 'retry' },
        { key: 'm', label: '重新选择模型', action: 'select_model' },
      ],
    } as unknown as SDKMessage
    appendSDKMessages(sessionId, [errorSDKMsg])
    console.warn(`[Agent 编排] 本轮没有收到可展示内容: sessionId=${sessionId}, resultSubtype=${subtype}`)
    return errorContent
  }

  /**
   * 发送消息并流式推送事件
   *
   * 核心编排方法，从 agent-service.ts 的 runAgent 提取。
   * 通过 EventBus 分发 AgentEvent，通过 callbacks 发送控制信号。
   */
  async sendMessage(input: AgentSendInput, callbacks: SessionCallbacks): Promise<void> {
    const { sessionId, userMessage, channelId, modelId, workspaceId, runtimeThinking, additionalDirectories, customMcpServers, permissionModeOverride, mentionedSkills, mentionedMcpServers, mentionedSessionIds, automationContext, retryOfErrorUuid } = input
    const stderrChunks: string[] = []
    const streamStartedAt = input.startedAt ?? Date.now()
    let userMessagePersisted = false

    const persistInitialUserMessage = (): void => {
      if (userMessagePersisted) return
      this.persistUserMessage(sessionId, userMessage)
      userMessagePersisted = true
      callbacks.onRunStarted?.({ startedAt: streamStartedAt })
    }

    // 0. 并发保护
    if (this.activeSessions.has(sessionId)) {
      console.warn(`[Agent 编排] 会话 ${sessionId} 正在处理中，拒绝新请求`)
      try {
        persistInitialUserMessage()
      } catch (error) {
        console.error('[Agent 编排] 持久化被拒绝的用户消息失败:', error)
      }
      callbacks.onError('上一条消息仍在处理中，请稍候再试')
      callbacks.onComplete([], { startedAt: streamStartedAt })
      return
    }

    // 手动重试直接删除原错误，避免它在下一轮完成后仍被历史回放。
    // 删除失败不阻断重试（例如旧版本遗留的无 UUID 错误）。
    if (retryOfErrorUuid) {
      try {
        removeSDKErrorMessage(sessionId, retryOfErrorUuid)
      } catch (error) {
        console.warn(`[Agent 编排] 删除重试前错误失败: ${retryOfErrorUuid}`, error)
      }
    }

    try {
      persistInitialUserMessage()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Agent 编排] 持久化用户消息失败:', error)
      callbacks.onError(`消息保存失败：${message}`)
      callbacks.onComplete([], { startedAt: streamStartedAt })
      return
    }

    // 0.5 清除上一轮中断标记
    try { updateAgentSessionMeta(sessionId, { stoppedByUser: false }) } catch { /* 会话可能已删除 */ }

    // 环境 / 配置类错误的统一上报：持久化为 TypedError 消息，由 SDKMessageRenderer 渲染
    const reportPreflightError = (typedError: TypedError) => {
      const errorContent = typedError.title
        ? `${typedError.title}: ${typedError.message}`
        : typedError.message
      const errorSDKMsg: SDKMessage = {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: errorContent }],
        },
        parent_tool_use_id: null,
        uuid: randomUUID(),
        error: { message: typedError.message, errorType: typedError.code },
        _createdAt: Date.now(),
        _errorCode: typedError.code,
        _errorTitle: typedError.title,
        _errorDetails: typedError.details,
        _errorCanRetry: typedError.canRetry,
        _errorActions: typedError.actions,
      } as unknown as SDKMessage
      try { appendSDKMessages(sessionId, [errorSDKMsg]) } catch (e) {
        console.error('[Agent 编排] 持久化 preflight error 失败:', e)
      }
      callbacks.onError(errorContent)
      callbacks.onComplete([], { startedAt: streamStartedAt })
    }

    // 1. Windows 平台：检查 Shell 环境可用性
    if (process.platform === 'win32') {
      const runtimeStatus = getRuntimeStatus()
      const shellStatus = runtimeStatus?.shell

      if (shellStatus && !shellStatus.gitBash?.available && !shellStatus.wsl?.available) {
        reportPreflightError({
          code: 'windows_shell_missing',
          title: 'Windows 环境未就绪',
          message:
            '需要 Git Bash 或 WSL 才能运行 Agent。建议安装 Git for Windows（自带 Git Bash），安装完成后点「打开环境检测」刷新状态。',
          details: [
            `Git Bash: ${shellStatus.gitBash?.error || '未检测到'}`,
            `WSL: ${shellStatus.wsl?.error || '未检测到'}`,
          ],
          actions: [
            { key: 'e', label: '打开环境检测', action: 'open_environment_check' },
            { key: 'g', label: '去官方下载 Git', action: 'open_external', payload: 'https://git-scm.com/download/win' },
          ],
          canRetry: false,
        })
        return
      }
    }

    // 2. 获取渠道信息并解密 API Key
    const useNativeCcbConfiguration = channelId === CCB_NATIVE_CHANNEL_ID
    const channel = useNativeCcbConfiguration ? undefined : getChannelById(channelId)
    if (!useNativeCcbConfiguration && !channel) {
      reportPreflightError({
        code: 'channel_not_found',
        title: '渠道不存在',
        message: '当前会话引用的渠道已被删除或不可用，请在设置中重新选择。',
        actions: [
          { key: 's', label: '打开渠道设置', action: 'open_channel_settings' },
        ],
        canRetry: false,
      })
      return
    }

    let apiKey: string | undefined
    let codexCredentials: CodexOAuthCredentials | undefined
    try {
      if (channel?.provider === 'openai-codex') {
        codexCredentials = await resolveCodexOAuthCredentials(channelId)
        apiKey = codexCredentials.access
      } else if (channel) {
        apiKey = decryptApiKey(channelId)
      }
    } catch (err) {
      if (channel?.provider === 'openai-codex') {
        reportPreflightError({
          code: 'expired_oauth_token',
          title: 'ChatGPT 登录已失效',
          message: '无法刷新 ChatGPT 登录凭据，登录可能已过期或被撤销。请在设置中重新登录 ChatGPT。',
          actions: [
            { key: 's', label: '打开渠道设置', action: 'open_channel_settings' },
          ],
          canRetry: false,
        })
        return
      }
      reportPreflightError({
        code: 'api_key_decrypt_failed',
        title: 'API Key 解密失败',
        message: '无法解密此渠道的 API Key，可能是系统密钥环异常。请到设置中重新填写 API Key。',
        actions: [
          { key: 's', label: '打开渠道设置', action: 'open_channel_settings' },
        ],
        canRetry: false,
      })
      return
    }

    const appSettings = getSettings()
    let sessionMeta = getAgentSessionMeta(sessionId)
    const persistedApprovalMode: PromaPermissionMode = sessionMeta?.permissionMode === 'default'
      ? 'default'
      : 'bypassPermissions'
    const initialPermissionMode: PromaPermissionMode = permissionModeOverride
      ?? (sessionMeta?.planModeEnabled ? 'plan' : persistedApprovalMode)
    console.log('[Agent 编排] Agent runtime: claude-code-best desktop')

    if (channel && !channel.enabled) {
      reportPreflightError({
        code: 'channel_disabled',
        title: '渠道已禁用',
        message: '当前会话引用的渠道已被禁用，请在设置中启用渠道或重新选择模型。',
        actions: [
          { key: 's', label: '打开渠道设置', action: 'open_channel_settings' },
        ],
        canRetry: false,
      })
      return
    }

    let providerConfiguration: AgentRuntimeProviderConfiguration
    try {
      providerConfiguration = channel
        ? buildCcbProviderConfiguration(channel, modelId)
        : buildCcbNativeProviderConfiguration()
    } catch (error) {
      reportPreflightError({
        code: 'agent_model_unavailable',
        title: '渠道没有可用模型',
        message: error instanceof Error
          ? error.message
          : '请在渠道设置中至少启用一个模型。',
        actions: [
          { key: 's', label: '打开渠道设置', action: 'open_channel_settings' },
        ],
        canRetry: false,
      })
      return
    }
    const selectedModelId =
      modelId ?? providerConfiguration.defaultModel ?? DEFAULT_MODEL_ID

    // 2.1 立即抢占会话槽位（在所有同步检查通过后、第一个 await 之前）
    // 防止 buildSdkEnv 等 await 期间并发调用绕过上方的检查，导致多条重复消息写入 JSONL
    // finally 块会通过 generation 匹配来安全清理，不影响正常流程
    const runGeneration = Date.now()
    this.activeSessions.set(sessionId, runGeneration)

    const releaseActiveRun = (): void => {
      // 在发送 STREAM_COMPLETE 前释放 active slot，避免渲染进程已进入空闲态、
      // 主进程仍在 finally 前短暂拒绝下一条消息。
      if (this.activeSessions.get(sessionId) !== runGeneration) return
      this.activeSessions.delete(sessionId)
      this.sessionPermissionModes.delete(sessionId)
      this.queuedMessageUuids.delete(sessionId)
    }
    const completeRun = (
      messages?: AgentMessage[],
      opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string; resultErrors?: string[] },
    ): void => {
      releaseActiveRun()
      callbacks.onComplete(messages, opts)
    }
    // 轻量完成：turn 主体结束但仍有后台任务在飞行。
    // 关键区别——不调用 releaseActiveRun，保留 activeSessions/activeChannels/sessionPermissionModes，
    // 以便 ① adapter 保持的通道在任务完成时自动续轮 ② 用户在等待期手动注入消息能复用通道。
    // UI 侧通过 backgroundTasksPending 进入"空闲可输入"态（spinner 停、输入框启用）。
    const idleComplete = (
      messages?: AgentMessage[],
      opts?: { startedAt?: number; resultSubtype?: string; resultErrors?: string[] },
    ): void => {
      callbacks.onComplete(messages, { ...opts, backgroundTasksPending: true })
    }
    const failRun = (
      error: string,
      messages?: AgentMessage[],
      opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string; resultErrors?: string[] },
    ): void => {
      releaseActiveRun()
      callbacks.onError(error)
      callbacks.onComplete(messages, opts)
    }

    // 3. 构建独立 Worker 环境变量，不修改 Proma Main 的 process.env。
    const proxyUrl = await getEffectiveProxyUrl()
    const runtimeEnv = this.buildCcbRuntimeEnv(
      apiKey,
      channel?.baseUrl,
      channel?.provider,
      selectedModelId,
      proxyUrl,
      codexCredentials,
    )
    const sdkEnv = runtimeEnv.env

    // 4. 读取已有的 CCB Runtime Session ID（用于 resume）
    let existingRuntimeSessionId = sessionMeta?.runtimeSessionId
    console.log(`[Agent 编排] Resume 状态: runtimeSessionId=${existingRuntimeSessionId || '无'}, proma sessionId=${sessionId}`)

    // 5. 状态初始化
    const accumulatedMessages: SDKMessage[] = []
    let resolvedModel = selectedModelId
    let titleGenerationStarted = false
    /** 捕获到的 SDK session ID（用于 resume / recovery） */
    let capturedRuntimeSessionId = existingRuntimeSessionId
    let agentCwd: string | undefined
    let workspaceSlug: string | undefined
    let workspace: import('@proma/shared').AgentWorkspace | undefined

    try {
      console.log(
        `[Agent 编排] 启动 CCB Desktop Runtime — 模型: ${selectedModelId}, resume: ${existingRuntimeSessionId ?? '无'}`,
      )

      // 确定 Agent 工作目录
      agentCwd = homedir()
      workspaceSlug = undefined
      workspace = undefined
      if (workspaceId) {
        const ws = getAgentWorkspace(workspaceId)
        if (ws) {
          agentCwd = ws.canonicalPath || ws.path
          if (!existsSync(agentCwd)) {
            throw new Error(`项目目录不可用，请重新添加项目：${agentCwd}`)
          }
          workspaceSlug = ws.slug
          workspace = ws
          console.log(`[Agent 编排] 使用本机项目 cwd: ${agentCwd} (${ws.name})`)

          ensurePluginManifest(ws.slug, ws.name)

          if (existingRuntimeSessionId) {
            console.log(`[Agent 编排] 将尝试 resume: ${existingRuntimeSessionId}`)
          } else {
            console.log(`[Agent 编排] 无 runtimeSessionId，将作为新会话启动（回填历史上下文）`)
          }
        }
      }

      // 用户选择的项目目录只作为 CCB cwd。Proma 不再自动写入项目内的
      // .claude/settings.json；项目设置和项目 Skills 均由 CCB 原生发现。

      // 9.6 直接信任已保存的 runtimeSessionId，跳过 listSessions 预验证
      // 原因：listSessions({ dir }) 基于 cwd 路径哈希查找，但 session 级别的 cwd
      // （如 ~/.proma/agent-workspaces/workspace-xxx/sessionId）与 SDK 内部存储的路径哈希可能不匹配，
      // 导致 listSessions 始终返回 0 个会话，误杀有效的 resume。
      // SDK 本身会优雅处理无效的 resume ID（回退为新会话），无需预验证。
      if (existingRuntimeSessionId) {
        console.log(`[Agent 编排] 将直接使用已保存的 runtimeSessionId 进行 resume: ${existingRuntimeSessionId}`)
      }

      // 10. 构建 MCP 服务器配置 + 记忆工具 + 生图工具 + 自定义工具
      const mcpServers = this.buildMcpServers(workspaceSlug)
      if (isBuiltinMcpUserEnabled('chrome-devtools')) {
        injectChromeDevtoolsMcpServer(mcpServers)
      }
      const builtinMcpResult = await injectBuiltinMcpServers({
        mcpServers,
        sessionId,
        channelId,
        modelId,
        workspaceId,
        workspaceSlug,
        agentCwd,
        permissionMode: initialPermissionMode,
        triggeredBy: input.triggeredBy,
        sessionMeta,
      })
      const collaborationAvailable = builtinMcpResult.collaborationAvailable

      // 合并外部注入的自定义 MCP 服务器（如飞书群聊工具）
      if (customMcpServers) {
        Object.assign(mcpServers, customMcpServers)
        console.log(`[Agent 编排] 已合并 ${Object.keys(customMcpServers).length} 个自定义 MCP 服务器`)
      }

      // 11. 构建动态上下文和最终 prompt
      const dynamicCtx = buildDynamicContext({
        workspaceName: workspace?.name,
        workspaceSlug,
        agentCwd,
      })

      // 11.5 注入 mention 引用指令（Skill/MCP/会话）— 仅影响 prompt，不影响持久化
      let enrichedMessage = userMessage
      const referencedSessionsBlock = buildReferencedSessionsPrompt(sessionId, mentionedSessionIds, workspaceSlug)
      if (referencedSessionsBlock) {
        enrichedMessage = `${referencedSessionsBlock}\n\n${enrichedMessage}`
        console.log(`[Agent 编排] 注入 referenced_sessions: ${mentionedSessionIds?.length ?? 0} sessions`)
      }
      if (mentionedSkills?.length || mentionedMcpServers?.length) {
        const toolLines: string[] = ['用户在消息中明确引用了以下工具，请在本次回复中主动调用：']
        for (const slug of mentionedSkills ?? []) {
          toolLines.push(`- Skill: ${slug}（请立即调用此 Skill）`)
        }
        for (const name of mentionedMcpServers ?? []) {
          toolLines.push(`- MCP 服务器: ${name}（请使用此 MCP 服务器的工具来完成任务）`)
        }
        enrichedMessage = `<mentioned_tools>\n${toolLines.join('\n')}\n</mentioned_tools>\n\n${enrichedMessage}`
        console.log(`[Agent 编排] 注入 mentioned_tools: ${mentionedSkills?.length ?? 0} skills, ${mentionedMcpServers?.length ?? 0} MCP`)
      }

      const contextualMessage = dynamicCtx
        ? `${dynamicCtx}\n\n${enrichedMessage}`
        : enrichedMessage

      const isCompactCommand = userMessage.trim() === '/compact'
      const finalPrompt = isCompactCommand
        ? '/compact'
        : contextualMessage

      if (existingRuntimeSessionId) {
        console.log(`[Agent 编排] 使用 resume 模式，SDK session ID: ${existingRuntimeSessionId}`)
      }

      // 12. 读取应用设置并确定权限模式
      // 权限模式只属于当前 session；新会话默认完全自动模式。
      // 注册到 Map，支持运行中动态切换
      this.sessionPermissionModes.set(sessionId, initialPermissionMode)
      console.log(`[Agent 编排] 权限模式: ${initialPermissionMode}${permissionModeOverride ? '（外部覆盖）' : ''}`)

      const emitPlanModeChanged = (active: boolean, source: 'initial' | 'tool' | 'permission'): void => {
        try {
          updateAgentSessionMeta(sessionId, { planModeEnabled: active })
        } catch (error) {
          console.warn(`[Agent 编排] 持久化计划模式失败: sessionId=${sessionId}`, error)
        }
        this.eventBus.emit(sessionId, {
          kind: 'proma_event',
          event: { type: 'plan_mode_changed', sessionId, active, source },
        })
      }

      // 当初始模式为 plan 时，通知渲染进程展示计划模式 UI（如「Agent 正在规划」横幅）
      if (initialPermissionMode === 'plan') {
        this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'enter_plan_mode', sessionId } })
        emitPlanModeChanged(true, 'initial')
      }

      /** 读取当前会话的实时权限模式（支持运行中切换） */
      const getPermissionMode = (): PromaPermissionMode =>
        this.sessionPermissionModes.get(sessionId) ?? initialPermissionMode

      // ExitPlanMode 拦截器：plan 模式下走 UI 审批流程
      const handleExitPlanMode = (toolInput: Record<string, unknown>, signal: AbortSignal): Promise<ExitPlanPermissionResult> => {
        return exitPlanService.handleExitPlanMode(
          sessionId,
          toolInput,
          signal,
          (request: ExitPlanModeRequest) => {
            this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'exit_plan_mode_request', request } })
          },
        )
      }

      // 请求批准模式复用 Proma 现有权限队列和白名单，并由 CCB Desktop Bridge
      // 将 interaction.permissionRequested 挂起到用户完成审批。
      const requestToolApproval = permissionService.createCanUseTool(
        sessionId,
        (request: PermissionRequest) => {
          this.eventBus.emit(sessionId, {
            kind: 'proma_event',
            event: { type: 'permission_request', request },
          })
        },
      )

      /**
       * 判断 Bash 命令是否是只读的（计划模式下安全可执行）
       * 检测写操作特征：文件重定向、破坏性命令、包管理写操作、git 写操作等
       */
      const isBashCommandReadOnly = (command: string): boolean => {
        // 输出重定向：匹配未被数字或 & 前置的 > 符号（排除 2>/dev/null、&> 等 fd 重定向）
        if (/(?<![0-9&])>/.test(command)) return false
        // 破坏性文件操作
        if (/\b(rm|rmdir)\s/.test(command)) return false
        if (/\bsed\s+[^|&;]*-i/.test(command)) return false  // sed -i 原地编辑
        if (/\b(chmod|chown|chattr|truncate)\s/.test(command)) return false
        if (/\b(mv|cp)\s/.test(command)) return false
        if (/\b(mkdir|touch|mktemp)\s/.test(command)) return false
        // 包管理器写操作
        if (/\b(npm|pnpm|yarn|bun)\s+(install|i\b|add|remove|uninstall|update|upgrade|link|unlink)\b/.test(command)) return false
        if (/\bpip[23]?\s+(install|uninstall|upgrade)\b/.test(command)) return false
        if (/\b(apt|apt-get|brew|yum|dnf)\s+(install|remove|purge|uninstall|upgrade)\b/.test(command)) return false
        // Git 写操作
        if (/\bgit\s+(commit|push|checkout\s+-[bB]|branch\s+-[mMdD]|merge\b|rebase\b|reset\b|stash\s+(drop|pop)\b|add\b|apply\b|cherry-pick\b)/.test(command)) return false
        // 进程控制
        if (/\b(kill|killall|pkill)\s/.test(command)) return false
        // 脚本执行（具有潜在副作用，如 node script.js / python main.py）
        if (/\b(node|python[23]?|ruby|perl|php)\s+[^-]/.test(command)) return false
        return true
      }

      // Plan 模式下允许的只读工具（不包含 Write/Edit/Bash 等写操作）
      const PLAN_MODE_ALLOWED_TOOLS = new Set([
        'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
        'TodoRead', 'TodoWrite', 'TaskOutput',
        'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
        'ListMcpResourcesTool', 'ReadMcpResourceTool',
      ])
      const DEFERRED_OR_PROACTIVE_TOOLS = new Set([
        'REPL', 'Workflow', 'ScheduleWakeup', 'Monitor', 'PushNotification',
        'CronCreate', 'CronDelete', 'RemoteTrigger',
      ])
      const PLAN_MODE_READ_ONLY_CHROME_DEVTOOLS = new Set([
        'mcp__chrome_devtools__list_pages',
        'mcp__chrome_devtools__take_snapshot',
        'mcp__chrome_devtools__take_screenshot',
        'mcp__chrome_devtools__list_network_requests',
        'mcp__chrome_devtools__performance_stop_trace',
      ])

      /** Plan 模式是否已被 Agent 进入（初始 plan 模式时天然为 true，其他模式需 EnterPlanMode 触发） */
      let planModeEntered = initialPermissionMode === 'plan'

      const syncPlanModeFromToolUse = (toolName: string): void => {
        if (toolName === 'EnterPlanMode') {
          planModeEntered = true
          emitPlanModeChanged(true, 'tool')
          return
        }
        if (toolName === 'ExitPlanMode' && getPermissionMode() === 'bypassPermissions') {
          planModeEntered = false
          emitPlanModeChanged(false, 'tool')
          return
        }
        // auto/plan 下 ExitPlanMode 只是发起退出计划的审批请求。
        // 真正退出由用户审批结果触发，不能在工具开始时提前清掉计划态。
      }

      // 动态 canUseTool：每次调用读取当前权限模式，支持运行中切换
      const canUseTool = async (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> => {
        const currentMode = getPermissionMode()

        // ── 参数校验守卫（所有模式、所有工具，优先于权限检查） ──
        const validationFailure = validateToolInput(toolName, input)
        if (validationFailure) {
          console.warn(`[Agent 工具验证] 参数缺失: tool=${toolName}, mode=${currentMode}`)
          return validationFailure
        }

        // ── Write 大文件 token 截断防护 ──
        if (toolName === 'Write' && typeof input.content === 'string') {
          const estimatedTokens = estimateTokenCount(input.content)
          if (estimatedTokens > WRITE_CONTENT_TOKEN_THRESHOLD) {
            console.warn(
              `[Agent 工具验证] Write 内容过大: tokens≈${estimatedTokens}, chars=${input.content.length}, file=${String(input.file_path)}`,
            )
            return {
              behavior: 'deny' as const,
              message:
                `The content for Write tool (~${estimatedTokens} estimated tokens, ${input.content.length} chars) is too large and may be truncated. ` +
                `Please split the write into smaller sequential steps: write the first portion of the file now, then use Edit tool to append remaining sections incrementally.`,
            }
          }
        }

        // ── EnterPlanMode / ExitPlanMode 处理 ──

        // 完全自动模式：计划进入和退出都透明化，保持 bypassPermissions 的无人值守语义。
        if (currentMode === 'bypassPermissions' && (toolName === 'EnterPlanMode' || toolName === 'ExitPlanMode')) {
          const active = toolName === 'EnterPlanMode'
          planModeEntered = active
          emitPlanModeChanged(active, 'tool')
          return { behavior: 'allow' as const, updatedInput: input }
        }

        // ExitPlanMode：plan 模式下必须让用户确认计划。
        if (toolName === 'ExitPlanMode') {
          console.log(`[canUseTool] ExitPlanMode: signal.aborted=${options.signal.aborted}, planModeEntered=${planModeEntered}, mode=${currentMode}`)
          const result = await handleExitPlanMode(input, options.signal)
          if (result.behavior === 'allow' && 'targetMode' in result && result.targetMode) {
            // 更新 Map，后续 canUseTool 调用使用新模式
            this.sessionPermissionModes.set(sessionId, result.targetMode)
            planModeEntered = false
            emitPlanModeChanged(false, 'permission')
            // 同步通知 SDK 侧切换权限模式
            if (this.adapter.setPermissionMode) {
              this.adapter.setPermissionMode(sessionId, sdkPermissionModeForPromaMode(result.targetMode)).catch((err: unknown) => {
                console.warn(`[Agent 编排] SDK 权限模式切换失败:`, err)
              })
            }
          }
          return result
        }

        // EnterPlanMode：标记进入状态，通知渲染进程
        if (toolName === 'EnterPlanMode') {
          planModeEntered = true
          emitPlanModeChanged(true, 'tool')
          this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'enter_plan_mode', sessionId } })
          return { behavior: 'allow' as const, updatedInput: input }
        }

        // AskUserQuestion：始终走交互式问答流程，不受权限模式影响
        if (toolName === 'AskUserQuestion') {
          return askUserService.handleAskUserQuestion(
            sessionId, input, options.signal,
            (request: AskUserRequest) => {
              this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'ask_user_request', request } })
            },
          )
        }

        // ── 普通工具的权限分派 ──

        switch (currentMode) {
          case 'bypassPermissions':
            return { behavior: 'allow' as const, updatedInput: input }

          case 'default':
            return requestToolApproval(toolName, input, options)

          case 'plan': {
            // Plan 模式：只允许只读工具 + Write/Edit 任意 .md 文件（计划文档）
            if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
              return { behavior: 'allow' as const, updatedInput: input }
            }
            // 允许 Write/Edit 到任意 .md 文件（计划文档一定是 markdown；非 .md 仍被拒）
            if (toolName === 'Write' || toolName === 'Edit') {
              const filePath = typeof input.file_path === 'string' ? input.file_path : ''
              if (filePath.toLowerCase().endsWith('.md')) {
                return { behavior: 'allow' as const, updatedInput: input }
              }
            }
            // Bash 工具：只读命令（find、grep、cat 等）允许执行，写操作拒绝
            if (toolName === 'Bash') {
              const command = typeof input.command === 'string' ? input.command : ''
              if (isBashCommandReadOnly(command)) {
                return { behavior: 'allow' as const, updatedInput: input }
              }
              return { behavior: 'deny' as const, message: '计划模式下不允许执行写操作，请在计划审批通过后再执行' }
            }
            // Chrome DevTools MCP 同时包含只读观察和会改变页面状态的操作。
            // 计划模式只允许快照、截图、网络列表等调研工具；点击、输入、脚本执行等需等计划通过。
            if (toolName.startsWith('mcp__chrome_devtools__')) {
              return PLAN_MODE_READ_ONLY_CHROME_DEVTOOLS.has(toolName)
                ? { behavior: 'allow' as const, updatedInput: input }
                : { behavior: 'deny' as const, message: '计划模式下不允许执行会改变浏览器页面状态的 Chrome DevTools 操作，请在计划审批通过后再执行' }
            }
            // 其他 MCP 工具维持既有策略：计划模式下允许调研用 MCP。
            if (toolName.startsWith('mcp__')) {
              return { behavior: 'allow' as const, updatedInput: input }
            }
            if (DEFERRED_OR_PROACTIVE_TOOLS.has(toolName)) {
              return { behavior: 'deny' as const, message: '计划模式下不允许启动后台、定时、通知或脚本执行能力，请在计划审批通过后再执行' }
            }
            // 其余工具拒绝
            return { behavior: 'deny' as const, message: '计划模式下不允许执行写操作，请在计划审批通过后再执行' }
          }
        }
      }

      // 13. 构建 Adapter 查询选项
      const maxTurns = appSettings.agentMaxTurns && appSettings.agentMaxTurns > 0
        ? appSettings.agentMaxTurns
        : undefined
      const allAdditionalDirectories = collectAttachedDirectories({
        extraDirs: additionalDirectories,
        sessionMeta,
        workspaceSlug,
      })
      const systemPromptAppend = buildSystemPrompt({
        workspaceName: workspace?.name,
        workspaceSlug,
        workspacePath: workspace ? (workspace.canonicalPath || workspace.path) : undefined,
        sessionId,
        permissionMode: initialPermissionMode,
        collaborationAvailable,
      }) + (automationContext ? `\n\n## 定时任务执行上下文\n\n${automationContext}` : '')
      console.log(
        `[Agent Prompt] system=${systemPromptAppend.length} chars, `
        + `user=${finalPrompt.length} chars, estimatedTokens≈${Math.ceil(
          (systemPromptAppend.length + finalPrompt.length) / 4,
        )}`,
      )
      const handleSessionId = (runtimeSessionId: string): void => {
        // 仅在 Runtime Session ID 真正变化时持久化；回调可能在同一轮被多次触发。
        // capturedRuntimeSessionId 已初始化为 existingRuntimeSessionId，并在 recovery 时同步重置。
        const isNewSessionId = runtimeSessionId !== capturedRuntimeSessionId
        capturedRuntimeSessionId = runtimeSessionId
        if (isNewSessionId) {
          try {
            updateAgentSessionMeta(sessionId, {
              runtimeSessionId: runtimeSessionId,
            })
            console.log(`[Agent 编排] 已保存 CCB runtimeSessionId: ${runtimeSessionId}`)
          } catch (err) {
            console.error('[Agent 编排] 保存 CCB runtimeSessionId 失败:', err)
          }
        }

        if (!titleGenerationStarted) {
          titleGenerationStarted = true
          this.autoGenerateTitle(sessionId, userMessage, channelId, resolvedModel, callbacks)
            .catch((err) => console.error('[Agent 编排] 标题生成未捕获异常:', err))
        }
      }
      const handleModelResolved = (model: string): void => {
        // `[1m]` 是 SDK 内部上下文变体，不应泄漏到标题生成或用户可见的模型名。
        resolvedModel = model.replace(/\[1m\]$/i, '')
        console.log(`[Agent 编排] SDK 确认模型: ${resolvedModel}`)
        this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'model_resolved', model: resolvedModel } })
      }
      const handleContextWindow = (cw: number): void => {
        console.log(`[Agent 编排] 缓存 CCB contextWindow: ${cw}`)
        this.eventBus.emit(sessionId, {
          kind: 'proma_event',
          event: { type: 'context_window', contextWindow: cw },
        })
      }
      const queryOptions: CcbAgentQueryOptions = {
        sessionId,
        channelId,
        prompt: finalPrompt,
        model: selectedModelId,
        providerConfiguration,
        thinkingConfig: runtimeThinking?.thinkingConfig ?? appSettings.agentThinking,
        effortLevel: runtimeThinking
          ? runtimeThinking.effortLevel
          : appSettings.agentThinkingEffortLevel,
        cwd: agentCwd,
        additionalSkillDirectories: workspaceSlug
          ? [getWorkspaceSkillsDir(workspaceSlug)]
          : [],
        env: sdkEnv,
        ...(maxTurns != null && { maxTurns }),
        sdkPermissionMode: sdkPermissionModeForPromaMode(initialPermissionMode),
        canUseTool,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: systemPromptAppend + buildAdditionalDirectoriesPrompt(allAdditionalDirectories),
        },
        resumeSessionId: existingRuntimeSessionId,
        ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
        ...(appSettings.agentMaxBudgetUsd != null && appSettings.agentMaxBudgetUsd > 0 && {
          maxBudgetUsd: appSettings.agentMaxBudgetUsd,
        }),
        ...(isCompactCommand ? { compactRequest: true } : {}),
        onSessionId: handleSessionId,
        onModelResolved: handleModelResolved,
        onContextWindow: handleContextWindow,
      }

      console.log(`[Agent 编排] 开始通过 Adapter 遍历事件流...`)

      // 14. 遍历 Adapter 产出的 AgentEvent 流（含自动重试）
      let lastRetryableError: string | undefined
      let retryDelayElapsedMs = 0
      let retryAttemptsScheduled = 0
      let retrySucceeded = false
      let skipNextRetryDelay = false
      let thinkingSignatureRecoveryAttempted = false
      let promptTooLongRecoveryAttempted = false
      let invisibleRecoveryAttempts = 0
      const canAutoRetry = (attempt: number): boolean =>
        attempt <= MAX_AUTO_RETRIES && retryDelayElapsedMs < MAX_AUTO_RETRY_WAIT_MS
      const canReplayPromptForRetry = (attempt: number): boolean =>
        canAutoRetry(attempt)

      const canTryThinkingSignatureRecovery = (attempt: number): boolean =>
        !thinkingSignatureRecoveryAttempted &&
        canAutoRetry(attempt) &&
        !!(existingRuntimeSessionId || capturedRuntimeSessionId || queryOptions.resumeSessionId)
      const canTryPromptTooLongRecovery = (attempt: number): boolean =>
        !promptTooLongRecoveryAttempted &&
        canAutoRetry(attempt) &&
        !!(existingRuntimeSessionId || capturedRuntimeSessionId || queryOptions.resumeSessionId)

      const queryStartedAt = Date.now()

      for (let attempt = 1; attempt <= MAX_AUTO_RETRIES + 1; attempt++) {
        // 非首次尝试：等待 + 发送重试事件到 UI
        if (attempt > 1) {
          if (skipNextRetryDelay) {
            skipNextRetryDelay = false
            console.log(`[Agent 编排] 已切换到上下文回填模式，立即重试`)
          } else {
            const retryAttempt = Math.max(1, attempt - 1 - invisibleRecoveryAttempts)
            const delayMs = getRetryDelayMs(retryAttempt, retryDelayElapsedMs)
            if (delayMs <= 0) {
              console.log(`[Agent 编排] 自动重试等待预算已耗尽 (${MAX_AUTO_RETRY_WAIT_MS}ms)，停止重试`)
              break
            }
            retryDelayElapsedMs += delayMs
            retryAttemptsScheduled = retryAttempt
            const delaySec = delayMs / 1000
            const attemptData: RetryAttempt = {
              attempt: retryAttempt,
              timestamp: Date.now(),
              reason: lastRetryableError ?? '未知错误',
              errorMessage: lastRetryableError ?? '',
              delaySeconds: delaySec,
            }

            // 前 RETRY_VISIBILITY_THRESHOLD 次重试静默进行，避免偶发瞬时波动频繁惊扰用户
            if (retryAttempt > RETRY_VISIBILITY_THRESHOLD) {
              this.eventBus.emit(sessionId, {
                kind: 'proma_event',
                event: { type: 'retry', status: 'starting', attempt: retryAttempt, maxAttempts: MAX_AUTO_RETRIES, delaySeconds: delaySec, reason: lastRetryableError ?? '未知错误' },
              })
              this.eventBus.emit(sessionId, {
                kind: 'proma_event',
                event: { type: 'retry', status: 'attempt', attemptData },
              })
            }

            console.log(`[Agent 编排] 第 ${retryAttempt} 次重试${retryAttempt <= RETRY_VISIBILITY_THRESHOLD ? '(静默)' : ''}，等待 ${delaySec}s...`)
            await new Promise((r) => setTimeout(r, delayMs))

            // 等待期间如果会话被中止，退出
            if (!this.activeSessions.has(sessionId)) {
              const wasStoppedByUser = this.consumeStoppedByUser(sessionId)
              this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
              try { updateAgentSessionMeta(sessionId, { stoppedByUser: wasStoppedByUser }) } catch { /* 会话可能已删除 */ }
              completeRun(getAgentSessionMessages(sessionId), { stoppedByUser: wasStoppedByUser, startedAt: streamStartedAt })
              return
            }
          }
        }

        let shouldRetryFromError = false

        try {
          // 获取异步迭代器（手动 .next() 以支持 Promise.race 中断）
          const queryIterable = this.adapter.query(queryOptions)
          const queryIterator = queryIterable[Symbol.asyncIterator]()

          // 手动事件循环：Promise.race（SDKMessage vs result drain timeout）
          let pendingNext: Promise<IteratorResult<SDKMessage>> | null = null
          // 捕获 result.subtype 以传递给前端（用于区分 success/error_max_turns/error_max_budget_usd）
          let capturedResultSubtype: string | undefined
          // 捕获 result.errors[] 错误详情：SDK 在 error_during_execution 等场景下会把真实错误原因
          // 放进 errors[]，透传到前端用于展示具体错误（而非泛泛的"任务执行过程中发生错误"）。
          let capturedResultErrors: string[] | undefined
          // result 收到后的安全超时：正常情况下 adapter 收到 terminal result 后会主动 break 自己的
          // for-await 循环（触发 SDK iterator.return → cleanup），让此处的 next() 立即拿到 done。
          // 此 timeout 仅作真正的兜底安全网，防止极端情况（SDK 行为再次变化等）下 iterator 不关闭、
          // 事件循环无限挂起。正常运行下不应触发——若日志频繁出现 drain timeout，说明 adapter 主动
          // 终止路径失效，需排查。
          let drainTimeoutPromise: Promise<'drain_timeout'> | null = null
          const RESULT_DRAIN_TIMEOUT_MS = 2_000
          // 后台任务等待态：result 走轻量完成后置 true，下一轮真正开始（收到 assistant/user/task 消息）时
          // 置回 false 并发 run_resumed，让 UI 从空闲态恢复运行态。
          let awaitingBackgroundWake = false
          let visibleRunMessageCount = 0

          while (true) {
            if (!pendingNext) {
              pendingNext = queryIterator.next()
            }

            const racePromises: Array<Promise<{ kind: string; result: IteratorResult<SDKMessage> | null }>> = [
              pendingNext.then((r) => ({ kind: 'event' as const, result: r })),
            ]
            if (drainTimeoutPromise) {
              racePromises.push(drainTimeoutPromise.then(() => ({ kind: 'drain_timeout' as const, result: null })))
            }

            const raceResult = await Promise.race(racePromises)

            if (raceResult.kind === 'drain_timeout') {
              // 安全网：channel.close() 后 SDK 仍未在超时内关闭 iterator，强制退出
              console.warn(`[Agent 编排] drain timeout: SDK iterator 在 result 后 ${RESULT_DRAIN_TIMEOUT_MS}ms 内未关闭，强制退出`)
              pendingNext?.catch(() => {})
              pendingNext = null
              queryIterator.return?.(undefined as never).catch(() => {})
              break
            }

            const iterResult = raceResult.result
            if (!iterResult || iterResult.done) break

            pendingNext = null
            const msg = iterResult.value
            const isPartialMessage = isPartialSDKMessage(msg)
            // isVisibleRunMessage 已抽到独立模块，不含 partial 判断；
            // pi runtime 的流式 partial 消息不应计入可见消息数，故在此显式排除。
            if (!isPartialMessage && isVisibleRunMessage(msg)) {
              visibleRunMessageCount += 1
            }

            // 后台任务唤醒：轻量完成后处于等待态，收到新一轮的首条实质消息时
            // 发 run_resumed，让 UI 从"空闲可输入"恢复到"运行中"。
            // applyAgentEvent 的流式分支不会重置 running，故必须显式通知。
            if (awaitingBackgroundWake) {
              const sub = msg.type === 'system' ? (msg as { subtype?: string }).subtype : undefined
              if (msg.type === 'assistant' || msg.type === 'user' || sub === 'task_started' || sub === 'task_progress') {
                awaitingBackgroundWake = false
                this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'run_resumed', sessionId } })
              }
            }

            // SDK 权限模式可能在 canUseTool 前直接批准工具（如 bypassPermissions）。
            // 因此计划阶段状态要从实际 tool_use 流里同步，不能只依赖权限回调。
            if (msg.type === 'assistant') {
              const assistantMsg = msg as SDKAssistantMessage
              if (!assistantMsg.isReplay) {
                for (const block of assistantMsg.message.content) {
                  if (block.type === 'tool_use' && 'name' in block && typeof block.name === 'string') {
                    syncPlanModeFromToolUse(block.name)
                  }
                }
              }
            }

            // 检测 assistant 消息中的 SDK 错误
            if (msg.type === 'assistant' && !isPartialMessage) {
              const assistantMsg = msg as SDKAssistantMessage
              if (assistantMsg.error) {
                const { detailedMessage, originalError } = extractErrorDetails(
                  assistantMsg as unknown as Parameters<typeof extractErrorDetails>[0],
                )
                let errorCode = assistantMsg.error.errorType || 'unknown_error'
                if (isPromptTooLongError(detailedMessage, originalError)) {
                  errorCode = 'prompt_too_long'
                }
                const typedError = mapSDKErrorToTypedError(errorCode, friendlyErrorMessage(detailedMessage), originalError)

                // Session 不存在错误：清理本轮 resume 指针，切换到上下文回填模式重试。
                if (isSessionNotFoundError(detailedMessage, originalError) && existingRuntimeSessionId && canAutoRetry(attempt)) {
                  invisibleRecoveryAttempts += 1
                  skipNextRetryDelay = true
                  existingRuntimeSessionId = undefined
                  capturedRuntimeSessionId = undefined
                  lastRetryableError = this.prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, workspaceSlug, accumulatedMessages, queryStartedAt)
                  stderrChunks.length = 0
                  shouldRetryFromError = true
                  break
                }

                // Thinking signature 不兼容：通常由跨模型 resume 触发。
                // 先自动清除 CCB resume 关系，改用 Proma 已持久化上下文重跑一次；再失败才展示用户提示。
                if (
                  typedError.code === THINKING_SIGNATURE_ERROR_CODE &&
                  canTryThinkingSignatureRecovery(attempt)
                ) {
                  thinkingSignatureRecoveryAttempted = true
                  invisibleRecoveryAttempts += 1
                  existingRuntimeSessionId = undefined
                  capturedRuntimeSessionId = undefined
                  skipNextRetryDelay = true
                  lastRetryableError = this.prepareResumeFallbackRecovery(
                    sessionId,
                    queryOptions,
                    contextualMessage,
                    agentCwd,
                    workspaceSlug,
                    accumulatedMessages,
                    queryStartedAt,
                    '检测到 thinking signature 不兼容，清除 runtimeSessionId 并切换到上下文回填模式',
                    '思考签名不兼容，切换到上下文回填模式',
                    true,  // 跨模型签名不兼容是唯一确定永久无效的场景，清除磁盘 runtimeSessionId
                  )
                  stderrChunks.length = 0
                  shouldRetryFromError = true
                  break
                }

                // 上下文过长：旧 CCB Session 已经处于不可继续的超限状态。
                // 自动清除 resume 指针，改用 Proma 最近历史回填重跑一次；用于飞书/自动任务等无人值守入口自恢复。
                if (
                  typedError.code === 'prompt_too_long' &&
                  canTryPromptTooLongRecovery(attempt)
                ) {
                  promptTooLongRecoveryAttempted = true
                  invisibleRecoveryAttempts += 1
                  existingRuntimeSessionId = undefined
                  capturedRuntimeSessionId = undefined
                  skipNextRetryDelay = true
                  lastRetryableError = this.prepareResumeFallbackRecovery(
                    sessionId,
                    queryOptions,
                    contextualMessage,
                    agentCwd,
                    workspaceSlug,
                    accumulatedMessages,
                    queryStartedAt,
                    '检测到上下文过长，清除 runtimeSessionId 并切换到上下文回填模式',
                    '上下文过长，切换到上下文回填模式',
                    true,
                  )
                  stderrChunks.length = 0
                  shouldRetryFromError = true
                  break
                }

                // 判断是否可自动重试
                if (isAutoRetryableTypedError(typedError) && canReplayPromptForRetry(attempt)) {
                  lastRetryableError = typedError.title
                    ? `${typedError.title}: ${typedError.message}`
                    : typedError.message
                  console.log(`[Agent 编排] 可重试错误 (assistant error): ${typedError.code} - ${lastRetryableError}`)
                  this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
                  accumulatedMessages.length = 0
                  // 与 catch 路径（isAutoRetryableCatchError）和思考签名回填路径保持一致：
                  // 重试前清空已累积的 stderr，避免 25 次重试上限内字符串无限增长
                  stderrChunks.length = 0
                  shouldRetryFromError = true
                  break
                }

                // 不可重试 → 终止
                this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
                accumulatedMessages.length = 0
                if (typedError.code === 'prompt_too_long') {
                  try { updateAgentSessionMeta(sessionId, { runtimeSessionId: undefined }) } catch { /* 忽略 */ }
                }

                const errorContent = typedError.title
                    ? `${typedError.title}: ${typedError.message}`
                    : typedError.message
                const errorSDKMsg: SDKMessage = {
                  type: 'assistant',
                  message: {
                    content: [{ type: 'text', text: errorContent }],
                  },
                  parent_tool_use_id: null,
                  uuid: randomUUID(),
                  _channelModelId: modelId,
                  _channelProvider: channel?.provider ?? 'custom',
                  error: { message: typedError.message, errorType: typedError.code },
                  _createdAt: Date.now(),
                  _errorCode: typedError.code,
                  _errorTitle: typedError.title,
                  _errorDetails: typedError.details,
                  _errorCanRetry: typedError.canRetry,
                  _errorActions: typedError.actions,
                } as unknown as SDKMessage
                appendSDKMessages(sessionId, [errorSDKMsg])
                console.log(`[Agent 编排] 已保存 TypedError 消息: ${typedError.code} - ${typedError.title}`)

                // 如果之前有可见重试记录，发送 retry_failed
                if (retryAttemptsScheduled > RETRY_VISIBILITY_THRESHOLD && lastRetryableError) {
                  this.eventBus.emit(sessionId, {
                    kind: 'proma_event',
                    event: { type: 'retry', status: 'failed', attemptData: { attempt: retryAttemptsScheduled, timestamp: Date.now(), reason: lastRetryableError, errorMessage: typedError.message, delaySeconds: 0 } },
                  })
                }

                // 透传归一化后的错误消息到前端，避免 SDK 原始 API Error 直接暴露给用户。
                this.eventBus.emit(sessionId, { kind: 'sdk_message', message: errorSDKMsg })
                try { updateAgentSessionMeta(sessionId, {}) } catch { /* 忽略 */ }
                completeRun(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })
                return
              }
            }

            // 累积 assistant 和 user 消息用于持久化
            // - 跳过 replay 消息，避免 resume 时重复写入
            // - 对 user 消息，仅累积含 tool_result 的（初始用户消息已在步骤 5 手动持久化）
            // - 对 system 消息，仅累积需要长期可见的状态（压缩 / 权限拒绝）
            if (msg.type === 'assistant' || msg.type === 'user' || msg.type === 'result') {
              const msgRecord = msg as Record<string, unknown>
              if (!msgRecord.isReplay && !isPartialMessage) {
                if (msg.type === 'user') {
                  // 仅累积包含 tool_result 的 user 消息（跳过 SDK 重新发出的初始用户消息）
                  const content = (msg as { message?: { content?: Array<{ type: string }> } }).message?.content
                  const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
                  if (hasToolResult) {
                    accumulatedMessages.push(msg)
                  }
                } else {
                  // 为结果消息注入渠道信息，确保持久化后能按 Agent SDK 运行窗口计算压缩阈值
                  if (msg.type === 'result') {
                    if (modelId) {
                      (msg as Record<string, unknown>)._channelModelId = modelId
                    }
                    ;(msg as Record<string, unknown>)._channelProvider = channel?.provider ?? 'custom'
                  }
                  // 为 assistant 消息注入渠道信息，确保持久化后能正确匹配模型显示名与 Agent SDK 窗口
                  if (msg.type === 'assistant') {
                    if (modelId) {
                      (msg as Record<string, unknown>)._channelModelId = modelId
                    }
                    ;(msg as Record<string, unknown>)._channelProvider = channel?.provider ?? 'custom'
                  }
                  accumulatedMessages.push(msg)
                }
              }
            } else if (msg.type === 'system') {
              const sysMsg = msg as SDKSystemMessage
              if (isPersistableSDKSystemMessage(sysMsg)) {
                accumulatedMessages.push(msg)
              }
            }

            // Turn 结束时：持久化累积消息
            if (msg.type === 'result') {
              capturedResultSubtype = (msg as { subtype?: string }).subtype
              // SDK 的 SDKResultError 在 errors[] 中携带真实错误原因（error_during_execution 等场景），
              // 捕获后既用于重试判定，也透传到前端展示具体错误。
              const rawResultErrors = (msg as { errors?: unknown }).errors
              capturedResultErrors = Array.isArray(rawResultErrors)
                ? rawResultErrors.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
                : undefined
              this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
              accumulatedMessages.length = 0
              // 软中断 / 延迟工具 / hook 暂停等场景下，adapter 保留 channel
              // 等待队列或后续消息继续 drive Query，此处跳过 drain 超时以免误关闭事件循环。
              // 完整白名单见 agent-runtime-errors.ts 的 CONTINUABLE_TERMINAL_REASONS。
              const resultTerminalReason = (msg as { terminal_reason?: string }).terminal_reason
              // adapter 在"本轮结束但仍有后台任务/定时任务在飞行"时打的注解：
              // 走轻量完成（UI 空闲可输入、host 保留会话），等待 task_notification 自动续轮。
              const keptOpenForTasks = (msg as Record<string, unknown>)._keepChannelOpenForTasks === true
              const keepChannelOpen = shouldKeepChannelOpen(resultTerminalReason) || keptOpenForTasks
              // 分类打点：跟踪线上哪种 terminal_reason 最常见，配合 deferred_tool_use 回填决策
              const hasDeferredTool = (msg as { deferred_tool_use?: unknown }).deferred_tool_use != null
              console.log(
                `[Agent 编排] result 到达: sessionId=${sessionId}, subtype=${capturedResultSubtype ?? 'unknown'}, ` +
                `terminal_reason=${resultTerminalReason ?? 'undefined'}, keepChannelOpen=${keepChannelOpen}` +
                (keptOpenForTasks ? ', keptOpenForTasks=true' : '') +
                (hasDeferredTool ? ', hasDeferredTool=true' : '') +
                (capturedResultErrors?.length ? `, errors=${JSON.stringify(capturedResultErrors)}` : ''),
              )
              // error_during_execution 是 SDK 的兜底错误码，以 result（而非 assistant.error / 抛异常）形式到达，
              // 默认不会触发上面两条重试路径。这里用 errors[] 文本喂给现有的可重试判定（502/529/overloaded/
              // 网络瞬断 / 响应体解析失败等），命中则进入重试循环，复用统一的退避逻辑。
              if (
                capturedResultSubtype === 'error_during_execution' &&
                capturedResultErrors?.length &&
                isSessionNotFoundError(capturedResultErrors.join('\n'), stderrChunks.join('\n')) &&
                existingRuntimeSessionId &&
                canAutoRetry(attempt)
              ) {
                invisibleRecoveryAttempts += 1
                skipNextRetryDelay = true
                existingRuntimeSessionId = undefined
                capturedRuntimeSessionId = undefined
                lastRetryableError = this.prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, workspaceSlug, accumulatedMessages, queryStartedAt)
                stderrChunks.length = 0
                shouldRetryFromError = true
                break
              }
              if (
                capturedResultSubtype === 'error_during_execution' &&
                capturedResultErrors?.length &&
                isAutoRetryableCatchError(null, capturedResultErrors.join('\n')) &&
                canReplayPromptForRetry(attempt)
              ) {
                lastRetryableError = capturedResultErrors[0]
                console.log(`[Agent 编排] 可重试错误 (result error_during_execution, attempt ${attempt}/${MAX_AUTO_RETRIES}): ${lastRetryableError}`)
                // 与 assistant.error / catch 重试路径保持一致：清空已累积 stderr，避免重试上限内无限增长
                stderrChunks.length = 0
                shouldRetryFromError = true
                break
              }
              if (keptOpenForTasks) {
                // 轻量完成：UI 置空闲可输入，但 host 保持运行态（不 releaseActiveRun、不 break、不启动 drain 超时），
                // while 循环继续 park 在 queryIterator.next()，等待后台任务完成时 SDK 自动 yield 的新一轮消息。
                awaitingBackgroundWake = true
                idleComplete(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt, resultSubtype: capturedResultSubtype, resultErrors: capturedResultErrors })
              } else if (!keepChannelOpen && !drainTimeoutPromise) {
                // 启动 drain 超时安全网：正常情况下 adapter 收到 terminal result 会主动 break
                // 触发 iterator.return → 下一次 next() 立即返回 done，此 timeout 不会触发。
                // 仅在极端情况下（adapter 主动终止失效、SDK 行为再次变化）保护事件循环不无限挂起。
                drainTimeoutPromise = new Promise((resolve) =>
                  setTimeout(() => resolve('drain_timeout'), RESULT_DRAIN_TIMEOUT_MS),
                )
              }
            }

            // 过滤 SDK 内部生成的 user 消息（如 Skill 展开文本），避免在前端渲染为用户消息
            // 仅允许含 tool_result 的 user 消息通过（这些是工具调用的响应，需要展示）
            // 初始用户消息已通过前端乐观注入显示，无需 SDK 重复推送
            let shouldEmit = true
            if (msg.type === 'user') {
              const content = (msg as { message?: { content?: Array<{ type: string }> } }).message?.content
              const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
              if (!hasToolResult) {
                shouldEmit = false
              }
            }

            if (!shouldEmit) {
              // 跳过 SDK 内部 user 消息的前端推送
            } else {
              this.eventBus.emit(sessionId, { kind: 'sdk_message', message: msg })
            }
          }

          // 错误 break 触发了 → 继续循环
          if (shouldRetryFromError) {
            continue
          }

          const wasStoppedByUser = this.consumeStoppedByUser(sessionId)

          // 正常完成 — 如果之前有可见重试，发送 retry_cleared
          if (!wasStoppedByUser && retryAttemptsScheduled > RETRY_VISIBILITY_THRESHOLD) {
            this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'retry', status: 'cleared' } })
            console.log(`[Agent 编排] 重试成功，已在第 ${attempt} 次尝试后恢复`)
          }
          retrySucceeded = true

          // 15. 持久化 assistant 消息
          this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)

          try { updateAgentSessionMeta(sessionId, wasStoppedByUser ? { stoppedByUser: true } : {}) } catch { /* 忽略 */ }

          if (!wasStoppedByUser && visibleRunMessageCount === 0) {
            const errorContent = this.persistEmptyResponseError(sessionId, capturedResultSubtype, capturedResultErrors)
            failRun(errorContent, getAgentSessionMessages(sessionId), {
              startedAt: streamStartedAt,
              resultSubtype: EMPTY_RESPONSE_RESULT_SUBTYPE,
              resultErrors: [errorContent],
            })
            return
          }

          // Plan 模式：Agent 完成规划后注入"接受计划"建议
          if (initialPermissionMode === 'plan' && planModeEntered && this.activeSessions.has(sessionId)) {
            this.eventBus.emit(sessionId, {
              kind: 'sdk_message',
              message: { type: 'prompt_suggestion', suggestion: '请执行该计划' } as unknown as SDKMessage,
            })
            console.log(`[Agent 编排] Plan 模式：已注入计划确认建议`)
          }

          // 发送完成信号
          completeRun(getAgentSessionMessages(sessionId), { stoppedByUser: wasStoppedByUser, startedAt: streamStartedAt, resultSubtype: capturedResultSubtype, resultErrors: capturedResultErrors })

          break  // 成功完成，退出重试循环

        } catch (error) {
          // 打印 stderr
          const fullStderr = stderrChunks.join('').trim()
          if (fullStderr) {
            console.error(`[Agent 编排] 完整 stderr 输出 (${fullStderr.length} 字符):`)
            console.error(fullStderr)
          } else {
            console.error(`[Agent 编排] stderr 为空`)
          }

          // 用户主动中止
          if (!this.activeSessions.has(sessionId)) {
            const wasStoppedByUser = this.consumeStoppedByUser(sessionId)
            console.log(`[Agent 编排] 会话 ${sessionId} 已被用户中止`)
            this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
            // 持久化中断状态到会话 meta
            try { updateAgentSessionMeta(sessionId, { stoppedByUser: wasStoppedByUser }) } catch { /* 会话可能已删除 */ }
            completeRun(getAgentSessionMessages(sessionId), { stoppedByUser: wasStoppedByUser, startedAt: streamStartedAt })
            return
          }

          // 从 stderr 提取 API 错误
          const stderrOutput = stderrChunks.join('').trim()
          const apiError = extractApiError(stderrOutput)
          const rawErrorMessage = error instanceof Error ? error.message : ''
          const catchLooksPromptTooLong = isPromptTooLongError(
            apiError?.message ?? '',
            rawErrorMessage,
            stderrOutput,
          )

          // Session 不存在错误：清理本轮 resume 指针，切换到上下文回填模式重试。
          if (isSessionNotFoundError(rawErrorMessage, stderrOutput) && existingRuntimeSessionId && canAutoRetry(attempt)) {
            invisibleRecoveryAttempts += 1
            skipNextRetryDelay = true
            existingRuntimeSessionId = undefined
            capturedRuntimeSessionId = undefined
            lastRetryableError = this.prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, workspaceSlug, accumulatedMessages, queryStartedAt)
            stderrChunks.length = 0
            continue  // 进入下一次 retry 循环
          }

          // 上下文过长：清除超限 resume 指针，用 Proma 历史回填自动恢复一次。
          if (catchLooksPromptTooLong && canTryPromptTooLongRecovery(attempt)) {
            promptTooLongRecoveryAttempted = true
            invisibleRecoveryAttempts += 1
            existingRuntimeSessionId = undefined
            capturedRuntimeSessionId = undefined
            skipNextRetryDelay = true
            lastRetryableError = this.prepareResumeFallbackRecovery(
              sessionId,
              queryOptions,
              contextualMessage,
              agentCwd,
              workspaceSlug,
              accumulatedMessages,
              queryStartedAt,
              '检测到上下文过长，清除 runtimeSessionId 并切换到上下文回填模式',
              '上下文过长，切换到上下文回填模式',
              true,
            )
            stderrChunks.length = 0
            continue  // 进入下一次 retry 循环
          }

          // Thinking signature 不兼容：先自动清除 CCB resume 关系并用上下文回填重跑一次。
          if (
            isThinkingSignatureError(apiError?.message ?? '', rawErrorMessage, stderrOutput) &&
            canTryThinkingSignatureRecovery(attempt)
          ) {
            thinkingSignatureRecoveryAttempted = true
            invisibleRecoveryAttempts += 1
            existingRuntimeSessionId = undefined
            capturedRuntimeSessionId = undefined
            skipNextRetryDelay = true
            lastRetryableError = this.prepareResumeFallbackRecovery(
              sessionId,
              queryOptions,
              contextualMessage,
              agentCwd,
              workspaceSlug,
              accumulatedMessages,
              queryStartedAt,
              '检测到 thinking signature 不兼容，清除 runtimeSessionId 并切换到上下文回填模式',
              '思考签名不兼容，切换到上下文回填模式',
              true,  // 跨模型签名不兼容是唯一确定永久无效的场景，清除磁盘 runtimeSessionId
            )
            stderrChunks.length = 0
            continue  // 进入下一次 retry 循环
          }

          // 判断是否可重试
          if (isAutoRetryableCatchError(apiError, rawErrorMessage, stderrOutput) && canReplayPromptForRetry(attempt)) {
            lastRetryableError = apiError
              ? `API Error ${apiError.statusCode}: ${apiError.message}`
              : (error instanceof Error ? error.message : '未知错误')
            console.log(`[Agent 编排] 可重试错误 (catch, attempt ${attempt}/${MAX_AUTO_RETRIES}): ${lastRetryableError}`)
            // 保存部分内容
            this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
            accumulatedMessages.length = 0
            stderrChunks.length = 0
            continue  // 进入下一次 retry 循环
          }

          // 不可重试 — 走原有终止逻辑
          const errorMessage = error instanceof Error ? error.message : '未知错误'
          console.error(`[Agent 编排] 执行失败:`, error)

          // 保存已累积的部分内容
          if (accumulatedMessages.length > 0) {
            try {
              this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
              console.log(`[Agent 编排] 已保存部分执行结果 (${accumulatedMessages.length} 条消息)`)
            } catch (saveError) {
              console.error('[Agent 编排] 保存部分内容失败:', saveError)
            }
          }

          let userFacingError: string
          if (apiError) {
            userFacingError = friendlyErrorMessage(`API 错误 (${apiError.statusCode}):\n${apiError.message}`)
          } else {
            userFacingError = friendlyErrorMessage(errorMessage)
          }

          // 保存错误消息到 JSONL
          try {
            // 检测是否为 prompt too long 错误
            const isPromptTooLong = isPromptTooLongError(
              userFacingError,
              error instanceof Error ? (error.stack ?? error.message) : String(error),
              stderrOutput,
            )
            const isThinkingSignature = isThinkingSignatureError(
              apiError?.message ?? '',
              userFacingError,
              rawErrorMessage,
              error instanceof Error ? (error.stack ?? error.message) : String(error),
              stderrOutput,
            )
            const errorCode = isPromptTooLong
              ? 'prompt_too_long'
              : isThinkingSignature
                ? THINKING_SIGNATURE_ERROR_CODE
                : 'unknown_error'
            const errorTitle = isPromptTooLong
              ? '上下文过长'
              : isThinkingSignature
                ? THINKING_SIGNATURE_ERROR_TITLE
                : '执行错误'
            const errorContent = isPromptTooLong
              ? '上下文过长：当前对话的上下文已超出模型限制，请压缩上下文或开启新会话'
              : isThinkingSignature
                ? `${THINKING_SIGNATURE_ERROR_TITLE}：${THINKING_SIGNATURE_ERROR_MESSAGE}`
                : userFacingError
            const errorActions = isThinkingSignature
              ? [
                  { key: 'n', label: '在新对话继续', action: 'retry_in_new_session' },
                  { key: 'r', label: '重试', action: 'retry' },
                ]
              : undefined
            userFacingError = errorContent
            if (isPromptTooLong) {
              try {
                updateAgentSessionMeta(sessionId, {
                  runtimeSessionId: undefined,
                  runtimeWorkerState: 'cold',
                })
              } catch { /* 忽略 */ }
            }

            const errMsg: SDKMessage = {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: errorContent }],
              },
              parent_tool_use_id: null,
              uuid: randomUUID(),
              error: { message: errorContent, errorType: errorCode },
              _createdAt: Date.now(),
              _errorCode: errorCode,
              _errorTitle: errorTitle,
              _errorActions: errorActions,
            } as unknown as SDKMessage
            appendSDKMessages(sessionId, [errMsg])
            console.log(`[Agent 编排] 已保存错误消息到 JSONL`)
          } catch (saveError) {
            console.error('[Agent 编排] 保存错误消息失败:', saveError)
          }

          // 如果之前有可见重试记录，发送 retry_failed
          if (retryAttemptsScheduled > RETRY_VISIBILITY_THRESHOLD && lastRetryableError) {
            this.eventBus.emit(sessionId, {
              kind: 'proma_event',
              event: { type: 'retry', status: 'failed', attemptData: { attempt: retryAttemptsScheduled, timestamp: Date.now(), reason: lastRetryableError, errorMessage: userFacingError, delaySeconds: 0 } },
            })
          }

          failRun(userFacingError, getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })

          // 保留 Runtime Session ID，确保下一轮能继续 resume（修复 #903）。
          // 此终止分支只会被「非 session-not-found」的错误命中（session 失效已在上文
          // isSessionNotFoundError 分支单独处理并切到恢复模式）。网络断连、服务端 5xx、
          // 未知错误都不代表 CCB 会话本身失效——其完整历史仍保存在
          // ~/.proma/runtime/ccb/ 中，依旧可 resume。
          // 此前这里对 `!apiError`（如普通断连解析不出状态码）一律清除指针，导致下一轮
          // 退化为「仅回填最近 N 条」的冷启动，上下文从满载骤降（#903）。
          if (existingRuntimeSessionId) {
            console.log(`[Agent 编排] 保留 Runtime Session ID 以便下一轮 resume（错误未表明会话失效）`)
          }

          return
        }
      }

      // 重试循环结束（达到最大次数仍失败）
      if (!retrySucceeded && lastRetryableError) {
        const retryFailureMessage = retryDelayElapsedMs >= MAX_AUTO_RETRY_WAIT_MS
          ? '重试等待已达到 5 分钟后仍然失败'
          : `重试 ${retryAttemptsScheduled || MAX_AUTO_RETRIES} 次后仍然失败`

        // 仅当重试曾经对用户可见时才发送 retry_failed 事件
        if (retryAttemptsScheduled > RETRY_VISIBILITY_THRESHOLD) {
          this.eventBus.emit(sessionId, {
            kind: 'proma_event',
            event: { type: 'retry', status: 'failed', attemptData: { attempt: retryAttemptsScheduled || MAX_AUTO_RETRIES, timestamp: Date.now(), reason: lastRetryableError, errorMessage: retryFailureMessage, delaySeconds: 0 } },
          })
        }

        // 保存错误消息
        const retryErrorContent = `${retryFailureMessage}: ${lastRetryableError}`
        const retryErrorSDKMsg: SDKMessage = {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: retryErrorContent }],
          },
          parent_tool_use_id: null,
          uuid: randomUUID(),
          error: { message: retryErrorContent, errorType: 'unknown_error' },
          _createdAt: Date.now(),
          _errorCode: 'unknown_error',
          _errorTitle: '重试失败',
        } as unknown as SDKMessage
        appendSDKMessages(sessionId, [retryErrorSDKMsg])

        failRun(`${retryFailureMessage}: ${lastRetryableError}`, getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })
      }

    } finally {
      // 只在 generation 匹配时才清理，防止旧流的 finally 误删新流的注册
      releaseActiveRun()
      permissionService.clearSessionPending(sessionId)
      // askUserService 不在 turn 结束时清理——AskUserQuestion 的生命周期由用户交互决定，
      // 仅在会话真正删除时（DELETE_SESSION IPC）才清理。
      exitPlanService.clearSessionPending(sessionId)
    }
  }

  /**
   * 中止指定会话的 Agent 执行
   *
   * 先从 activeSessions 移除（供 sendMessage catch 块检测用户中止），
   * 再调用 adapter.abort() 中止底层 SDK 进程。
   */
  async stop(sessionId: string): Promise<void> {
    this.stoppedBySessions.add(sessionId)
    this.queuedMessageUuids.delete(sessionId)
    console.log(`[Agent 编排] 正在等待 CCB 停止会话: ${sessionId}`)
    try {
      await this.adapter.abort(sessionId)
      console.log(`[Agent 编排] CCB 已确认会话停止: ${sessionId}`)
    } finally {
      // 只有 CCB 已完成停止，或停止请求明确失败后，才释放 Proma 运行状态。
      // 正常路径通常会先由 sendMessage 的 finally 清理，这里作为幂等兜底。
      this.activeSessions.delete(sessionId)
      this.sessionPermissionModes.delete(sessionId)
    }
  }

  /** 删除会话前停止当前 Turn，并释放 CCB 长期 Worker。 */
  async closeSession(sessionId: string): Promise<void> {
    if (this.activeSessions.has(sessionId)) {
      await this.stop(sessionId)
    }
    await this.adapter.closeSession?.(sessionId)
  }

  /** 检查指定会话是否正在处理中 */
  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId)
  }

  /**
   * 运行中动态切换会话的权限模式
   *
   * 同时更新 Proma 侧（canUseTool 闭包读取的 Map）和 SDK 侧（query.setPermissionMode）。
   * 典型场景：用户在 Agent 运行中通过 PermissionModeSelector 切换模式。
   */
  async updateSessionPermissionMode(sessionId: string, mode: PromaPermissionMode): Promise<void> {
    if (!this.activeSessions.has(sessionId)) return
    this.sessionPermissionModes.set(sessionId, mode)
    this.eventBus.emit(sessionId, {
      kind: 'proma_event',
      event: { type: 'plan_mode_changed', sessionId, active: mode === 'plan', source: 'permission' },
    })
    // 同步通知 SDK 侧
    if (this.adapter.setPermissionMode) {
      await this.adapter.setPermissionMode(sessionId, sdkPermissionModeForPromaMode(mode))
    }
    console.log(`[Agent 编排] 运行中权限模式已切换: sessionId=${sessionId}, mode=${mode}`)
  }

  // ===== Runtime Session 操作 =====

  private async buildRuntimeSessionOperationInput(
    sessionMeta: AgentSessionMeta,
  ): Promise<AgentRuntimeSessionOperationInput> {
    if (!sessionMeta.runtimeSessionId) {
      throw new Error('会话没有 CCB Runtime Session ID')
    }
    const sessionChannelId = sessionMeta.channelId
    const useNativeCcbConfiguration =
      !sessionChannelId || sessionChannelId === CCB_NATIVE_CHANNEL_ID
    const channel = useNativeCcbConfiguration
      ? undefined
      : getChannelById(sessionChannelId)
    if (!useNativeCcbConfiguration && (!channel || !channel.enabled)) {
      throw new Error('会话渠道不存在或已禁用')
    }
    const codexCredentials = channel?.provider === 'openai-codex'
      ? await resolveCodexOAuthCredentials(channel.id)
      : undefined
    const apiKey = channel
      ? codexCredentials?.access ?? decryptApiKey(channel.id)
      : undefined
    const providerConfiguration = channel
      ? buildCcbProviderConfiguration(channel, sessionMeta.modelId)
      : buildCcbNativeProviderConfiguration()
    const selectedModelId =
      providerConfiguration.defaultModel
      ?? sessionMeta.modelId
      ?? DEFAULT_MODEL_ID
    const proxyUrl = await getEffectiveProxyUrl()
    const runtimeEnv = this.buildCcbRuntimeEnv(
      apiKey,
      channel?.baseUrl,
      channel?.provider,
      selectedModelId,
      proxyUrl,
      codexCredentials,
    )
    const workspace = sessionMeta.workspaceId
      ? getAgentWorkspace(sessionMeta.workspaceId)
      : undefined
    const cwd = workspace
      ? (workspace.canonicalPath || workspace.path)
      : homedir()
    const mcpServers = this.buildMcpServers(workspace?.slug)
    if (isBuiltinMcpUserEnabled('chrome-devtools')) {
      injectChromeDevtoolsMcpServer(mcpServers)
    }
    return {
      sessionId: sessionMeta.id,
      runtimeSessionId: sessionMeta.runtimeSessionId,
      cwd,
      model: selectedModelId,
      providerConfiguration,
      thinkingConfig: getSettings().agentThinking,
      effortLevel: getSettings().agentThinkingEffortLevel,
      env: runtimeEnv.env,
      permissionMode: sessionMeta.permissionMode ?? PROMA_DEFAULT_PERMISSION_MODE,
      mcpServers,
      additionalSkillDirectories: workspace
        ? [getWorkspaceSkillsDir(workspace.slug)]
        : [],
    }
  }

  async forkSession(input: ForkSessionInput): Promise<AgentSessionMeta> {
    if (this.activeSessions.has(input.sessionId)) {
      throw new Error('会话正在运行中，请停止后再分叉')
    }
    if (!this.adapter.forkSession) {
      throw new Error('当前 Runtime 不支持 Session 分叉')
    }
    const sourceMeta = getAgentSessionMeta(input.sessionId)
    if (!sourceMeta) throw new Error(`源 Agent 会话不存在: ${input.sessionId}`)
    const operationInput = await this.buildRuntimeSessionOperationInput(sourceMeta)
    const result = await this.adapter.forkSession(
      operationInput,
      input.upToMessageUuid,
    )
    return createForkedAgentSessionProjection(input, result.runtimeSessionId)
  }

  /** 使用 CCB Runtime 原生能力同时回退文件和会话上下文。 */
  async rewindSession(
    sessionId: string,
    assistantMessageUuid: string,
  ): Promise<RewindSessionResult> {
    if (this.activeSessions.has(sessionId)) {
      throw new Error('会话正在运行中，请停止后再回退')
    }
    if (!this.adapter.rewindSession) {
      throw new Error('当前 Runtime 不支持 Session 回退')
    }
    const sessionMeta = getAgentSessionMeta(sessionId)
    if (!sessionMeta) throw new Error(`Agent 会话不存在: ${sessionId}`)
    const operationInput = await this.buildRuntimeSessionOperationInput(sessionMeta)
    const result = await this.adapter.rewindSession(
      operationInput,
      assistantMessageUuid,
    )
    const kept = truncateSDKMessages(sessionId, assistantMessageUuid)
    updateAgentSessionMeta(sessionId, {
      runtimeSessionId: result.runtimeSessionId,
      resumeAtMessageUuid: result.resumeAtMessageUuid,
    })
    console.log(
      `[Agent 编排] CCB Runtime 回退完成: sessionId=${sessionId}, runtime=${result.runtimeSessionId}, 保留 ${kept.length} 条消息`,
    )
    return {
      remainingMessages: kept.length,
      fileRewind: { canRewind: true },
    }
  }

  /** 中止所有活跃的 Agent 会话（应用退出时调用） */
  stopAll(): void {
    if (this.activeSessions.size > 0) {
      console.log(`[Agent 编排] 正在中止所有活跃会话 (${this.activeSessions.size} 个)...`)
    }
    // 即便 activeSessions 为空，也要调 dispose 清理可能残留的 pidMap / 子进程
    this.adapter.dispose()
    this.activeSessions.clear()
    this.sessionPermissionModes.clear()
    this.queuedMessageUuids.clear()
  }

  // ===== 队列消息管理 =====

  /**
   * 流式追加消息
   *
   * 在 Agent 运行中注入用户消息到 SDK，使用 'now' 优先级立即处理。
   * 消息立即持久化到 JSONL。
   *
   * @returns 消息 UUID
   */
  async queueMessage(
    sessionId: string,
    text: string,
    rawText?: string,
    _priority?: string,
    presetUuid?: string,
    opts?: { interrupt?: boolean },
    mentionedSkills?: string[],
    mentionedMcpServers?: string[],
    mentionedSessionIds?: string[],
  ): Promise<string> {
    if (!this.activeSessions.has(sessionId)) {
      throw new Error(`[Agent 编排] 会话未运行，无法追加消息: ${sessionId}`)
    }

    if (!this.adapter.sendQueuedMessage) {
      throw new Error('[Agent 编排] 当前适配器不支持流式追加消息')
    }

    // 注入 mention 引用指令（Skill/MCP/会话）— 与 sendMessage 路径保持一致的 prompt 加工
    const meta = getAgentSessionMeta(sessionId)
    const workspaceSlug = meta?.workspaceId
      ? getAgentWorkspace(meta.workspaceId)?.slug
      : undefined

    let enrichedText = text
    const referencedSessionsBlock = buildReferencedSessionsPrompt(sessionId, mentionedSessionIds, workspaceSlug)
    if (referencedSessionsBlock) {
      enrichedText = `${referencedSessionsBlock}\n\n${enrichedText}`
    }
    if (mentionedSkills?.length || mentionedMcpServers?.length) {
      const toolLines: string[] = ['用户在消息中明确引用了以下工具，请在本次回复中主动调用：']
      for (const slug of mentionedSkills ?? []) {
        toolLines.push(`- Skill: ${slug}（请立即调用此 Skill）`)
      }
      for (const name of mentionedMcpServers ?? []) {
        toolLines.push(`- MCP 服务器: ${name}（请使用此 MCP 服务器的工具来完成任务）`)
      }
      enrichedText = `<mentioned_tools>\n${toolLines.join('\n')}\n</mentioned_tools>\n\n${enrichedText}`
    }

    const uuid = presetUuid || randomUUID()

    // 防重记录
    const uuids = this.queuedMessageUuids.get(sessionId) ?? new Set<string>()
    uuids.add(uuid)
    this.queuedMessageUuids.set(sessionId, uuids)

    // 构造 SDKUserMessage 并注入（强制 'now' 优先级）
    const sdkMessage = {
      type: 'user' as const,
      message: { role: 'user' as const, content: enrichedText },
      parent_tool_use_id: null,
      priority: 'now' as const,
      uuid,
      session_id: sessionId,
    }

    try {
      // 用户希望"立即打断当前输出并续跑新消息"：先软中断，再把消息压入通道
      // - interrupt() 让 SDK 结束当前 turn 并 yield 一个 aborted result
      // - 随后通道里的 'now' 消息会作为下一轮 turn 的用户输入被消费
      if (opts?.interrupt && this.adapter.interruptQuery) {
        try {
          await this.adapter.interruptQuery(sessionId)
        } catch (error) {
          console.warn(`[Agent 编排] 软中断失败（将继续追加消息）:`, error)
        }
      }

      await this.adapter.sendQueuedMessage(sessionId, sdkMessage)
      console.log(`[Agent 编排] 追加消息已注入: sessionId=${sessionId}, uuid=${uuid}, interrupt=${!!opts?.interrupt}`)

      // 立即持久化到 JSONL — 仅存原始文本，不含 prompt 工程块（与 sendMessage 路径一致）
      const persistMsg: SDKMessage = {
        type: 'user',
        uuid,
        message: {
          content: [{ type: 'text', text: rawText ?? text }],
        },
        parent_tool_use_id: null,
        _createdAt: Date.now(),
      } as unknown as SDKMessage
      appendSDKMessages(sessionId, [persistMsg])
    } catch (error) {
      uuids.delete(uuid)
      if (isMissingActiveQueueChannelError(error)) {
        console.warn(`[Agent 编排] 队列注入失败且消息通道已失效，释放陈旧运行状态: sessionId=${sessionId}`)
        this.activeSessions.delete(sessionId)
        this.sessionPermissionModes.delete(sessionId)
        this.queuedMessageUuids.delete(sessionId)
      }
      throw error
    }

    return uuid
  }
}
