import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test'
import type {
  AgentMessage,
  AgentSendInput,
} from '@proma/shared'
import {
  MAX_CONCURRENT_HEADLESS_AGENTS,
  resetHeadlessAgentRunnerRegistryForTests,
  runRegisteredHeadlessAgent,
  setAgentStopper,
  setHeadlessAgentRunner,
  stopRegisteredAgent,
} from './agent-headless-runner-registry'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function createInput(sessionId: string): AgentSendInput {
  return {
    sessionId,
    userMessage: `执行 ${sessionId}`,
    channelId: 'channel',
    workspaceId: 'workspace',
  }
}

const callbacks = {
  onError: (): void => {},
  onComplete: (_messages?: AgentMessage[]): void => {},
  onTitleUpdated: (_title: string): void => {},
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  resetHeadlessAgentRunnerRegistryForTests()
})

describe('Agent Headless Runner 受控队列', () => {
  test('Given 批量子会话超过 Runtime 可用容量 When 同时启动 Then 只运行保留前台 Worker 后的数量', async () => {
    const started: string[] = []
    const deferredBySession = new Map<string, Deferred>()
    setHeadlessAgentRunner(async (input) => {
      started.push(input.sessionId)
      const deferred = createDeferred()
      deferredBySession.set(input.sessionId, deferred)
      await deferred.promise
    })

    const total = MAX_CONCURRENT_HEADLESS_AGENTS + 2
    const runs = Array.from({ length: total }, (_, index) => (
      runRegisteredHeadlessAgent(createInput(`session-${index}`), callbacks)
    ))
    await flushMicrotasks()

    expect(started).toHaveLength(MAX_CONCURRENT_HEADLESS_AGENTS)
    expect(started).toEqual(
      Array.from(
        { length: MAX_CONCURRENT_HEADLESS_AGENTS },
        (_, index) => `session-${index}`,
      ),
    )

    deferredBySession.get('session-0')?.resolve()
    await flushMicrotasks()
    expect(started).toContain(`session-${MAX_CONCURRENT_HEADLESS_AGENTS}`)

    for (const deferred of deferredBySession.values()) deferred.resolve()
    await flushMicrotasks()
    for (const deferred of deferredBySession.values()) deferred.resolve()
    await Promise.all(runs)
  })

  test('Given 子会话仍在队列 When 用户停止 Then 不启动 Runtime 且不调用 active stopper', async () => {
    const started: string[] = []
    const activeDeferred: Deferred[] = []
    const stopped: string[] = []
    setHeadlessAgentRunner(async (input) => {
      started.push(input.sessionId)
      const deferred = createDeferred()
      activeDeferred.push(deferred)
      await deferred.promise
    })
    setAgentStopper(async (sessionId) => {
      stopped.push(sessionId)
    })

    const activeRuns = Array.from(
      { length: MAX_CONCURRENT_HEADLESS_AGENTS },
      (_, index) => runRegisteredHeadlessAgent(
        createInput(`active-${index}`),
        callbacks,
      ),
    )
    const queuedRun = runRegisteredHeadlessAgent(
      createInput('queued-session'),
      callbacks,
    )
    await flushMicrotasks()

    await stopRegisteredAgent('queued-session')
    await queuedRun

    expect(started).not.toContain('queued-session')
    expect(stopped).toEqual([])

    activeDeferred.forEach((deferred) => deferred.resolve())
    await Promise.all(activeRuns)
  })
})
