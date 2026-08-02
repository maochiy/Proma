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
import { shouldSuppressAgentRunningIndicator } from '@/lib/agent-running-state'
import { cn } from '@/lib/utils'

interface RuntimeTodoHoverProgressProps {
  sessionId: string
}

const FLOATING_PLAN_CARD_CLASS =
  'rounded-[14px] border border-black/[0.07] bg-card text-card-foreground shadow-md dark:border-white/[0.10]'

export function isCompleted(todo: AgentRuntimeTodoItem): boolean {
  return todo.status === 'completed'
}

export function completedTodoCount(todos: AgentRuntimeTodoItem[]): number {
  return todos.filter(isCompleted).length
}

export function inProgressTodoCount(todos: AgentRuntimeTodoItem[]): number {
  return todos.filter((todo) => todo.status === 'in_progress').length
}

/**
 * 当前步 = 已完成 + 执行中（与 Codex 一致）。
 * 只统计已经真正推进过的步骤，不把下一个 pending 提前算成当前步。
 */
export function currentStepNumber(todos: AgentRuntimeTodoItem[], completedCount: number): number {
  if (todos.length === 0) return 0
  if (completedCount >= todos.length) return todos.length

  const advancedCount = completedCount + inProgressTodoCount(todos)
  return Math.min(Math.max(advancedCount, 0), todos.length)
}

export function completionPercentage(todos: AgentRuntimeTodoItem[], completedCount: number): number {
  if (todos.length === 0) return 0
  return Math.round((completedCount / todos.length) * 100)
}

/** 稳定排序：数字 ID 按数值，其它按字符串。 */
export function sortRuntimeTodos(todos: AgentRuntimeTodoItem[]): AgentRuntimeTodoItem[] {
  return [...todos].sort((left, right) => {
    const leftNum = Number(left.id)
    const rightNum = Number(right.id)
    const leftIsNum = Number.isFinite(leftNum) && String(leftNum) === left.id
    const rightIsNum = Number.isFinite(rightNum) && String(rightNum) === right.id
    if (leftIsNum && rightIsNum) return leftNum - rightNum
    if (leftIsNum) return -1
    if (rightIsNum) return 1
    return left.id.localeCompare(right.id)
  })
}

export function formatPlanProgressLabel(
  todos: AgentRuntimeTodoItem[],
  _completedCount: number,
  stepNumber: number,
): string {
  if (todos.length === 0) return ''
  return `第 ${stepNumber} / ${todos.length} 步`
}

/**
 * 计划入口可见性：
 * 1. 有 Todo 才显示
 * 2. 仅本轮会话仍在执行（running）时显示；会话结束后整块入口/面板都隐藏
 * 3. 上下文压缩进行中时也隐藏（底部只展示压缩进度）
 *
 * 任务文件里残留 in_progress 在「执行中」时展示是正常的；
 * 会话已停时不应再展示转圈「执行中」，否则会误导成还在跑。
 */
export function shouldShowRuntimeTodoProgress(
  todos: AgentRuntimeTodoItem[],
  streamState?: {
    running?: boolean
    isCompacting?: boolean
    contextCompaction?: {
      status: 'running' | 'success' | 'noop' | 'failed'
    }
  },
): boolean {
  if (todos.length === 0) return false
  // 会话已停：隐藏计划入口与悬浮面板，避免 idle 仍转圈「执行中」
  if (streamState?.running !== true) return false
  if (shouldSuppressAgentRunningIndicator(streamState)) return false
  return true
}

function isUsableExecutionGraph(
  graph: { nodes: unknown[]; todos: unknown[]; updatedAt: number } | null | undefined,
): boolean {
  if (!graph) return false
  return graph.updatedAt > 0 || graph.todos.length > 0 || graph.nodes.length > 0
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
  const setGraphs = useSetAtom(agentRuntimeExecutionGraphsAtom)
  const graph = graphs.get(sessionId)
  const todos = React.useMemo(
    () => sortRuntimeTodos(graph?.todos ?? []),
    [graph?.todos],
  )
  const streamingState = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
  const currentRunStartedAt = streamingState?.startedAt
  const isStreaming = streamingState?.running === true
  const diffRefreshVersions = useAtomValue(agentDiffRefreshVersionAtom)
  const diffRefreshVersion = diffRefreshVersions.get(sessionId) ?? 0
  const changeStatsMap = useAtomValue(agentTurnChangeStatsAtom)
  const setChangeStatsMap = useSetAtom(agentTurnChangeStatsAtom)
  const changeStats = changeStatsMap.get(sessionId)
  const requestSequenceRef = React.useRef(0)

  // 会话打开或流式结束后主动拉一次执行图，避免只依赖实时事件导致进度停在旧快照。
  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const next = await window.electronAPI.getAgentRuntimeExecutionGraph(sessionId)
        if (cancelled || !isUsableExecutionGraph(next)) return
        setGraphs((previous) => {
          const existing = previous.get(sessionId)
          if (
            existing
            && existing.updatedAt === next.updatedAt
            && existing.todos.length === next.todos.length
            && existing.nodes.length === next.nodes.length
          ) {
            return previous
          }
          const updated = new Map(previous)
          updated.set(sessionId, next)
          return updated
        })
      } catch {
        // Session 未打开时保留事件推送的最后快照。
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isStreaming, sessionId, setGraphs])

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

  if (!shouldShowRuntimeTodoProgress(todos, streamingState)) return null

  const completedCount = completedTodoCount(todos)
  const stepNumber = currentStepNumber(todos, completedCount)
  const progressPercentage = completionPercentage(todos, completedCount)
  const progressLabel = formatPlanProgressLabel(todos, completedCount, stepNumber)
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
        <span className="tabular-nums">{progressLabel}</span>
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
