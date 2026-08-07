import { createHash } from 'node:crypto'
import type {
  AgentProviderAdapter,
  AgentQueryInput,
  AgentRuntimeProviderConfiguration,
  AgentRuntimeSessionOperationInput,
  AgentRuntimeForkResult,
  AgentRuntimeRewindResult,
  SDKMessage,
  SDKUserMessageInput,
  SendQueuedMessageOptions,
  PromaPermissionMode,
  ThinkingConfig,
  ThinkingEffortLevel,
} from '@proma/shared'
import type { CanUseToolOptions, PermissionResult } from '../agent-permission-service'
import { updateAgentSessionMeta } from '../agent-session-manager'
import { persistCodexOAuthCredentials } from '../channel-manager'
import {
  createContextCompactionConfigMessage,
  normalizeCcbCompactionMessage,
} from './ccb-compaction-message'
import {
  annotateCcbFinalAssistantMessage,
  applyCcbPartialAssistantEvent,
  createCcbPartialAssistantState,
  finalizeCcbPartialAssistantMessage,
  type CcbPartialAssistantState,
} from './ccb-partial-assistant'
import { ccbDesktopRuntimeClient } from './runtime-client'
import { sanitizeCcbSessionEnvironment } from './runtime-security'
import { createAdditionalSkillDirectoriesFingerprint } from './skill-directory-fingerprint'
import { getCcbUserConfigDir } from './user-config'
import {
  createSessionRuntimeConfigCommand,
  resolveCcbPermissionMode,
  type RuntimeConfigUpdate,
} from './runtime-config'
import {
  deferTurnResultMessage,
  releaseTurnBeforeNotify,
  resolveCompletedTurnResult,
} from './turn-lifecycle'
import { shouldRecoverSessionWorker } from './session-worker-recovery'
import { resolveFallbackModel } from './model-catalog-fallback'
import { normalizeCcbMessage } from './ccb-assistant-message-normalization'
import type {
  CcbInteractionResponse,
  CcbPermissionMode,
  CcbRuntimeEnvelope,
  CcbRuntimeEvent,
} from './protocol'

export interface CcbAgentQueryOptions extends AgentQueryInput {

  channelId?: string
  env?: Record<string, string | undefined>
  providerConfiguration?: AgentRuntimeProviderConfiguration
  thinkingConfig?: ThinkingConfig
  effortLevel?: ThinkingEffortLevel
  sdkPermissionMode?: PromaPermissionMode
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ) => Promise<PermissionResult>
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string }
  resumeSessionId?: string
  mcpServers?: Record<string, unknown>
  maxTurns?: number
  maxBudgetUsd?: number
  fallbackModel?: string
  onSessionId?: (sessionId: string) => void
  onModelResolved?: (model: string) => void
  onContextWindow?: (contextWindow: number) => void
  compactRequest?: boolean
}

interface AsyncMessageQueue {
  iterable: AsyncIterable<SDKMessage>
  push(message: SDKMessage): void
  finish(): void
  fail(error: Error): void
}

interface ActiveTurn {
  queue: AsyncMessageQueue
  resolve: () => void
  reject: (error: Error) => void
  settled: boolean
  compactRequested: boolean
  pendingResult?: SDKMessage
  interactionControllers: Set<AbortController>
  partialAssistantState: CcbPartialAssistantState
}

interface SessionRuntimeConfig {
  channelId?: string
  model?: string
  thinkingConfig?: ThinkingConfig
  effortLevel?: ThinkingEffortLevel
  providerFingerprint?: string
  cwd: string
  additionalSkillDirectoriesFingerprint: string
}

function sameThinkingConfig(
  left: ThinkingConfig | undefined,
  right: ThinkingConfig | undefined,
): boolean {
  if (left?.type !== right?.type) return false
  if (left?.type === 'enabled' && right?.type === 'enabled') {
    return left.budgetTokens === right.budgetTokens
  }
  return true
}

function sameRuntimeConfig(
  left: SessionRuntimeConfig | undefined,
  right: SessionRuntimeConfig,
): boolean {
  return Boolean(left)
    && left?.channelId === right.channelId
    && left?.model === right.model
    && left?.effortLevel === right.effortLevel
    && left?.providerFingerprint === right.providerFingerprint
    && left?.cwd === right.cwd
    && left?.additionalSkillDirectoriesFingerprint
      === right.additionalSkillDirectoriesFingerprint
    && sameThinkingConfig(left?.thinkingConfig, right.thinkingConfig)
}

