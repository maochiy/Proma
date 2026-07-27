import { join } from 'node:path'
import type {
  AgentProviderAdapter,
  AgentQueryInput,
  AgentRuntimeSessionOperationInput,
  AgentRuntimeForkResult,
  AgentRuntimeRewindResult,
  SDKMessage,
  SDKUserMessageInput,
  SendQueuedMessageOptions,
  PromaPermissionMode,
} from '@proma/shared'
import type { CanUseToolOptions, PermissionResult } from '../agent-permission-service'
import { updateAgentSessionMeta } from '../agent-session-manager'
import { getConfigDir } from '../config-paths'
import { persistCodexOAuthCredentials } from '../channel-manager'
import { ccbDesktopRuntimeClient } from './runtime-client'
import { sanitizeCcbSessionEnvironment } from './runtime-security'
import type {
  CcbInteractionResponse,
  CcbPermissionMode,
  CcbRuntimeEnvelope,
  CcbRuntimeEvent,
} from './protocol'

export interface CcbAgentQueryOptions extends AgentQueryInput {
  channelId?: string
  env?: Record<string, string | undefined>
  thinkingConfig?: import('@proma/shared').ThinkingConfig
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
  interactionControllers: Set<AbortController>
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
            if (failure) return Promise.reject(failure)
            const value = values.shift()
            if (value) return Promise.resolve({ value, done: false })
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

function permissionMode(mode: PromaPermissionMode | undefined): CcbPermissionMode {
  return (mode ?? 'bypassPermissions') as CcbPermissionMode
}

export class CcbDesktopRuntimeAdapter implements AgentProviderAdapter {
  private readonly active = new Map<string, ActiveTurn>()
  private readonly openedSessions = new Map<string, string>()
  private readonly lastSequences = new Map<string, number>()

  query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    const options = input as CcbAgentQueryOptions
    const queue = createQueue()
    void this.run(options, queue)
    return queue.iterable
  }

  abort(sessionId: string): void {
    void ccbDesktopRuntimeClient.request({ type: 'turn.stop' }, sessionId, 5_000)
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
    void ccbDesktopRuntimeClient.shutdown()
  }

  private async ensureOperationSession(
    input: AgentRuntimeSessionOperationInput,
  ): Promise<void> {
    const current = this.openedSessions.get(input.sessionId)
    if (current === input.runtimeSessionId) return
    const result = await ccbDesktopRuntimeClient.request<{ runtimeSessionId: string }>(
      {
        type: 'session.resume',
        options: {
          cwd: input.cwd,
          runtimeSessionId: input.runtimeSessionId,
          resume: true,
          model: input.model,
          fallbackModel: input.fallbackModel,
          thinkingConfig: input.thinkingConfig,
          permissionMode: permissionMode(input.permissionMode),
          environment: {
            variables: sanitizeCcbSessionEnvironment(input.env),
            configDir: join(getConfigDir(), 'runtime', 'ccb'),
          },
          mcpServers: input.mcpServers,
          appendSystemPrompt: input.systemPrompt,
          includePartialMessages: true,
        },
      },
      input.sessionId,
      60_000,
    )
    this.openedSessions.set(input.sessionId, result.runtimeSessionId)
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
      interactionControllers: new Set(),
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
        .request({ type: 'turn.stop' }, sessionId, 5_000)
        .catch(() => undefined)
      this.settleTurn(sessionId, new Error('Agent 请求已中止'))
    }
    options.abortSignal?.addEventListener('abort', onAbort, { once: true })
    try {
      await this.ensureSession(options)
      if (options.model) options.onModelResolved?.(options.model)
      try {
        await ccbDesktopRuntimeClient.request(
          options.compactRequest
            ? { type: 'session.compact' }
            : { type: 'turn.start', prompt: options.prompt },
          sessionId,
          30_000,
        )
      } catch (error) {
        if (!String(error).includes('Session 尚未打开')) throw error
        this.openedSessions.delete(sessionId)
        await this.ensureSession(options, true)
        await ccbDesktopRuntimeClient.request(
          options.compactRequest
            ? { type: 'session.compact' }
            : { type: 'turn.start', prompt: options.prompt },
          sessionId,
          30_000,
        )
      }
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
    const current = this.openedSessions.get(options.sessionId)
    if (
      !force &&
      current &&
      (!options.resumeSessionId || current === options.resumeSessionId)
    ) {
      return
    }
    const openResult = await ccbDesktopRuntimeClient.request<{
      runtimeSessionId: string
    }>(
      {
        type: options.resumeSessionId ? 'session.resume' : 'session.open',
        options: {
          cwd: options.cwd ?? process.cwd(),
          runtimeSessionId: options.resumeSessionId,
          resume: Boolean(options.resumeSessionId),
          model: options.model,
          fallbackModel: options.fallbackModel,
          thinkingConfig: options.thinkingConfig,
          permissionMode: permissionMode(options.sdkPermissionMode),
          environment: {
            variables: sanitizeCcbSessionEnvironment(options.env),
            configDir: join(getConfigDir(), 'runtime', 'ccb'),
          },
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

  private async handleEvent(
    options: CcbAgentQueryOptions,
    envelope: CcbRuntimeEnvelope<CcbRuntimeEvent>,
    queue: AsyncMessageQueue,
  ): Promise<void> {
    const event = envelope.payload
    switch (event.type) {
      case 'runtime.message':
        queue.push(event.message)
        return
      case 'turn.completed':
        this.settleTurn(options.sessionId)
        return
      case 'turn.failed':
        this.settleTurn(options.sessionId, new Error(event.error.message))
        return
      case 'worker.crashed':
        this.openedSessions.delete(options.sessionId)
        this.lastSequences.delete(options.sessionId)
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
        if (
          event.state === 'suspended' ||
          event.state === 'crashed' ||
          event.state === 'closed'
        ) {
          this.openedSessions.delete(options.sessionId)
        }
        updateAgentSessionMeta(options.sessionId, {
          runtimeWorkerState: event.state === 'closed' ? 'cold' : event.state,
          ...(event.runtimeSessionId && {
            runtimeSessionId: event.runtimeSessionId,
          }),
          ...(envelope.sequence !== undefined && {
            runtimeLastSequence: envelope.sequence,
          }),
        })
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
                    ? permissionMode(planResult.targetMode)
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
    if (error) {
      active.queue.fail(error)
      active.reject(error)
    } else {
      active.queue.finish()
      active.resolve()
    }
  }
}
