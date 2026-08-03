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

/**
 * 将已从实时执行图消失、却仍停留在 queued/running 的历史节点收敛为 stopped。
 *
 * CCB 任务完成后会从 appState.tasks 删除；若终态事件漏推，历史快照会一直保留
 * running，父会话 busy 时悬浮面板又会把它标成“执行中”，点开后 Transcript 也
 * 已不可读。仅在实时图非空时收敛，避免短暂清空后晚到的 completed 被误杀。
 */
export function finalizeOrphanedRuntimeExecutionNodes<T extends AgentRuntimeExecutionNode>(
  previousNodes: readonly T[],
  liveNodes: readonly AgentRuntimeExecutionNode[],
  options?: {
    /** 权威快照时间；0 表示 Session 未打开等非权威空结果，不做收敛。 */
    graphUpdatedAt?: number
    completedAt?: number
  },
): T[] {
  const graphUpdatedAt = options?.graphUpdatedAt ?? 0
  if (graphUpdatedAt <= 0) return previousNodes as T[]
  // 空图可能只是短暂重置，之后还会补推 completed；只有实时图仍有其它节点时，
  // 才能确定“该节点已从 tasks 消失且不会再回来”。
  if (liveNodes.length === 0) return previousNodes as T[]

  const liveNodeIds = new Set(liveNodes.map((node) => node.id))
  const completedAt = options?.completedAt ?? Date.now()
  let changed = false
  const next = previousNodes.map((node) => {
    if (liveNodeIds.has(node.id) || isFloatingExecutionNodeTerminal(node)) {
      return node
    }
    if (node.status !== 'queued' && node.status !== 'running') {
      return node
    }
    changed = true
    return {
      ...node,
      status: 'stopped' as const,
      completedAt: node.completedAt ?? completedAt,
      summary: node.summary
        ?? '执行节点已从 Runtime 消失（可能已结束或异常退出）',
    }
  })
  return changed ? next : previousNodes as T[]
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
