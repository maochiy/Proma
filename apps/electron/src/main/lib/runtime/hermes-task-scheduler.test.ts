import { afterEach, describe, expect, test } from 'bun:test'
import type { DispatchRun } from '@proma/shared'
import { dispatchForRequest } from './dispatch-policy'
import {
  approveDispatchTask,
  createDispatchRun,
  setDispatchStoreAdapter,
} from './hermes-dispatcher'
import { HermesTaskScheduler } from './hermes-task-scheduler'

describe('Hermes 动态任务调度', () => {
  afterEach(() => {
    setDispatchStoreAdapter(undefined)
  })

  test('Given 已确认的实现需求 When Hermes 驱动任务图 Then 自动执行可运行节点并停在用户审批', async () => {
    let store: { runs: DispatchRun[]; updatedAt: number } = { runs: [], updatedAt: 0 }
    setDispatchStoreAdapter({
      read: () => store,
      write: (next) => { store = next },
    })
    const created = createDispatchRun({
      sessionId: 'scheduler-session',
      prompt: '实现登录页面',
      decision: dispatchForRequest({
        message: '实现登录页面',
        requirementsConfirmed: true,
      }),
    })
    const executed: string[] = []
    const scheduler = new HermesTaskScheduler()

    const waiting = await scheduler.run(created.id, {
      buildRequest: (run, task) => ({
        runId: run.id,
        taskId: task.id,
        sessionId: run.sessionId,
        runtimeId: task.runtimeId,
        harnessId: task.harnessId,
        prompt: task.prompt,
      }),
      executeTask: async ({ task }) => {
        executed.push(task.runtimeId)
        return `${task.runtimeId} 已完成`
      },
    })

    expect(executed).toEqual(['hermes', 'codex'])
    expect(waiting?.status).toBe('waiting_user')
    expect(waiting?.plan.graph.tasks.find((task) => task.kind === 'implementation')?.status).toBe('waiting_approval')
  })

  test('Given 用户批准实施任务 When 继续驱动 Then Claude Code 后接 Codex 审查和 Pi 汇总', async () => {
    let store: { runs: DispatchRun[]; updatedAt: number } = { runs: [], updatedAt: 0 }
    setDispatchStoreAdapter({
      read: () => store,
      write: (next) => { store = next },
    })
    const created = createDispatchRun({
      sessionId: 'scheduler-approval-session',
      prompt: '实现设置页',
      decision: dispatchForRequest({
        message: '实现设置页',
        requirementsConfirmed: true,
      }),
    })
    const scheduler = new HermesTaskScheduler()
    await scheduler.run(created.id, {
      buildRequest: (run, task) => ({
        runId: run.id,
        taskId: task.id,
        sessionId: run.sessionId,
        runtimeId: task.runtimeId,
        harnessId: task.harnessId,
        prompt: task.prompt,
      }),
      executeTask: async ({ task }) => `${task.runtimeId} 已完成`,
    })
    const waiting = store.runs[0]!
    const implementation = waiting.plan.graph.tasks.find((task) => task.kind === 'implementation')!
    approveDispatchTask(waiting.id, implementation.id)

    const executed: string[] = []
    const completed = await scheduler.run(waiting.id, {
      buildRequest: (run, task) => ({
        runId: run.id,
        taskId: task.id,
        sessionId: run.sessionId,
        runtimeId: task.runtimeId,
        harnessId: task.harnessId,
        prompt: task.prompt,
      }),
      executeTask: async ({ task }) => {
        executed.push(task.runtimeId)
        return `${task.runtimeId} 已完成`
      },
    })

    expect(executed).toEqual(['claude', 'codex', 'pi'])
    expect(completed?.status).toBe('completed')
  })
})
