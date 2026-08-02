import type {
  AgentRuntimeExecutionNode,
  AgentRuntimeTodoItem,
} from '@proma/shared'

export interface AgentFloatingPanelPlanState {
  /** 已经处理的最近一轮标识。 */
  observedTurnEpoch?: number
  /** 新一轮开始时需要屏蔽的上一轮已完成计划签名。 */
  suppressedCompletedPlanSignature?: string
}

/** 完成状态至少保留一小段时间，避免节点从“执行中”直接瞬间消失。 */
export const FLOATING_EXECUTION_NODE_COMPLETION_DELAY_MS = 1_500

/** 同一批节点同时进入终态时错开关闭，保持逐条清理而不是整批闪退。 */
export const FLOATING_EXECUTION_NODE_COMPLETION_STAGGER_MS = 120

export function areFloatingPlanTodosCompleted(
  todos: AgentRuntimeTodoItem[],
): boolean {
  return todos.length > 0 && todos.every((todo) => todo.status === 'completed')
}

/** 只使用稳定字段，避免查询快照的临时字段变化让旧计划重新出现。 */
export function createFloatingPlanSignature(
  todos: AgentRuntimeTodoItem[],
): string {
  return JSON.stringify(
    [...todos]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((todo) => ({
        id: todo.id,
        content: todo.content,
        status: todo.status,
      })),
  )
}

export function isFloatingExecutionNodeTerminal(
  node: AgentRuntimeExecutionNode,
): boolean {
  return (
    node.status === 'completed'
    || node.status === 'failed'
    || node.status === 'stopped'
  )
}

export function advanceFloatingPanelPlanState({
  turnEpoch,
  todos,
}: {
  turnEpoch: number
  todos: AgentRuntimeTodoItem[]
}): AgentFloatingPanelPlanState {
  return {
    observedTurnEpoch: turnEpoch,
    // begin turn 时捕获的是新一轮开始前的旧计划；只有旧计划全完成才屏蔽。
    suppressedCompletedPlanSignature: areFloatingPlanTodosCompleted(todos)
      ? createFloatingPlanSignature(todos)
      : undefined,
  }
}
