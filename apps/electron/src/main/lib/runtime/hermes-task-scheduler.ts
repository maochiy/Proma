/**
 * Hermes 任务图驱动器。
 *
 * 这里故意不定义固定阶段。每一轮都重新读取 Dispatch Run 的可执行节点，
 * 因此策略可以产生单任务、串行任务或多个独立并行任务。
 */

import type {
  DispatchRun,
  RuntimeExecutionRequest,
  RuntimeTask,
} from '@proma/shared'
import {
  completeDispatchTask,
  failDispatchTask,
  getDispatchRun,
  getRunnableDispatchTasks,
  startDispatchTask,
  taskArtifacts,
  toRuntimeExecutionRequest,
} from './hermes-dispatcher'

export interface HermesTaskExecutionContext {
  run: DispatchRun
  task: RuntimeTask
  request: RuntimeExecutionRequest
  inputArtifacts: ReturnType<typeof taskArtifacts>
}

export interface HermesTaskSchedulerOptions {
  maxParallelTasks?: number
  maxIterations?: number
  buildRequest: (
    run: DispatchRun,
    task: RuntimeTask,
  ) => RuntimeExecutionRequest
  executeTask: (context: HermesTaskExecutionContext) => Promise<string>
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number | null): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`任务执行超时（${timeoutMs}ms）。`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export class HermesTaskScheduler {
  async run(runId: string, options: HermesTaskSchedulerOptions): Promise<DispatchRun | null> {
    const maxParallelTasks = Math.max(1, options.maxParallelTasks ?? 4)
    const maxIterations = Math.max(1, options.maxIterations ?? 100)

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const current = getDispatchRun(runId)
      if (!current || ['completed', 'failed', 'blocked', 'cancelled', 'waiting_user'].includes(current.status)) {
        return current
      }

      const runnable = getRunnableDispatchTasks(runId)
      if (runnable.length === 0) return getDispatchRun(runId)

      const batch = runnable.slice(0, maxParallelTasks)
      const started = batch.flatMap((task): Array<{ run: DispatchRun; task: RuntimeTask }> => {
        try {
          const run = startDispatchTask(runId, task.id)
          const nextTask = run.plan.graph.tasks.find((candidate) => candidate.id === task.id)
          return nextTask ? [{ run, task: nextTask }] : []
        } catch (error) {
          console.warn(`[Hermes 调度] 跳过不可启动任务：${task.id}`, error)
          return []
        }
      })
      if (started.length === 0) return getDispatchRun(runId)

      await Promise.all(started.map(async ({ run, task }) => {
        const request = options.buildRequest(run, task)
        const context: HermesTaskExecutionContext = {
          run,
          task,
          request,
          inputArtifacts: taskArtifacts(run, task),
        }
        try {
          const result = await withTimeout(options.executeTask(context), task.timeoutMs)
          completeDispatchTask(runId, task.id, result)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          failDispatchTask(runId, task.id, {
            error: message,
            timeout: message.includes('任务执行超时'),
          })
        }
      }))
    }

    throw new Error(`Hermes 任务图超过最大调度轮次（${maxIterations}）。`)
  }
}
