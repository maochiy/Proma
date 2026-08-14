/**
 * Proma Pi Bridge 适配器。
 *
 * Pi Runtime（pi-bridge + pi-worker + thread-context-v2）已内置到
 * `resources/pi-runtime/`，默认直接使用内置版本；仅当显式配置
 * `PROMA_PI_RUNTIME_PATH` / Runtime 源码目录时才回退到外部路径，
 * 保持工具、Session 和 Pi 原生事件协议一致。
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  AgentProviderAdapter,
  AgentQueryInput,
  AgentRuntimeSessionOperationInput,
  SDKContentBlock,
  SDKMessage,
  SDKSystemMessage,
  SDKUserMessageInput,
  SendQueuedMessageOptions,
} from '@proma/shared'
import { getRuntimeSessionsDir } from '../config-paths'
import type { RuntimeModelRoute } from '@proma/shared'
import { getActiveRuntimePackage, getRuntimeConfig } from './runtime-registry'
import { PiMcpBridge } from './pi-mcp-bridge'

interface MessageQueue {
  iterable: AsyncIterable<SDKMessage>
  push(message: SDKMessage): void
  finish(): void
  fail(error: Error): void
}

interface FrakioPiEvent {
  type?: string
  payload?: Record<string, unknown>
}

interface FrakioPiBridge {
  on(event: 'event' | 'exit', callback: (value: unknown) => void): void
  startRun(payload: Record<string, unknown>): Promise<Record<string, unknown>>
  steer(sessionId: string, message: string): Promise<unknown>
  cancel(sessionId: string): Promise<unknown>
  compact(sessionId: string, input?: Record<string, unknown>): Promise<unknown>
  disposeSession(sessionId: string): Promise<unknown>
  close(): Promise<void>
}

interface FrakioPiBridgeModule {
  createPiBridge(input: Record<string, unknown>): FrakioPiBridge
}

interface PiRuntimeQueryOptions extends AgentQueryInput {
  env?: Record<string, string | undefined>
  effortLevel?: string
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string }
  onSessionId?: (sessionId: string) => void
}

function compactTrigger(value: unknown): 'manual' | 'auto' {
  return value === 'threshold' || value === 'auto_compact_start' || value === 'auto_compaction'
    ? 'auto'
    : 'manual'
}

function usageNumber(payload: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return undefined
}

/** 把 Pi 原生 context.compaction.* 事件转换为统一的 SDK system 消息。 */
export function compactionSystemMessage(
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown>,
): SDKMessage {
  if (eventType === 'context.compaction.started') {
    return {
      type: 'system',
      subtype: 'compacting',
      session_id: sessionId,
      uuid: randomUUID(),
      compactTrigger: compactTrigger(payload.trigger),
      compactPreTokens: usageNumber(payload, 'tokensBefore', 'preTokens'),
    } as SDKMessage
  }
  const failed = eventType === 'context.compaction.failed'
  const estimatedTokensAfter = usageNumber(payload, 'tokensAfterEstimate', 'estimatedTokensAfter', 'postTokens')
  return {
    type: 'system',
    subtype: failed ? 'status' : 'compact_boundary',
    session_id: sessionId,
    uuid: randomUUID(),
    compactTrigger: compactTrigger(payload.trigger),
    compactPreTokens: usageNumber(payload, 'tokensBefore', 'preTokens'),
    ...(estimatedTokensAfter != null ? { compactionEstimatedTokensAfter: estimatedTokensAfter } : {}),
    ...(failed
      ? { compact_result: 'failed', compact_error: String(payload.error || '上下文压缩失败') }
      : { compact_metadata: {
          trigger: compactTrigger(payload.trigger),
          pre_tokens: usageNumber(payload, 'tokensBefore', 'preTokens'),
          post_tokens: estimatedTokensAfter,
        } }),
  } as SDKMessage
}