function createProviderFingerprint(
  environment: Record<string, string>,
  configuration: AgentRuntimeProviderConfiguration | undefined,
): string | undefined {
  if (!configuration) return undefined
  const sortedEnvironment = Object.fromEntries(
    Object.entries(environment).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  )
  return createHash('sha256')
    .update(JSON.stringify({
      environment: sortedEnvironment,
      configuration,
    }))
    .digest('hex')
}

function createQueue(): AsyncMessageQueue {
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
            // 先排空已 push 的消息，再抛 failure。
            // 这样 turn 异常结束前固化的过程正文不会因为 fail() 被直接丢弃。
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
      for (const waiter of waiters.splice(0)) {
        waiter.resolve({ value: undefined, done: true })
      }
    },
    fail(error) {
      failure = error
      for (const waiter of waiters.splice(0)) waiter.reject(error)
    },
  }
}

export class CcbDesktopRuntimeAdapter implements AgentProviderAdapter {
  private readonly active = new Map<string, ActiveTurn>()
  private readonly openedSessions = new Map<string, string>()
  private readonly sessionRuntimeConfigs = new Map<string, SessionRuntimeConfig>()
  private readonly lastSequences = new Map<string, number>()
  private readonly invalidatedSessions = new Set<string>()
  private readonly unsubscribeLifecycle: () => void

  constructor() {
    // Turn 间隙也要接收 Worker 回收/崩溃通知，避免误判“Session 仍开着”而跳过 resume。
    this.unsubscribeLifecycle = ccbDesktopRuntimeClient.subscribeAll(envelope => {
      this.handleLifecycleEvent(envelope)
    })
    ccbDesktopRuntimeClient.setHostDiedHandler(() => {
      this.forgetAllOpenedSessions('crashed')
    })
  }

