/**
 * Proma Claude Code Agent SDK Runtime 适配器。
 *
 * Claude Code 只作为 Hermes 调度链路中的 Harness，不参与普通 Runtime 选择。
 * 这里直接使用 Claude Code Agent SDK 协议，并把原生 SDKMessage
 * 透传给 Proma，避免再经过 CCB Host。
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  AgentProviderAdapter,
  AgentQueryInput,
  AgentRuntimeSessionOperationInput,
  RuntimeModelRoute,
  SDKMessage,
  SDKUserMessageInput,
  SendQueuedMessageOptions,
} from '@proma/shared'
import { query, type Options as ClaudeQueryOptions, type PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { detectRuntime, getRuntimeConfig } from './runtime-registry'
import { getRuntimeSessionsDir } from '../config-paths'

interface MessageQueue {
  iterable: AsyncIterable<SDKMessage>
  push(message: SDKMessage): void
  finish(): void
  fail(error: Error): void
}

interface ClaudeSession {
  query: ReturnType<typeof query> | null
  abortController: AbortController | null
  queue: MessageQueue | null
}

interface ClaudeRuntimeQueryOptions extends AgentQueryInput {
  env?: Record<string, string | undefined>
  sdkPermissionMode?: string
  canUseTool?: ClaudeQueryOptions['canUseTool']
  mcpServers?: ClaudeQueryOptions['mcpServers']
  maxTurns?: number
  maxBudgetUsd?: number
  resumeSessionId?: string
  thinkingConfig?: unknown
  effortLevel?: string
  providerConfiguration?: unknown
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

function permissionMode(value: string | undefined): PermissionMode {
  if (value === 'bypassPermissions' || value === 'off') return 'bypassPermissions'
  if (value === 'plan') return 'plan'
  return 'default'
}

async function buildOptions(input: ClaudeRuntimeQueryOptions, abortController: AbortController): Promise<ClaudeQueryOptions> {
  const runtime = detectRuntime('claude')
  const runtimeConfig = getRuntimeConfig()
  const routeBaseUrl = input.modelRoute?.baseUrl
    || input.env?.ANTHROPIC_BASE_URL
    || input.env?.PROMA_RUNTIME_MODEL_BASE_URL
    || input.env?.PROMA_MODEL_CENTER_PROVIDER_BASE_URL
    || input.env?.FRAKIO_MODEL_CENTER_PROVIDER_BASE_URL
    || runtimeConfig.frakioApiBaseUrl
    || undefined
  const routeToken = input.env?.PROMA_RUNTIME_API_KEY
    || input.env?.FRAKIO_RUNTIME_TOKEN
    || process.env.FRAKIO_RUNTIME_TOKEN
  const configDir = join(getRuntimeSessionsDir(), 'claude', input.sessionId)
  const systemPrompt = input.systemPrompt
  return {
    abortController,
    cwd: input.cwd || process.cwd(),
    ...(runtime?.installation.executablePath
      ? { pathToClaudeCodeExecutable: runtime.installation.executablePath }
      : {}),
    ...((input.modelRoute?.modelId || input.model) ? { model: input.modelRoute?.modelId || input.model } : {}),
    ...(input.resumeSessionId ? { resume: input.resumeSessionId } : {}),
    env: Object.fromEntries(
      Object.entries({
        ...process.env,
        ...input.env,
        ...(routeBaseUrl ? { ANTHROPIC_BASE_URL: routeBaseUrl } : {}),
        ...(routeToken ? { ANTHROPIC_AUTH_TOKEN: routeToken, ANTHROPIC_API_KEY: routeToken } : {}),
        CLAUDE_CONFIG_DIR: configDir,
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    includePartialMessages: true,
    permissionMode: permissionMode(input.sdkPermissionMode),
    ...(input.sdkPermissionMode === 'bypassPermissions'
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
    ...(input.maxTurns !== undefined ? { maxTurns: input.maxTurns } : {}),
    ...(input.maxBudgetUsd !== undefined ? { maxBudgetUsd: input.maxBudgetUsd } : {}),
    settingSources: [],
    ...(input.canUseTool ? { canUseTool: input.canUseTool } : {}),
    ...(systemPrompt
      ? {
          systemPrompt: typeof systemPrompt === 'string'
            ? systemPrompt
            : {
                type: 'preset',
                preset: 'claude_code',
                ...(systemPrompt.append ? { append: systemPrompt.append } : {}),
              },
        }
      : {}),
    // 后台 Harness 的自动压缩阈值：把用户对模型配置的压缩策略同步给
    // Claude Code，让子任务在后台按同一阈值自动压缩，不进主会话 UI。
    ...(input.modelRoute?.compaction
      ? { settings: claudeCompactionSettings(input.modelRoute.compaction) }
      : {}),
  }
}

/**
 * 把 Runtime 压缩策略投影为 Claude Agent SDK 的 settings。
 *
 * Claude 的 autoCompactWindow 语义是「触发压缩的阈值 token 数」，
 * 实际阈值为 min(autoCompactWindow, 模型最大窗口)，因此注入 threshold
 * （默认 80% × contextWindow），而不是注入完整窗口。
 */