/** 把 Pi 原生 context.usage.updated 事件转换为 SDK assistant usage 消息。 */
export function usageSystemMessage(
  sessionId: string,
  payload: Record<string, unknown>,
): SDKMessage {
  const inputTokens = usageNumber(payload, 'inputTokens', 'input_tokens')
  const outputTokens = usageNumber(payload, 'outputTokens', 'output_tokens')
  const cacheReadTokens = usageNumber(payload, 'cacheReadTokens', 'cacheRead', 'cache_read_input_tokens')
  const cacheWriteTokens = usageNumber(payload, 'cacheWriteTokens', 'cacheWrite', 'cache_creation_input_tokens')
  const contextWindow = usageNumber(payload, 'contextWindow', 'context_window')
  return {
    type: 'assistant',
    message: {
      content: [],
      usage: {
        input_tokens: inputTokens ?? 0,
        output_tokens: outputTokens ?? 0,
        ...(cacheReadTokens != null ? { cache_read_input_tokens: cacheReadTokens } : {}),
        ...(cacheWriteTokens != null ? { cache_creation_input_tokens: cacheWriteTokens } : {}),
        ...(contextWindow != null ? { context_window: contextWindow } : {}),
      },
    },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: randomUUID(),
  } as SDKMessage
}

/**
 * 把模型路由里的压缩策略转换为 Renderer 可复用的 context_compaction_config
 * system 消息（与 CCB 适配器同一 subtype），供输入框上下文 Usage 徽标展示。
 *
 * 只有 enabled / threshold / contextWindow 三者齐全时才生成；该 subtype 可持久化，
 * 刷新会话后渲染层仍能还原压缩阈值。
 */
export function contextCompactionConfigMessage(
  compilation: NonNullable<RuntimeModelRoute['compaction']> | undefined,
  sessionId: string,
): SDKMessage | undefined {
  if (!compilation?.enabled) return undefined
  const threshold = compilation.threshold
  const contextWindow = compilation.contextWindow
  if (typeof threshold !== 'number' || typeof contextWindow !== 'number') return undefined
  return {
    type: 'system',
    subtype: 'context_compaction_config',
    session_id: sessionId,
    uuid: randomUUID(),
    autoCompactEnabled: true,
    autoCompactThreshold: threshold,
    effectiveContextWindow: contextWindow,
  } as unknown as SDKSystemMessage
}

function createQueue(): MessageQueue {
  const values: SDKMessage[] = []
  const waiters: Array<{
    resolve: (result: IteratorResult<SDKMessage>) => void
    reject: (error: Error) => void
  }> = []
  let finished = false
  let failure: Error | undefined
  return {
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<SDKMessage>> {
            const value = values.shift()
            if (value) return Promise.resolve({ value, done: false })
            if (failure) return Promise.reject(failure)
            if (finished) return Promise.resolve({ value: undefined, done: true })
            return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
          },
        }
      },
    },
    push(message) {
      const waiter = waiters.shift()
      if (waiter) waiter.resolve({ value: message, done: false })
      else values.push(message)
    },
    finish() {
      finished = true
      for (const waiter of waiters.splice(0)) waiter.resolve({ value: undefined, done: true })
    },
    fail(error) {
      failure = error
      for (const waiter of waiters.splice(0)) waiter.reject(error)
    },
  }
}

function textBlock(text: string): SDKContentBlock {
  return { type: 'text', text }
}

function thinkingBlock(thinking: string): SDKContentBlock {
  return { type: 'thinking', thinking }
}

function assistantMessage(
  sessionId: string,
  text: string,
  thinking: string,
  partial: boolean,
  uuid: string,
  messageId: string,
): SDKMessage {
  const content: SDKContentBlock[] = []
  if (thinking) content.push(thinkingBlock(thinking))
  if (text) content.push(textBlock(text))
  return {
    type: 'assistant',
    // message.id 是渲染层 liveMessages 去重（removeSupersededPartialMessages）
    // 与 Proma 历史路径 mergePersistedAndLiveMessages 共同的 assistant 身份字段，
    // 同一轮回复 partial 与 final 必须共享同一个 id，否则 token 会被重复落盘 / 铺开渲染。
    message: { id: messageId, content },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid,
    ...(partial ? { _partial: true } : {}),
  } as SDKMessage
}

