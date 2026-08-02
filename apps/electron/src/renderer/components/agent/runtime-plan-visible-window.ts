import type { AgentRuntimeTodoItem } from '@proma/shared'

/**
 * 计算计划列表可见窗口的起点，不修改完整计划数据。
 *
 * - 优先让正在执行的步骤成为窗口首项。
 * - 没有执行中步骤时，从第一条未完成步骤开始。
 * - 接近末尾时向前补齐，保持项目定义的可见条数与原计划顺序。
 * - 全部完成时展示最后一段完成记录。
 */
export function getRuntimePlanVisibleWindowStartIndex(
  todos: AgentRuntimeTodoItem[],
  visibleCount: number,
): number {
  if (visibleCount <= 0 || todos.length <= visibleCount) return 0

  const runningIndex = todos.findIndex((todo) => todo.status === 'in_progress')
  const firstUnfinishedIndex = todos.findIndex(
    (todo) => todo.status !== 'completed',
  )
  const focusIndex = runningIndex >= 0 ? runningIndex : firstUnfinishedIndex
  const maxStartIndex = todos.length - visibleCount

  return focusIndex >= 0
    ? Math.min(focusIndex, maxStartIndex)
    : maxStartIndex
}

export function selectRuntimePlanVisibleItems(
  todos: AgentRuntimeTodoItem[],
  visibleCount: number,
): AgentRuntimeTodoItem[] {
  if (visibleCount <= 0 || todos.length === 0) return []
  if (todos.length <= visibleCount) return todos

  const startIndex = getRuntimePlanVisibleWindowStartIndex(
    todos,
    visibleCount,
  )
  return todos.slice(startIndex, startIndex + visibleCount)
}
