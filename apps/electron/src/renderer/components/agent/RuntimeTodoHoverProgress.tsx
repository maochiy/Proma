import * as React from 'react'
import { Check, Circle, CircleAlert, Loader2 } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import type { AgentRuntimeTodoItem, AgentTurnChangeStats } from '@proma/shared'
import {
  agentDiffRefreshVersionAtom,
  agentRuntimeExecutionGraphsAtom,
  agentSessionStreamingStateAtomFamily,
  agentTurnChangeStatsAtom,
} from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'

interface RuntimeTodoHoverProgressProps {
  sessionId: string
}

const FLOATING_PLAN_CARD_CLASS =
  'rounded-[14px] border border-black/[0.07] bg-card text-card-foreground shadow-md dark:border-white/[0.10]'

function isCompleted(todo: AgentRuntimeTodoItem): boolean {
  return todo.status === 'completed'
}

function completedTodoCount(todos: AgentRuntimeTodoItem[]): number {
  return todos.filter(isCompleted).length
}

function currentStepNumber(todos: AgentRuntimeTodoItem[], completedCount: number): number {
  if (todos.length === 0) return 0
  if (completedCount >= todos.length) return todos.length
  return Math.min(completedCount + 1, todos.length)
}

function completionPercentage(todos: AgentRuntimeTodoItem[], completedCount: number): number {
  if (todos.length === 0) return 0
  return Math.round((completedCount / todos.length) * 100)
}

export function shouldShowTurnChangeStats(
  stats: AgentTurnChangeStats | undefined,
  currentRunStartedAt: number | undefined,
): stats is AgentTurnChangeStats {
  if (!stats || stats.filesChanged <= 0) return false
  return currentRunStartedAt == null || stats.startedAt === currentRunStartedAt
}

function TodoStatusIcon({ todo }: { todo: AgentRuntimeTodoItem }): React.ReactElement {
  if (todo.status === 'completed') {
    return (
      <span
        aria-label="已完成"
        data-plan-status-icon="completed"
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
      >
        <Check className="size-2.5" strokeWidth={2.5} />
      </span>
    )
  }
  if (todo.status === 'in_progress') {
    return (
      <Loader2
        aria-label="执行中"
        data-plan-status-icon="in_progress"
        className="size-4 shrink-0 animate-spin text-sky-500"
        strokeWidth={2}
      />
    )
  }
  if (todo.status === 'blocked') {
    return (
      <CircleAlert
        aria-label="已阻塞"
        data-plan-status-icon="blocked"
        className="size-4 shrink-0 text-amber-500"
      />
    )
  }
  return (
    <Circle
      aria-label="等待中"
      data-plan-status-icon="pending"
      className="size-4 shrink-0 text-foreground/85"
      strokeWidth={1.75}
    />
  )
}

function PlanCompletionRing({
  percentage,
}: {
  percentage: number
}): React.ReactElement {
  return (
    <svg
      aria-label={`计划完成度 ${percentage}%`}
      data-plan-progress={percentage}
      className="size-3.5 shrink-0 -rotate-90"
      viewBox="0 0 16 16"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        strokeWidth="2"
        className="stroke-sky-100 dark:stroke-sky-900/70"
      />
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        pathLength="100"
        strokeDasharray={`${percentage} 100`}
        strokeLinecap="round"
        strokeWidth="2"
        className="stroke-sky-400 transition-[stroke-dasharray] duration-300"
      />
    </svg>
  )
}