function resultMessage(sessionId: string, output: string, error = ''): SDKMessage {
  return {
    type: 'result',
    subtype: error ? 'error_during_execution' : 'success',
    result: output,
    errors: error ? [error] : undefined,
    usage: { input_tokens: 0, output_tokens: 0 },
    session_id: sessionId,
  } as SDKMessage
}

function eventText(payload: Record<string, unknown>): string {
  return typeof payload.delta === 'string'
    ? payload.delta
    : typeof payload.text === 'string' ? payload.text : ''
}

function providerFor(env: Record<string, string | undefined>): string {
  if (env.PROMA_RUNTIME_MODEL_PROVIDER) return env.PROMA_RUNTIME_MODEL_PROVIDER
  if (env.PROMA_MODEL_CENTER_PROVIDER) return env.PROMA_MODEL_CENTER_PROVIDER
  if (env.FRAKIO_MODEL_CENTER_PROVIDER) return env.FRAKIO_MODEL_CENTER_PROVIDER
  if (env.FRAKIO_MODEL_ROUTE_BASE_URL) return 'openai'
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return 'anthropic'
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) return 'google'
  return 'openai'
}

function apiModeFor(provider: string): string {
  if (provider === 'anthropic') return 'anthropic_messages'
  if (provider === 'google') return 'google_generative_language'
  return 'openai_responses'
}

function systemPromptText(value: PiRuntimeQueryOptions['systemPrompt']): string {
  return typeof value === 'string' ? value : value?.append || ''
}

function knownRuntimeVersion(value: string | null | undefined): string {
  const version = String(value || '').trim()
  return version && version.toLowerCase() !== 'unknown' ? version : ''
}

function findPiWorkerCompatShim(): string | null {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'pi-worker-compat.cjs') : '',
    join(__dirname, 'resources', 'pi-worker-compat.cjs'),
    join(process.cwd(), 'resources', 'pi-worker-compat.cjs'),
    join(process.cwd(), 'apps', 'electron', 'resources', 'pi-worker-compat.cjs'),
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) || null
}

/**
 * 解析内置 Pi Runtime 目录（pi-bridge.mjs 所在目录）。
 *
 * 优先使用显式覆盖（PROMA_PI_RUNTIME_PATH / Runtime 源码目录），
 * 否则回退到内置 `resources/pi-runtime/`。与 ccb-runtime 的双模式定位一致：
 * - 生产：`process.resourcesPath/pi-runtime`
 * - 开发：`apps/electron/resources/pi-runtime`（build:resources 复制到 dist/resources/）
 */
function resolvePiRuntimeDir(config: { runtimeSourceHome?: string | null; frakioSourceHome?: string | null }): string {
  const override = process.env.PROMA_PI_RUNTIME_PATH?.trim()
  if (override) {
    const dir = isAbsolute(override) ? override : resolve(override)
    if (existsSync(join(dir, 'pi-bridge.mjs'))) return dir
  }
  // 兼容旧的 Frakio 源码目录配置（外部 runtime），仅在显式配置时启用。
  const sourceHome = config.runtimeSourceHome || config.frakioSourceHome || ''
  if (sourceHome) {
    const externalDir = join(sourceHome, 'apps', 'api', 'runtime')
    if (existsSync(join(externalDir, 'pi-bridge.mjs'))) return externalDir
  }
  const bundledCandidates = [
    process.resourcesPath ? join(process.resourcesPath, 'pi-runtime') : '',
    join(__dirname, 'resources', 'pi-runtime'),
    join(process.cwd(), 'resources', 'pi-runtime'),
    join(process.cwd(), 'apps', 'electron', 'resources', 'pi-runtime'),
  ].filter(Boolean)
  const bundled = bundledCandidates.find((candidate) => existsSync(join(candidate, 'pi-bridge.mjs')))
  return bundled || bundledCandidates[0] || ''
}

/**
 * 解析 Pi Worker 加载 @earendil-works/* / typebox 等 npm 包时的根目录。
 * Worker 内部用 `<runtimeRoot>/node_modules/<pkg>` 解析依赖，因此这里返回
 * 应用 node_modules 的上级目录。内置模式下这些依赖随应用 node_modules 分发。
 */