export function claudeCompactionSettings(
  compaction: NonNullable<RuntimeModelRoute['compaction']>,
): Record<string, unknown> {
  return {
    autoCompactEnabled: compaction.enabled,
    ...(compaction.threshold != null
      ? { autoCompactWindow: compaction.threshold }
      : compaction.contextWindow != null
        ? { autoCompactWindow: compaction.contextWindow }
        : {}),
  }
}

export class FrakioClaudeRuntimeAdapter implements AgentProviderAdapter {
  private readonly sessions = new Map<string, ClaudeSession>()

  query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    const queue = createQueue()
    void this.run(input as ClaudeRuntimeQueryOptions, queue)
    return queue.iterable
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.abortController?.abort()
    await session.query?.interrupt?.().catch(() => {})
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.abortController?.abort()
    session.query?.close?.()
    this.sessions.delete(sessionId)
  }

  async interruptQuery(sessionId: string): Promise<void> {
    await this.abort(sessionId)
  }

  async sendQueuedMessage(
    _sessionId: string,
    _message: SDKUserMessageInput,
    _options?: SendQueuedMessageOptions,
  ): Promise<void> {
    throw new Error('Proma Claude Runtime 暂不支持同一 Query 内的队列消息。')
  }

  async compactSession(
    _input: AgentRuntimeSessionOperationInput,
    _instructions?: string,
  ): Promise<void> {
    throw new Error('Proma Claude Runtime 暂不支持显式上下文压缩。')
  }

  dispose(): void {
    for (const sessionId of this.sessions.keys()) void this.closeSession(sessionId)
  }

  private async run(input: ClaudeRuntimeQueryOptions, queue: MessageQueue): Promise<void> {
    const abortController = new AbortController()
    const stream = query({
      prompt: input.prompt,
      options: await buildOptions(input, abortController),
    })
    this.sessions.set(input.sessionId, { query: stream, abortController, queue })
    try {
      for await (const message of stream) {
        if (message.type === 'system' && message.subtype === 'init') {
          input.onSessionId?.(message.session_id)
        }
        queue.push(message)
      }
      queue.finish()
    } catch (error) {
      queue.push({
        type: 'result',
        subtype: abortController.signal.aborted ? 'cancelled' : 'error_during_execution',
        session_id: input.sessionId,
        errors: [error instanceof Error ? error.message : String(error)],
        usage: { input_tokens: 0, output_tokens: 0 },
      } as SDKMessage)
      // result.errors 已经携带真实错误原因，结束队列即可，不能再让
      // AsyncIterator 额外 reject 一次，否则上层会重复持久化/提示。
      queue.finish()
    } finally {
      if (this.sessions.get(input.sessionId)?.queue === queue) {
        this.sessions.delete(input.sessionId)
      }
    }
  }
}

export function createRuntimeErrorMessage(sessionId: string, message: string): SDKMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text: message }] },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: randomUUID(),
  } as SDKMessage
}