/** 输入框正上方的 CCB Todo 进度；默认收起，鼠标移入显示完整步骤。 */
export function RuntimeTodoHoverProgress({
  sessionId,
}: RuntimeTodoHoverProgressProps): React.ReactElement | null {
  const graphs = useAtomValue(agentRuntimeExecutionGraphsAtom)
  const graph = graphs.get(sessionId)
  const todos = graph?.todos ?? []
  const streamingState = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
  const currentRunStartedAt = streamingState?.startedAt
  const diffRefreshVersions = useAtomValue(agentDiffRefreshVersionAtom)
  const diffRefreshVersion = diffRefreshVersions.get(sessionId) ?? 0
  const changeStatsMap = useAtomValue(agentTurnChangeStatsAtom)
  const setChangeStatsMap = useSetAtom(agentTurnChangeStatsAtom)
  const changeStats = changeStatsMap.get(sessionId)
  const requestSequenceRef = React.useRef(0)

  const refreshChangeStats = React.useCallback(async (): Promise<void> => {
    const requestSequence = ++requestSequenceRef.current
    try {
      const result = await window.electronAPI.getAgentTurnChangeStats(sessionId)
      if (requestSequence !== requestSequenceRef.current) return
      // 新一轮刚启动而 Main 仍在创建基线时，旧一轮结果不允许覆盖当前显示。
      if (
        result
        && currentRunStartedAt != null
        && result.startedAt !== currentRunStartedAt
      ) {
        return
      }

      setChangeStatsMap((previous) => {
        const next = new Map(previous)
        if (result) next.set(sessionId, result)
        else next.delete(sessionId)
        return next
      })
    } catch {
      // 统计是辅助信息，Git 不可用或会话正在切换时静默降级。
    }
  }, [currentRunStartedAt, sessionId, setChangeStatsMap])

  React.useEffect(() => {
    if (currentRunStartedAt == null) return
    setChangeStatsMap((previous) => {
      const existing = previous.get(sessionId)
      if (!existing || existing.startedAt === currentRunStartedAt) return previous
      const next = new Map(previous)
      next.delete(sessionId)
      return next
    })
  }, [currentRunStartedAt, sessionId, setChangeStatsMap])

  React.useEffect(() => {
    if (todos.length === 0) return

    void refreshChangeStats()
    // Agent IPC 先进入 Main，再创建 Git 基线；启动后补一次轻量重试消除这段竞态。
    const retryTimer = currentRunStartedAt != null
      ? window.setTimeout(() => void refreshChangeStats(), 750)
      : null

    return () => {
      requestSequenceRef.current += 1
      if (retryTimer != null) window.clearTimeout(retryTimer)
    }
  }, [
    currentRunStartedAt,
    refreshChangeStats,
    todos.length,
  ])

  const previousDiffRefreshVersionRef = React.useRef(diffRefreshVersion)
  React.useEffect(() => {
    if (previousDiffRefreshVersionRef.current === diffRefreshVersion) return
    previousDiffRefreshVersionRef.current = diffRefreshVersion
    if (todos.length === 0) return
    void refreshChangeStats()
  }, [diffRefreshVersion, refreshChangeStats, todos.length])

  if (todos.length === 0) return null

  const completedCount = completedTodoCount(todos)
  const stepNumber = currentStepNumber(todos, completedCount)
  const progressPercentage = completionPercentage(todos, completedCount)
  const visibleChangeStats = shouldShowTurnChangeStats(
    changeStats,
    currentRunStartedAt,
  )

  return (
    <div
      className="group relative z-30 w-fit"
    >
      <div
        className={cn(
          'pointer-events-none invisible absolute bottom-full left-1/2 w-max max-w-[min(420px,calc(100vw-3rem))]',
          '-translate-x-1/2 translate-y-1 pb-2 opacity-0 transition-[opacity,transform,visibility] duration-150',
          'group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100',
        )}
      >
        <div className={cn(FLOATING_PLAN_CARD_CLASS, 'p-2.5')}>
          <div className="space-y-0.5">
            {todos.map((todo) => (
              <div
                key={todo.id}
                className="flex max-w-full items-start gap-2 px-1.5 py-0.5 text-[13px] leading-5"
              >
                <span className="mt-0.5">
                  <TodoStatusIcon todo={todo} />
                </span>
                <div className="min-w-0">
                  <p className={cn(
                    'break-words',
                    isCompleted(todo) && 'text-muted-foreground line-through decoration-muted-foreground/45',
                  )}>
                    {todo.content}
                  </p>
                  {todo.status === 'in_progress' && (
                    <p className="mt-0.5 text-[10px] text-sky-600 dark:text-sky-400">
                      执行中{todo.activeForm ? ` · ${todo.activeForm}` : ''}
                    </p>
                  )}
                  {(todo.owner || (todo.blockedBy?.length ?? 0) > 0) && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {todo.owner ? `负责人：${todo.owner}` : ''}
                      {todo.owner && (todo.blockedBy?.length ?? 0) > 0 ? ' · ' : ''}
                      {(todo.blockedBy?.length ?? 0) > 0
                        ? `等待：${todo.blockedBy?.join('、')}`
                        : ''}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className={cn(
          FLOATING_PLAN_CARD_CLASS,
          'inline-flex h-9 cursor-default items-center gap-2 px-3.5 text-[13px] text-muted-foreground',
        )}
      >
        <PlanCompletionRing percentage={progressPercentage} />
        <span className="tabular-nums">第 {stepNumber} / {todos.length} 步</span>
        {visibleChangeStats && (
          <>
            <span className="text-muted-foreground/45">·</span>
            <span className="tabular-nums">{changeStats.filesChanged} 个文件已更改</span>
            {changeStats.additions > 0 && (
              <span className="tabular-nums text-emerald-500">
                +{changeStats.additions}
              </span>
            )}
            {changeStats.deletions > 0 && (
              <span className="tabular-nums text-red-500">
                -{changeStats.deletions}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