function resolvePiDependencyRoot(configuredHome: string): string {
  const override = process.env.PROMA_PI_DEPENDENCY_ROOT?.trim()
  if (override) return isAbsolute(override) ? override : resolve(override)
  const candidates = [
    // 生产：fork 的 Worker 无法读取 ASAR 内文件，必须使用 ASAR 外的
    // app.asar.unpacked/node_modules（@earendil-works/* 已在 asarUnpack 列出）。
    process.resourcesPath ? join(process.resourcesPath, 'app.asar.unpacked') : '',
    // 生产回退：非 ASAR 分发时的 app/node_modules
    process.resourcesPath ? join(process.resourcesPath, 'app') : '',
    // 开发：apps/electron/（其 node_modules 由 workspace 链接）
    join(process.cwd(), 'apps', 'electron'),
    // 开发（electron 以 apps/electron 为 cwd）：workspace 根 node_modules
    join(process.cwd(), '..', '..'),
    // __dirname = apps/electron/dist，向上两级到 workspace 根
    join(__dirname, '..', '..', '..'),
    process.cwd(),
  ].filter(Boolean)
  const found = candidates.find((candidate) =>
    existsSync(join(candidate, 'node_modules', '@earendil-works', 'pi-coding-agent')))
  return found || configuredHome || candidates[candidates.length - 1] || process.cwd()
}

function withPiWorkerCompatShim(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const shimPath = findPiWorkerCompatShim()
  if (!shimPath) return env
  const requireFlag = `--require=${shimPath}`
  const nodeOptions = env.NODE_OPTIONS || process.env.NODE_OPTIONS || ''
  if (nodeOptions.split(/\s+/).includes(requireFlag)) return env
  return {
    ...env,
    NODE_OPTIONS: `${nodeOptions} ${requireFlag}`.trim(),
  }
}

export class FrakioPiRuntimeAdapter implements AgentProviderAdapter {
  private readonly bridges = new Map<string, FrakioPiBridge>()
  private readonly mcpBridges = new Map<string, PiMcpBridge>()
  /** sessionId → Pi 原生 sessionFile 路径，用于跨轮/跨进程恢复 Pi 会话历史 */
  private readonly sessionFiles = new Map<string, string>()
  private sessionFilesLoaded = false