  query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    const options = input as CcbAgentQueryOptions
    const queue = createQueue()
    void this.run(options, queue)
    return queue.iterable
  }

  async abort(sessionId: string): Promise<void> {
    // CCB Worker 只会在 QueryEngine 已退出且 Session 回到 ready 后响应。
    // 因此该 Promise 是 Proma 与 Runtime 的停止同步边界。
    await ccbDesktopRuntimeClient.request(
      { type: 'turn.stop' },
      sessionId,
      15_000,
    )
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.closeOpenedSession(sessionId)
  }

  async interruptQuery(sessionId: string): Promise<void> {
    await ccbDesktopRuntimeClient.request({ type: 'turn.interrupt' }, sessionId, 5_000)
  }

  async sendQueuedMessage(
    sessionId: string,
    message: SDKUserMessageInput,
    options?: SendQueuedMessageOptions,
  ): Promise<void> {
    if (options?.interrupt) {
      await ccbDesktopRuntimeClient.request(
        { type: 'turn.interrupt', prompt: message.message.content, uuid: message.uuid },
        sessionId,
      )
    } else {
      await ccbDesktopRuntimeClient.request(
        {
          type: 'turn.enqueue',
          prompt: message.message.content,
          uuid: message.uuid,
          priority: message.priority,
        },
        sessionId,
      )
    }
    options?.onAccepted?.()
  }

  async setPermissionMode(sessionId: string, mode: string): Promise<void> {
    await ccbDesktopRuntimeClient.request(
      { type: 'session.setPermissionMode', mode: mode as CcbPermissionMode },
      sessionId,
    )
  }

  async updateRuntimeConfig(
    sessionId: string,
    updates: RuntimeConfigUpdate,
  ): Promise<boolean> {
    if (!this.openedSessions.has(sessionId)) return false
    console.log(
      `[CCB Runtime] 更新 Session 配置: session=${sessionId}, model=${updates.model ?? '保持不变'}, effort=${updates.effortLevel ?? '保持不变'}`,
    )
    await ccbDesktopRuntimeClient.request(
      createSessionRuntimeConfigCommand(updates),
      sessionId,
      5_000,
    )
    const current = this.sessionRuntimeConfigs.get(sessionId)
    if (current) {
      this.sessionRuntimeConfigs.set(sessionId, {
        ...current,
        model: updates.model ?? current.model,
        thinkingConfig: updates.thinkingConfig ?? current.thinkingConfig,
        effortLevel: updates.effortLevel ?? current.effortLevel,
      })
    }
    return true
  }

  /**
   * 使指定模型配置关联的长期 Session Worker 失效。
   *
   * 空闲 Worker 立即关闭；正在执行的 Turn 不会被打断，而是在完成后关闭，
   * 下一轮由 ensureSession 使用最新 Provider、凭证和模型目录恢复。
   */
  async invalidateChannelConfiguration(channelId: string): Promise<void> {
    const affectedSessionIds = [...this.sessionRuntimeConfigs.entries()]
      .filter(([, config]) => config.channelId === channelId)
      .map(([sessionId]) => sessionId)

    await Promise.all(affectedSessionIds.map(async sessionId => {
      if (this.active.has(sessionId)) {
        this.invalidatedSessions.add(sessionId)
        console.log(
          `[CCB Runtime] Session 配置已标记失效，当前 Turn 完成后刷新: session=${sessionId}, channel=${channelId}`,
        )
        return
      }
      await this.closeOpenedSession(sessionId)
      console.log(
        `[CCB Runtime] 已关闭使用旧模型配置的空闲 Session: session=${sessionId}, channel=${channelId}`,
      )
    }))
  }

  async getExecutionGraph(
    sessionId: string,
  ): Promise<import('@proma/shared').AgentRuntimeExecutionGraph> {
    if (!this.openedSessions.has(sessionId)) {
      return {
        nodes: [],
        todos: [],
        updatedAt: 0,
      }
    }
    return ccbDesktopRuntimeClient.request<
      import('@proma/shared').AgentRuntimeExecutionGraph
    >(
      { type: 'session.getExecutionGraph' },
      sessionId,
      10_000,
    )
  }

  async getSubagentTranscript(
    sessionId: string,
    executionNodeId: string,
  ): Promise<import('@proma/shared').AgentRuntimeSubagentTranscript> {
    if (!this.openedSessions.has(sessionId)) {
      throw new Error('CCB Session 尚未打开，无法读取子代理 Transcript')
    }
    const transcript = await ccbDesktopRuntimeClient.request<
      import('@proma/shared').AgentRuntimeSubagentTranscript
    >(
      { type: 'session.getSubagentTranscript', executionNodeId },
      sessionId,
      10_000,
    )
    return {
      ...transcript,
      messages: transcript.messages.map(normalizeCcbMessage),
    }
  }

  async forkSession(
    input: AgentRuntimeSessionOperationInput,
    upToMessageUuid?: string,
  ): Promise<AgentRuntimeForkResult> {
    await this.ensureOperationSession(input)
    return ccbDesktopRuntimeClient.request<AgentRuntimeForkResult>(
      { type: 'session.fork', upToMessageUuid },
      input.sessionId,
      60_000,
    )
  }

  async rewindSession(
    input: AgentRuntimeSessionOperationInput,
    messageUuid: string,
  ): Promise<AgentRuntimeRewindResult> {
    await this.ensureOperationSession(input)
    const result = await ccbDesktopRuntimeClient.request<AgentRuntimeRewindResult>(
      { type: 'session.rewind', messageUuid },
      input.sessionId,
      60_000,
    )
    this.openedSessions.set(input.sessionId, result.runtimeSessionId)
    return result
  }

  async compactSession(
    input: AgentRuntimeSessionOperationInput,
    instructions?: string,
  ): Promise<void> {
    await this.ensureOperationSession(input)
    await ccbDesktopRuntimeClient.request(
      { type: 'session.compact', instructions },
      input.sessionId,
      60_000,
    )
  }

  dispose(): void {
    this.unsubscribeLifecycle()
    ccbDesktopRuntimeClient.setHostDiedHandler(undefined)
    this.forgetAllOpenedSessions('cold')
    void ccbDesktopRuntimeClient.shutdown()
  }

  private async ensureOperationSession(
    input: AgentRuntimeSessionOperationInput,
  ): Promise<void> {
    const environment = sanitizeCcbSessionEnvironment(input.env)
    const nextRuntimeConfig: SessionRuntimeConfig = {
      channelId: this.sessionRuntimeConfigs.get(input.sessionId)?.channelId,
      model: input.model,
      thinkingConfig: input.thinkingConfig,
      effortLevel: input.effortLevel,
      cwd: input.cwd,
      additionalSkillDirectoriesFingerprint:
        createAdditionalSkillDirectoriesFingerprint(
          input.additionalSkillDirectories,
        ),
      providerFingerprint: createProviderFingerprint(
        environment,
        input.providerConfiguration,
      ),
    }
    let current = this.openedSessions.get(input.sessionId)
    const currentRuntimeConfig = this.sessionRuntimeConfigs.get(input.sessionId)
    if (
      current &&
      (
        !currentRuntimeConfig
        || currentRuntimeConfig.providerFingerprint !== nextRuntimeConfig.providerFingerprint
        || currentRuntimeConfig.cwd !== nextRuntimeConfig.cwd
        || currentRuntimeConfig.additionalSkillDirectoriesFingerprint
          !== nextRuntimeConfig.additionalSkillDirectoriesFingerprint
      )
    ) {
      await this.closeOpenedSession(input.sessionId)
      current = undefined
    }
    if (current === input.runtimeSessionId) {
      await this.syncSessionRuntimeConfig(input.sessionId, nextRuntimeConfig)
      return
    }
    const result = await ccbDesktopRuntimeClient.request<{ runtimeSessionId: string }>(
      {
        type: 'session.resume',
        options: {
          cwd: input.cwd,
          additionalSkillDirectories: input.additionalSkillDirectories,
          runtimeSessionId: input.runtimeSessionId,
          resume: true,
          model: input.model,
          fallbackModel: input.fallbackModel,
          thinkingConfig: input.thinkingConfig,
          effortLevel: input.effortLevel,
          permissionMode: resolveCcbPermissionMode(input.permissionMode),
          environment: {
            variables: environment,
            configDir: getCcbUserConfigDir(),
          },
          providerConfiguration: input.providerConfiguration,
          mcpServers: input.mcpServers,
          appendSystemPrompt: input.systemPrompt,
          includePartialMessages: true,
        },
      },
      input.sessionId,
      60_000,
    )
    this.openedSessions.set(input.sessionId, result.runtimeSessionId)
    this.sessionRuntimeConfigs.set(input.sessionId, nextRuntimeConfig)
  }

  private async run(options: CcbAgentQueryOptions, queue: AsyncMessageQueue): Promise<void> {
    const { sessionId } = options
    if (this.active.has(sessionId)) {
      queue.fail(new Error('该会话已有运行中的 CCB Turn'))
      return
    }
    let resolveTurn: () => void = () => undefined
    let rejectTurn: (error: Error) => void = () => undefined
    const completion = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve
      rejectTurn = reject
    })
    const active: ActiveTurn = {
      queue,
      resolve: resolveTurn,
      reject: rejectTurn,
      settled: false,
      compactRequested: options.compactRequest === true,
      interactionControllers: new Set(),
      partialAssistantState: createCcbPartialAssistantState(),
    }
    this.active.set(sessionId, active)
    const unsubscribe = ccbDesktopRuntimeClient.subscribe(sessionId, envelope => {
      if (envelope.sequence !== undefined) {
        const lastSequence = this.lastSequences.get(sessionId) ?? 0
        if (envelope.sequence <= lastSequence) return
        if (lastSequence > 0 && envelope.sequence !== lastSequence + 1) {
          console.warn(
            `[CCB Runtime] 检测到事件序号缺口: session=${sessionId}, ${lastSequence} -> ${envelope.sequence}`,
          )
        }
        this.lastSequences.set(sessionId, envelope.sequence)
      }
      void this.handleEvent(options, envelope, queue).catch(error => {
        this.settleTurn(
          sessionId,
          error instanceof Error ? error : new Error(String(error)),
        )
      })
    })
    const onAbort = (): void => {
      void ccbDesktopRuntimeClient
        .request({ type: 'turn.stop' }, sessionId, 15_000)
        .catch(error => {
          this.settleTurn(
            sessionId,
            error instanceof Error ? error : new Error(String(error)),
          )
        })
    }
    options.abortSignal?.addEventListener('abort', onAbort, { once: true })
    try {
      await this.ensureSession(options)
      if (!options.providerConfiguration && options.model) {
        options.onModelResolved?.(options.model)
      }
      await this.startTurnOrRecover(options)
      await completion
    } catch (error) {
      this.settleTurn(
        sessionId,
        error instanceof Error ? error : new Error(String(error)),
      )
    } finally {
      options.abortSignal?.removeEventListener('abort', onAbort)
      unsubscribe()
      if (this.active.get(sessionId) === active) this.active.delete(sessionId)
    }
  }

  private async ensureSession(
    options: CcbAgentQueryOptions,
    force = false,
  ): Promise<void> {
    const environment = sanitizeCcbSessionEnvironment(options.env)
    const nextRuntimeConfig: SessionRuntimeConfig = {
      channelId: options.channelId,
      model: options.model,
      thinkingConfig: options.thinkingConfig,
      effortLevel: options.effortLevel,
      cwd: options.cwd ?? process.cwd(),
      additionalSkillDirectoriesFingerprint:
        createAdditionalSkillDirectoriesFingerprint(
          options.additionalSkillDirectories,
        ),
      providerFingerprint: createProviderFingerprint(
        environment,
        options.providerConfiguration,
      ),
    }
    if (options.providerConfiguration) {
      const fallbackModel = resolveFallbackModel(
        options.providerConfiguration,
        options.model,
      )
      if (fallbackModel) {
        options.onModelResolved?.(fallbackModel.value)
        options.onContextWindow?.(fallbackModel.contextWindow)
      }
    }
    let current = this.openedSessions.get(options.sessionId)
    const currentRuntimeConfig = this.sessionRuntimeConfigs.get(
      options.sessionId,
    )
    if (
      current &&
      (
        !currentRuntimeConfig
        || currentRuntimeConfig.providerFingerprint !== nextRuntimeConfig.providerFingerprint
        || currentRuntimeConfig.cwd !== nextRuntimeConfig.cwd
        || currentRuntimeConfig.additionalSkillDirectoriesFingerprint
          !== nextRuntimeConfig.additionalSkillDirectoriesFingerprint
      )
    ) {
      await this.closeOpenedSession(options.sessionId)
      current = undefined
    }
    if (
      !force &&
      current &&
      (!options.resumeSessionId || current === options.resumeSessionId)
    ) {
      await this.syncSessionRuntimeConfig(
        options.sessionId,
        nextRuntimeConfig,
      )
      return
    }

    console.log(
      `[CCB Runtime] 打开 Session 配置: session=${options.sessionId}, model=${options.model ?? 'CCB 默认'}, effort=${options.effortLevel ?? 'CCB 默认'}, runtime=${ccbDesktopRuntimeClient.getRuntimeInfo()?.runtimeVersion ?? 'unknown'}`,
    )
    const openResult = await ccbDesktopRuntimeClient.request<{
      runtimeSessionId: string
    }>(
      {
        type: options.resumeSessionId ? 'session.resume' : 'session.open',
        options: {
          cwd: options.cwd ?? process.cwd(),
          additionalSkillDirectories: options.additionalSkillDirectories,
          runtimeSessionId: options.resumeSessionId,
          resume: Boolean(options.resumeSessionId),
          model: options.model,
          fallbackModel: options.fallbackModel,
          thinkingConfig: options.thinkingConfig,
          effortLevel: options.effortLevel,
          permissionMode: resolveCcbPermissionMode(options.sdkPermissionMode),
          environment: {
            variables: environment,
            configDir: getCcbUserConfigDir(),
          },
          providerConfiguration: options.providerConfiguration,
          mcpServers: options.mcpServers,
          systemPrompt:
            typeof options.systemPrompt === 'string'
              ? options.systemPrompt
              : undefined,
          appendSystemPrompt:
            typeof options.systemPrompt === 'object'
              ? options.systemPrompt.append
              : undefined,
          maxTurns: options.maxTurns,
          maxBudgetUsd: options.maxBudgetUsd,
          includePartialMessages: true,
        },
      },
      options.sessionId,
      60_000,
    )
    this.openedSessions.set(options.sessionId, openResult.runtimeSessionId)
    this.sessionRuntimeConfigs.set(options.sessionId, nextRuntimeConfig)
    options.onSessionId?.(openResult.runtimeSessionId)
    const runtime = ccbDesktopRuntimeClient.getRuntimeInfo()
    updateAgentSessionMeta(options.sessionId, {
      runtimeSessionId: openResult.runtimeSessionId,
      runtimeVersion: runtime?.runtimeVersion,
      runtimeArtifactCommit: runtime?.gitCommit,
      runtimeProtocolVersion: runtime?.protocolVersion,
      runtimeWorkerState: 'ready',
    })
  }

  private async closeOpenedSession(sessionId: string): Promise<void> {
    if (!this.openedSessions.has(sessionId)) return
    try {
      await ccbDesktopRuntimeClient.request(
        { type: 'session.close' },
        sessionId,
        10_000,
      )
    } finally {
      this.openedSessions.delete(sessionId)
      this.sessionRuntimeConfigs.delete(sessionId)
      this.lastSequences.delete(sessionId)
      this.invalidatedSessions.delete(sessionId)
    }
  }

  private async syncSessionRuntimeConfig(
    sessionId: string,
    config: SessionRuntimeConfig,
  ): Promise<void> {
    if (sameRuntimeConfig(this.sessionRuntimeConfigs.get(sessionId), config)) return
    console.log(
      `[CCB Runtime] 同步 Session 配置: session=${sessionId}, model=${config.model ?? 'CCB 默认'}, effort=${config.effortLevel ?? 'CCB 默认'}`,
    )
    await ccbDesktopRuntimeClient.request(
      createSessionRuntimeConfigCommand(config),
      sessionId,
      5_000,
    )
    this.sessionRuntimeConfigs.set(sessionId, {
      channelId: config.channelId,
      model: config.model,
      thinkingConfig: config.thinkingConfig,
      effortLevel: config.effortLevel,
      providerFingerprint: config.providerFingerprint,
      cwd: config.cwd,
      additionalSkillDirectoriesFingerprint:
        config.additionalSkillDirectoriesFingerprint,
    })
  }

  private async handleEvent(
    options: CcbAgentQueryOptions,
    envelope: CcbRuntimeEnvelope<CcbRuntimeEvent>,
    queue: AsyncMessageQueue,
  ): Promise<void> {
    const event = envelope.payload
    switch (event.type) {
      case 'runtime.message':
        // CCB 会先发送 result SDKMessage，再发送 turn.completed。若此时立即
        // 把 result 推给上层，UI 会提前解除“运行中”并允许下一轮发送，而
        // Adapter 的 active Turn 尚未释放，最终触发“已有运行中的 CCB Turn”。
        // 因此 result 必须延迟到 turn.completed，与 active 释放保持同一时序。
        if (
          deferTurnResultMessage(
            this.active.get(options.sessionId),
            event.message,
          )
        ) return
        {
          const normalizedMessage = normalizeCcbCompactionMessage(
            event.message,
            options.compactRequest === true,
          )
          if (normalizedMessage.type === 'stream_event') {
            const active = this.active.get(options.sessionId)
            if (!active) return
            const update = applyCcbPartialAssistantEvent(
              active.partialAssistantState,
              normalizedMessage,
            )
            active.partialAssistantState = update.state
            if (update.message) queue.push(update.message)
            return
          }
          if (normalizedMessage.type === 'assistant') {
            const active = this.active.get(options.sessionId)
            if (!active) return
            const update = annotateCcbFinalAssistantMessage(
              active.partialAssistantState,
              normalizedMessage,
            )
            active.partialAssistantState = update.state
            if (update.message) queue.push(update.message)
            return
          }
          queue.push(normalizedMessage)
        }
        return
      case 'runtime.progress': {
        if (event.phase !== 'context.compactionConfig') return
        const message = createContextCompactionConfigMessage(
          event.data,
          options.sessionId,
        )
        if (message) queue.push(message)
        return
      }
      case 'runtime.executionGraphChanged':
        queue.push({
          type: 'runtime_execution_graph',
          graph: event.graph,
          session_id: options.sessionId,
          uuid: `execution-graph-${event.graph.updatedAt}`,
        } as SDKMessage)
        return
      case 'turn.completed':
        {
          const active = this.active.get(options.sessionId)
          if (active && event.result) active.pendingResult = event.result
        }
        this.settleTurn(options.sessionId)
        return
      case 'turn.failed':
        this.settleTurn(options.sessionId, new Error(event.error.message))
        return
      case 'worker.crashed':
        // 生命周期监听也会处理本地 Worker 句柄；这里额外结束当前 Turn。
        this.forgetOpenedSession(options.sessionId, {
          workerState: 'crashed',
          clearSequence: true,
        })
        this.settleTurn(
          options.sessionId,
          new Error('CCB Runtime Worker 异常退出，未重放进行中的工具调用'),
        )
        return
      case 'runtime.credentialsUpdated':
        if (!options.channelId) {
          console.warn('[CCB Runtime] 收到凭证刷新事件，但当前 Turn 缺少 channelId')
          return
        }
        try {
          persistCodexOAuthCredentials(options.channelId, event.credentials)
        } catch (error) {
          console.warn('[CCB Runtime] 回写刷新后的 ChatGPT 凭证失败，当前 Turn 继续运行:', error)
        }
        return
      case 'session.stateChanged':
        // 常驻生命周期监听会统一更新 meta / openedSessions；Turn 内仅同步序号。
        if (envelope.sequence !== undefined) {
          this.lastSequences.set(options.sessionId, envelope.sequence)
        }
        return
      case 'interaction.permissionRequested':
        await this.resolvePermission(options, event.request.interactionId, event.request.toolName, event.request.input)
        return
      case 'interaction.askUserRequested':
        await this.resolvePermission(options, event.request.interactionId, 'AskUserQuestion', event.request.input)
        return
      case 'interaction.planApprovalRequested':
        await this.resolvePermission(options, event.request.interactionId, 'ExitPlanMode', event.request.input)
        return
      default:
        return
    }
  }

  private async resolvePermission(
    options: CcbAgentQueryOptions,
    interactionId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    let response: CcbInteractionResponse
    if (!options.canUseTool) {
      response = { outcome: 'deny', message: 'Proma 权限处理器不可用' }
    } else {
      const controller = new AbortController()
      const active = this.active.get(options.sessionId)
      active?.interactionControllers.add(controller)
      try {
        const result = await options.canUseTool(toolName, input, {
          signal: controller.signal,
          toolUseID: interactionId,
        })
        const planResult = result as PermissionResult & {
          targetMode?: PromaPermissionMode
        }
        response =
          result.behavior === 'allow'
            ? toolName === 'ExitPlanMode'
              ? {
                  outcome: 'approvePlan',
                  mode: planResult.targetMode
                    ? resolveCcbPermissionMode(planResult.targetMode)
                    : undefined,
                }
              : { outcome: 'allow', updatedInput: result.updatedInput }
            : toolName === 'ExitPlanMode' && result.message
              ? { outcome: 'rejectPlan', feedback: result.message }
              : { outcome: 'deny', message: result.message }
      } finally {
        active?.interactionControllers.delete(controller)
      }
    }
    await ccbDesktopRuntimeClient.request(
      { type: 'interaction.resolve', interactionId, response },
      options.sessionId,
    )
  }

  /**
   * 仅丢弃本地 Worker 句柄，不清理 runtimeSessionId / 会话上下文。
   * 下次 ensureSession 会用已有 runtimeSessionId 自动 resume 恢复。
   */
  private forgetOpenedSession(
    sessionId: string,
    options: {
      workerState?: 'cold' | 'starting' | 'ready' | 'busy' | 'suspended' | 'crashed'
      runtimeSessionId?: string
      sequence?: number
      clearSequence?: boolean
      log?: boolean
    } = {},
  ): void {
    const hadOpened = this.openedSessions.delete(sessionId)
    this.sessionRuntimeConfigs.delete(sessionId)
    if (options.clearSequence) {
      this.lastSequences.delete(sessionId)
    }
    try {
      updateAgentSessionMeta(sessionId, {
        ...(options.workerState ? { runtimeWorkerState: options.workerState } : {}),
        // 注意：不要在这里写 runtimeSessionId: undefined。
        // 回收/崩溃后必须保留 runtimeSessionId，才能 resume 恢复而不是清空上下文。
        ...(options.runtimeSessionId
          ? { runtimeSessionId: options.runtimeSessionId }
          : {}),
        ...(options.sequence !== undefined
          ? { runtimeLastSequence: options.sequence }
          : {}),
      })
    } catch {
      // 会话可能已从索引删除
    }
    if (options.log !== false && hadOpened) {
      console.log(
        `[CCB Runtime] Session Worker 已不可用，下次发送将 resume 恢复: session=${sessionId}, state=${options.workerState ?? 'unknown'}`,
      )
    }
  }

  private forgetAllOpenedSessions(
    workerState: 'cold' | 'crashed' | 'suspended',
  ): void {
    for (const sessionId of [...this.openedSessions.keys()]) {
      this.forgetOpenedSession(sessionId, { workerState, clearSequence: true })
    }
  }

  /** Turn 间隙常驻处理：Worker 回收/崩溃通知 → 标记本地句柄失效，保留可 resume 的 runtimeSessionId。 */
  private handleLifecycleEvent(
    envelope: CcbRuntimeEnvelope<CcbRuntimeEvent>,
  ): void {
    const sessionId = envelope.sessionId
    if (!sessionId) return
    const event = envelope.payload

    if (event.type === 'session.stateChanged') {
      if (envelope.sequence !== undefined) {
        this.lastSequences.set(sessionId, envelope.sequence)
      }
      if (
        event.state === 'suspended'
        || event.state === 'crashed'
        || event.state === 'closed'
      ) {
        this.forgetOpenedSession(sessionId, {
          workerState: event.state === 'closed' ? 'cold' : event.state,
          runtimeSessionId: event.runtimeSessionId,
          sequence: envelope.sequence,
        })
        return
      }
      try {
        updateAgentSessionMeta(sessionId, {
          runtimeWorkerState: event.state,
          ...(event.runtimeSessionId
            ? { runtimeSessionId: event.runtimeSessionId }
            : {}),
          ...(envelope.sequence !== undefined
            ? { runtimeLastSequence: envelope.sequence }
            : {}),
        })
      } catch {
        // 会话可能已删除
      }
      return
    }

    if (event.type === 'worker.crashed') {
      this.forgetOpenedSession(sessionId, {
        workerState: 'crashed',
        sequence: envelope.sequence,
        clearSequence: true,
      })
    }
  }

  /**
   * 启动 Turn；若 Worker 已被回收/未打开，强制 resume 恢复后重试。
   * 恢复路径只重建 Worker，不清理会话上下文。
   */
  private async startTurnOrRecover(options: CcbAgentQueryOptions): Promise<void> {
    const { sessionId } = options
    const payload = options.compactRequest
      ? ({ type: 'session.compact' } as const)
      : ({ type: 'turn.start', prompt: options.prompt } as const)

    try {
      await ccbDesktopRuntimeClient.request(payload, sessionId, 30_000)
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!shouldRecoverSessionWorker(message)) throw error

      console.warn(
        `[CCB Runtime] Turn 启动失败，尝试 resume 恢复: session=${sessionId}, reason=${message}`,
      )
      this.forgetOpenedSession(sessionId, {
        workerState: 'suspended',
        log: false,
      })
      await this.ensureSession(options, true)

      try {
        await ccbDesktopRuntimeClient.request(payload, sessionId, 30_000)
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : String(retryError)
        // 若恢复前 Host 队列里已有同一次 turn.start，resume 后可能已自动跑起来。
        if (retryMessage.includes('当前 Session 已有运行中的 Turn')) {
          console.warn(
            `[CCB Runtime] 恢复后检测到 Turn 已在运行，改为等待完成: session=${sessionId}`,
          )
          return
        }
        throw retryError
      }
    }
  }

  private settleTurn(sessionId: string, error?: Error): void {
    const active = this.active.get(sessionId)
    if (!active || active.settled) return
    active.settled = true
    for (const controller of active.interactionControllers) controller.abort()
    active.interactionControllers.clear()
    const sequence = this.lastSequences.get(sessionId)
    if (sequence !== undefined) {
      updateAgentSessionMeta(sessionId, { runtimeLastSequence: sequence })
    }
    void this.finalizeTurn(sessionId, active, error)
  }

  /**
   * 在通知消费方 Turn 完成前释放 active 标记。
   *
   * 这样 UI 收到完成状态后立即发送下一条消息时，不会撞上已经完成但尚未进入
   * run finally 的旧 Turn。若 Provider 配置在执行中被修改，则先关闭旧 Worker，
   * 避免下一轮与旧 Worker 清理发生竞态。
   */
  private async finalizeTurn(
    sessionId: string,
    active: ActiveTurn,
    error?: Error,
  ): Promise<void> {
    if (this.invalidatedSessions.delete(sessionId)) {
      await this.closeOpenedSession(sessionId).catch(closeError => {
        console.warn(
          `[CCB Runtime] Turn 完成后刷新失效 Session 失败: session=${sessionId}`,
          closeError,
        )
      })
    }

    releaseTurnBeforeNotify(this.active, sessionId, active, () => {
      // 用户中断 / Worker 异常等 Turn 结束场景：CCB 往往不会再补发完整 assistant。
      // 无论成功还是失败，都先把仍停留在 partial 的流式正文/思考固化并推给上层，
      // 否则编排器落盘缺正文，前端从 JSONL 重建后过程正文整体丢失。
      const finalized = finalizeCcbPartialAssistantMessage(active.partialAssistantState)
      active.partialAssistantState = finalized.state
      if (finalized.message) active.queue.push(finalized.message)

      if (error) {
        // fail() 会让后续 next() 直接 reject 且丢弃队列残留；
        // 先 push 固化消息再 fail，若已有 waiter 会先拿到正文，其余靠编排器 partial 兜底。
        active.queue.fail(error)
        active.reject(error)
        return
      }

      const result = resolveCompletedTurnResult(active)
      if (result) {
        active.queue.push(normalizeCcbCompactionMessage(
          result,
          active.compactRequested,
        ))
      }
      active.queue.finish()
      active.resolve()
    })
  }
}
