/**
 * Agent headless runner 注册表
 *
 * 用于主进程内置工具在不直接 import agent-service.ts 的情况下启动/停止真实 Agent 会话，
 * 避免 AgentOrchestrator 与 agent-service 形成难以维护的循环依赖。
 */

import { availableParallelism } from 'node:os'
import type {
  AgentExternalRunSource,
  AgentMessage,
  AgentSendInput,
} from '@proma/shared'

export interface HeadlessAgentRunCallbacks {
  onError: (error: string) => void
  onComplete: (messages?: AgentMessage[]) => void
  onTitleUpdated: (title: string) => void
  source?: AgentExternalRunSource
}

export type HeadlessAgentRunner = (
  input: AgentSendInput,
  callbacks: HeadlessAgentRunCallbacks,
) => Promise<void>

export type AgentStopper = (sessionId: string) => Promise<void>

let headlessRunner: HeadlessAgentRunner | null = null
let agentStopper: AgentStopper | null = null

interface QueuedHeadlessAgentRun {
  input: AgentSendInput
  callbacks: HeadlessAgentRunCallbacks
  resolve: () => void
  reject: (error: unknown) => void
}

/**
 * CCB Runtime 的 Session Worker 上限为 2～4。
 * Headless 子会话至少为当前前台会话保留一个 Worker，避免批量委派时
 * session.resolveModelCatalog 长时间排在 Runtime 内部并触发 30 秒超时。
 */
export const MAX_CONCURRENT_HEADLESS_AGENTS = Math.max(
  1,
  Math.min(
    3,
    Math.min(4, Math.max(2, Math.floor(availableParallelism() / 2))) - 1,
  ),
)

const pendingRuns: QueuedHeadlessAgentRun[] = []
const activeSessionIds = new Set<string>()

function drainHeadlessAgentQueue(): void {
  if (!headlessRunner) return

  while (
    activeSessionIds.size < MAX_CONCURRENT_HEADLESS_AGENTS
    && pendingRuns.length > 0
  ) {
    const queued = pendingRuns.shift()
    if (!queued) return

    activeSessionIds.add(queued.input.sessionId)
    void headlessRunner(queued.input, queued.callbacks)
      .then(queued.resolve, queued.reject)
      .finally(() => {
        activeSessionIds.delete(queued.input.sessionId)
        drainHeadlessAgentQueue()
      })
  }
}

export function setHeadlessAgentRunner(runner: HeadlessAgentRunner): void {
  headlessRunner = runner
  drainHeadlessAgentQueue()
}

export function setAgentStopper(stopper: AgentStopper): void {
  agentStopper = stopper
}

export async function runRegisteredHeadlessAgent(
  input: AgentSendInput,
  callbacks: HeadlessAgentRunCallbacks,
): Promise<void> {
  if (!headlessRunner) {
    throw new Error('Agent headless runner 尚未初始化')
  }

  await new Promise<void>((resolve, reject) => {
    pendingRuns.push({
      input,
      callbacks,
      resolve,
      reject,
    })
    drainHeadlessAgentQueue()
  })
}

export async function stopRegisteredAgent(sessionId: string): Promise<void> {
  const pendingIndex = pendingRuns.findIndex(
    (item) => item.input.sessionId === sessionId,
  )
  if (pendingIndex >= 0) {
    const [pending] = pendingRuns.splice(pendingIndex, 1)
    pending?.resolve()
    return
  }

  if (!agentStopper) {
    throw new Error('Agent stopper 尚未初始化')
  }
  await agentStopper(sessionId)
}

/** 仅供 BDD 测试隔离模块级队列状态。 */
export function resetHeadlessAgentRunnerRegistryForTests(): void {
  pendingRuns.splice(0).forEach((item) => {
    item.resolve()
  })
  activeSessionIds.clear()
  headlessRunner = null
  agentStopper = null
}