  query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    const queue = createQueue()
    void this.run(input as PiRuntimeQueryOptions, queue)
    return queue.iterable
  }

  async abort(sessionId: string): Promise<void> {
    await this.bridges.get(sessionId)?.cancel(sessionId)
  }

  async closeSession(sessionId: string): Promise<void> {
    const bridge = this.bridges.get(sessionId)
    if (!bridge) return
    await bridge.disposeSession(sessionId).catch(() => {})
    await bridge.close().catch(() => {})
    this.bridges.delete(sessionId)
    const mcpBridge = this.mcpBridges.get(sessionId)
    if (mcpBridge) {
      await mcpBridge.dispose().catch(() => {})
      this.mcpBridges.delete(sessionId)
    }
  }

  async interruptQuery(sessionId: string): Promise<void> {
    await this.abort(sessionId)
  }

  async sendQueuedMessage(
    sessionId: string,
    message: SDKUserMessageInput,
    _options?: SendQueuedMessageOptions,
  ): Promise<void> {
    const bridge = this.bridges.get(sessionId)
    if (!bridge) throw new Error('Proma Pi Session 尚未打开。')
    await bridge.steer(sessionId, message.message.content)
  }

  async compactSession(input: AgentRuntimeSessionOperationInput, instructions?: string): Promise<void> {
    const bridge = this.bridges.get(input.sessionId)
    if (!bridge) throw new Error('Proma Pi Session 尚未打开。')
    await bridge.compact(input.sessionId, { instructions: instructions || '' })
  }

  private sessionFilesPath(): string {
    return join(getRuntimeSessionsDir(), 'pi', 'session-files.json')
  }

  private loadSessionFiles(): void {
    if (this.sessionFilesLoaded) return
    this.sessionFilesLoaded = true
    try {
      const filePath = this.sessionFilesPath()
      if (!existsSync(filePath)) return
      const data = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>
      for (const [sessionId, sessionFile] of Object.entries(data)) {
        if (typeof sessionFile === 'string' && existsSync(sessionFile)) {
          this.sessionFiles.set(sessionId, sessionFile)
        }
      }
    } catch { /* 读取失败则视为无历史，正常新建 */ }
  }

  private persistSessionFiles(): void {
    try {
      const filePath = this.sessionFilesPath()
      mkdirSync(join(getRuntimeSessionsDir(), 'pi'), { recursive: true })
      writeFileSync(filePath, JSON.stringify(Object.fromEntries(this.sessionFiles), null, 2), 'utf8')
    } catch { /* 持久化失败不影响主流程 */ }
  }

  dispose(): void {
    for (const sessionId of this.bridges.keys()) void this.closeSession(sessionId)
  }

  private async run(input: PiRuntimeQueryOptions, queue: MessageQueue): Promise<void> {
    this.loadSessionFiles()
    const config = getRuntimeConfig()
    const runtimeDir = resolvePiRuntimeDir(config)
    const bridgeModulePath = join(runtimeDir, 'pi-bridge.mjs')
    if (!existsSync(bridgeModulePath)) {
      queue.fail(new Error(`未找到 Proma Pi Bridge：${bridgeModulePath}`))
      return
    }
    try {
      const module = await import(pathToFileURL(bridgeModulePath).href) as unknown as FrakioPiBridgeModule
      const env = input.env || {}
      const activePackage = await getActiveRuntimePackage('pi').catch(() => null)
      const runtimeRoot = activePackage?.runtimeDir
        || env.FRAKIO_PI_RUNTIME_ROOT
        || resolvePiDependencyRoot(config.runtimeHome || '')
      const runtimeVersion = knownRuntimeVersion(activePackage?.runtimeVersion)
        || knownRuntimeVersion(env.FRAKIO_PI_RUNTIME_VERSION)
      const bridgeEnv = withPiWorkerCompatShim({
        PROMA_RUNTIME_HOME: config.runtimeHome || '',
        ...(env.PROMA_RUNTIME_API_KEY ? { PROMA_RUNTIME_API_KEY: env.PROMA_RUNTIME_API_KEY } : {}),
        ...(env.FRAKIO_RUNTIME_TOKEN ? { FRAKIO_RUNTIME_TOKEN: env.FRAKIO_RUNTIME_TOKEN } : {}),
      })
      // 连接 Proma 编译好的 MCP HTTP 端点（含 collaboration 子 Agent 工具），
      // 列出工具并经 toolHandler 桥接给 Pi Worker。
      // 同一 session 跨轮复用 PiMcpBridge：Proma 内置 MCP HTTP Host 是 stateful
      // 单会话端点，重复 connect 会被 server 以 "Server already initialized" 拒绝，
      // 导致第二轮及以后 externalTools 为空、browser 等 MCP 工具全部 not found。
      const mcpBridge = this.mcpBridges.get(input.sessionId) || new PiMcpBridge()
      const externalTools = await mcpBridge.collectExternalTools(input.mcpServers).catch(() => [])
      const bridge = module.createPiBridge({
        toolHandler: (name: string, params: Record<string, unknown>) => mcpBridge.handleToolCall(name, params),
        runtimeBinding: {
          runtimeId: 'pi',
          // unknown 只是 Runtime Center 的展示占位值，不能作为 Worker
          // 的严格版本断言，否则会把已加载的 Pi 版本误判为不兼容。
          runtimeVersion,
          runtimeBuildId: activePackage?.runtimeBuildId
            || env.FRAKIO_PI_RUNTIME_BUILD_ID
            || 'proma-source',
          runtimeDir: runtimeRoot,
          adapterProtocolVersion: 1,
        },
        env: bridgeEnv,
      })
      this.bridges.set(input.sessionId, bridge)
      this.mcpBridges.set(input.sessionId, mcpBridge)
      // 把模型路由里的压缩策略作为可持久化的 system 消息先推给主进程，
      // 让输入框上下文 Usage 徽标能读取（与 CCB 适配器行为对齐）；
      // 刷新会话后该消息仍在 JSONL 中，压缩阈值不会丢失。
      const compactionConfigMessage = contextCompactionConfigMessage(
        input.modelRoute?.compaction,
        input.sessionId,
      )
      if (compactionConfigMessage) queue.push(compactionConfigMessage)
      const piSessionRoot = join(getRuntimeSessionsDir(), 'pi', 'sessions')
      const piAgentDir = join(getRuntimeSessionsDir(), 'pi', 'agents', input.sessionId)
      let output = ''
      let reasoning = ''
      let settled = false
      // Pi Worker 推的是增量 delta（不是累计文本），同一轮回复需要用同一个
      // uuid 让主进程 latestPartialAssistants 覆盖机制生效，否则每个 token
      // 都会被固化为独立 assistant 消息，渲染时全部换行（不走 Proma 标准
      // 消息气泡）。终态消息沿用同一个 uuid，自动把 partial 从 Map 里清掉。
      const streamMessageUuid = randomUUID()
      const streamMessageId = `pi-${input.sessionId}-${streamMessageUuid}`
      bridge.on('event', (value) => {
        const message = value as { event?: FrakioPiEvent }
        const event = message.event
        const payload = event?.payload || {}
        if (event?.type === 'context.compaction.started') {
          queue.push(compactionSystemMessage(input.sessionId, event.type, payload))
        } else if (
          event?.type === 'context.compaction.completed'
          || event?.type === 'context.compaction.failed'
        ) {
          queue.push(compactionSystemMessage(input.sessionId, event.type, payload))
        } else if (event?.type === 'context.usage.updated') {
          queue.push(usageSystemMessage(input.sessionId, payload))
        } else if (event?.type === 'message.delta' || event?.type === 'reasoning.summary') {
          const text = eventText(payload)
          if (text) {
            if (event.type === 'reasoning.summary') reasoning += text
            else output += text
            // 推累计文本 + 固定 uuid，渲染层走 text_complete 替换语义，
            // 主进程 partial Map 也只会保留最新一份，落盘为单条消息。
            queue.push(assistantMessage(input.sessionId, output, reasoning, true, streamMessageUuid, streamMessageId))
          }
        } else if (event?.type === 'tool.started') {
          queue.push({
            type: 'assistant',
            message: {
              content: [{
                type: 'tool_use',
                id: String(payload.toolCallId || randomUUID()),
                name: String(payload.toolName || 'Pi Tool'),
                input: (payload.args && typeof payload.args === 'object' ? payload.args : {}) as Record<string, unknown>,
              }],
            },
            parent_tool_use_id: null,
            session_id: input.sessionId,
            uuid: randomUUID(),
          } as SDKMessage)
        } else if (event?.type === 'tool.completed') {
          queue.push({
            type: 'user',
            message: {
              content: [{
                type: 'tool_result',
                tool_use_id: String(payload.toolCallId || randomUUID()),
                content: String(payload.resultPreview || ''),
                is_error: Boolean(payload.isError),
              }],
            },
            parent_tool_use_id: null,
            session_id: input.sessionId,
            uuid: randomUUID(),
          } as SDKMessage)
        } else if (event?.type === 'run.completed' || event?.type === 'run.failed' || event?.type === 'run.cancelled') {
          if (settled) return
          settled = true
          const error = String(payload.error || '')
          if (output || reasoning) {
            queue.push(assistantMessage(input.sessionId, output, reasoning, false, streamMessageUuid, streamMessageId))
          }
          queue.push(resultMessage(input.sessionId, output, error))
          queue.finish()
        }
      })
      bridge.on('exit', (value) => {
        if (settled) return
        settled = true
        const error = value instanceof Error ? value : new Error('Proma Pi Worker 已退出。')
        queue.push(resultMessage(input.sessionId, output, error.message))
        // 已经推送结构化 result 后正常结束队列，避免同一错误再进入
        // AsyncIterator catch 路径，造成错误消息和 Toast 重复。
        queue.finish()
      })
      const accepted = await bridge.startRun({
        runId: input.sessionId,
        sessionId: input.sessionId,
        threadId: input.sessionId,
        cwd: input.cwd || process.cwd(),
        // Frakio Pi Worker 会在启动时用这两个目录创建 auth.json 和原生
        // Session 文件；缺失时 path.resolve(undefined) 会直接让 Worker 失败。
        agentDir: piAgentDir,
        sessionRoot: piSessionRoot,
        // 已有历史时传 sessionFile，让 Pi 用 SessionManager.open 恢复上下文（否则每轮都是空会话）
        ...(this.sessionFiles.get(input.sessionId) ? { sessionFile: this.sessionFiles.get(input.sessionId) } : {}),
        // Pi Worker 已通过 systemPromptOverride 接收 Proma System Prompt，
        // Context Packet 也通过 contextPacket 单独注入；这里仅传本轮用户指令，
        // 避免每轮把两份完整上下文再次写进 Pi 原生会话。
        prompt: input.compactRequest ? '' : input.prompt,
        compactOnly: input.compactRequest === true,
        thinkingLevel: input.effortLevel || 'medium',
        // Proma MCP 工具（collaboration 子 Agent delegate_* 等）暴露给 Pi Worker。
        externalTools,
        model: {
          providerId: input.modelRoute?.provider || providerFor(env),
          modelId: input.modelRoute?.modelId || input.model || 'default',
          modelName: input.modelRoute?.modelId || input.model || 'default',
          apiMode: input.modelRoute?.apiMode || apiModeFor(providerFor(env)),
          baseUrl: input.modelRoute?.baseUrl
            || env.PROMA_RUNTIME_MODEL_BASE_URL
            || env.PROMA_MODEL_CENTER_PROVIDER_BASE_URL
            || env.FRAKIO_MODEL_CENTER_PROVIDER_BASE_URL
            || env.FRAKIO_MODEL_ROUTE_BASE_URL
            || env.OPENAI_BASE_URL
            || env.ANTHROPIC_BASE_URL
            || env.GEMINI_BASE_URL
            || config.frakioApiBaseUrl
            || '',
          apiKey: env.PROMA_RUNTIME_API_KEY
            || env.FRAKIO_RUNTIME_TOKEN
            || env.OPENAI_API_KEY
            || env.ANTHROPIC_API_KEY
            || env.ANTHROPIC_AUTH_TOKEN
            || env.GEMINI_API_KEY
            || env.GOOGLE_API_KEY
            || '',
          // 把用户对模型配置的压缩阈值同步给后台 Pi 内核，让后台任务按同样阈值
          // 自动压缩；压缩事件不进入主会话 UI，只保证运行期上下文不超限。
          compaction: input.modelRoute?.compaction,
          // 模型上下文窗口：优先取压缩策略里的 contextWindow（来自渠道模型配置），
          // 让 Pi 内核按真实窗口计算压缩触发点，而不是用 worker 兜底的 128K。
          contextWindow: input.modelRoute?.compaction?.contextWindow,
        },
        profileSnapshot: {
          name: input.contextPacket?.profile.userName || 'Proma',
          role: 'Proma Pi 基础内核',
          soul: '遵循 Proma System Prompt 和 Hermes 策略路由。',
          scope: '普通对话、需求澄清和最终结果汇总。',
          revision: input.contextPacket?.packetId || 'proma',
        },
        contextPacket: input.contextPacket || {
          dispatchPolicy: { instruction: systemPromptText(input.systemPrompt) },
        },
      })
      const acceptedSessionFile = typeof accepted.sessionFile === 'string' && accepted.sessionFile ? accepted.sessionFile : ''
      if (acceptedSessionFile && this.sessionFiles.get(input.sessionId) !== acceptedSessionFile) {
        this.sessionFiles.set(input.sessionId, acceptedSessionFile)
        this.persistSessionFiles()
      }
      if (input.compactRequest) {
        try {
          await bridge.compact(input.sessionId, { instructions: '' })
          if (!settled) {
            settled = true
            queue.push(resultMessage(input.sessionId, ''))
            queue.finish()
          }
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error))
          if (!settled) {
            settled = true
            queue.push(resultMessage(input.sessionId, '', failure.message))
            queue.finish()
          }
        }
      }
      input.onSessionId?.(String(accepted.sessionId || input.sessionId))
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      queue.push(resultMessage(input.sessionId, '', failure.message))
      queue.finish()
    }
  }
}
