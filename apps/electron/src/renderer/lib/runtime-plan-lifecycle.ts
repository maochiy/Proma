import type {
  AgentRuntimePlanPersistedStore,
  AgentRuntimePlanRecord,
  AgentRuntimePlanSessionState,
  AgentRuntimeTodoItem,
} from '@proma/shared'

export const RUNTIME_PLAN_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

/** 只有显式将任务设为 in_progress，才视为模型明确继续旧计划。 */
export function getExplicitRuntimePlanActivationTodoId(
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (input?.status !== 'in_progress') return undefined
  const todoId = input.taskId ?? input.id
  return typeof todoId === 'string' ? todoId : undefined
}

/** 计划身份只包含稳定的任务 ID 与内容，状态推进不会创建一份新计划。 */
export function createRuntimePlanIdentity(
  todos: AgentRuntimeTodoItem[],
): string {
  return JSON.stringify(
    [...todos]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((todo) => ({ id: todo.id, content: todo.content })),
  )
}

function allTodosCompleted(todos: AgentRuntimeTodoItem[]): boolean {
  return todos.length > 0
    && todos.every((todo) => todo.status === 'completed')
}

function hasSameTodoIds(
  previousTodos: AgentRuntimeTodoItem[],
  nextTodos: AgentRuntimeTodoItem[],
): boolean {
  if (previousTodos.length !== nextTodos.length) return false
  const nextIds = new Set(nextTodos.map((todo) => todo.id))
  return previousTodos.every((todo) => nextIds.has(todo.id))
}

function extendsCurrentPlan(
  previousTodos: AgentRuntimeTodoItem[],
  nextTodos: AgentRuntimeTodoItem[],
): boolean {
  if (nextTodos.length <= previousTodos.length) return false
  const nextIds = new Set(nextTodos.map((todo) => todo.id))
  return previousTodos.every((todo) => nextIds.has(todo.id))
}

function createRecord(
  todos: AgentRuntimeTodoItem[],
  now: number,
  turnEpoch?: number,
): AgentRuntimePlanRecord {
  const active = turnEpoch != null
  return {
    id: createRuntimePlanIdentity(todos),
    todos,
    status: active ? 'active' : 'interrupted',
    visible: active,
    createdAt: now,
    updatedAt: now,
    ...(active ? { lastActivatedTurnEpoch: turnEpoch } : {}),
    ...(!active
      ? {
          interruptedAt: now,
          expiresAt: now + RUNTIME_PLAN_RETENTION_MS,
        }
      : {}),
  }
}

function archiveRecord(
  record: AgentRuntimePlanRecord,
  now: number,
): AgentRuntimePlanRecord {
  return {
    ...record,
    status: record.status === 'completed' ? 'completed' : 'archived',
    visible: false,
    updatedAt: now,
    archivedAt: record.archivedAt ?? now,
    expiresAt: record.expiresAt ?? now + RUNTIME_PLAN_RETENTION_MS,
  }
}

function didTodoBecomeActive(
  previousTodos: AgentRuntimeTodoItem[],
  nextTodos: AgentRuntimeTodoItem[],
): boolean {
  const previousById = new Map(previousTodos.map((todo) => [todo.id, todo]))
  return nextTodos.some((todo) => {
    if (todo.status !== 'in_progress') return false
    const previous = previousById.get(todo.id)
    return previous == null || previous.status !== 'in_progress'
  })
}

export function beginRuntimePlanTurn(
  state: AgentRuntimePlanSessionState | undefined,
  turnEpoch: number,
  now: number,
): AgentRuntimePlanSessionState {
  if (!state) return { archived: [], turnEpoch }
  if (state.turnEpoch === turnEpoch) return state

  const archived = [...state.archived]
  let current = state.current
  if (current?.status === 'completed') {
    archived.push(archiveRecord(current, now))
    current = undefined
  } else if (current) {
    current = {
      ...current,
      status: 'interrupted',
      visible: false,
      updatedAt: now,
      interruptedAt: current.interruptedAt ?? now,
      expiresAt: current.expiresAt ?? now + RUNTIME_PLAN_RETENTION_MS,
    }
  }

  return { current, archived, turnEpoch }
}

export function applyRuntimePlanGraph(
  state: AgentRuntimePlanSessionState | undefined,
  todos: AgentRuntimeTodoItem[],
  now: number,
): AgentRuntimePlanSessionState | undefined {
  if (todos.length === 0) return state

  const base = state ?? { archived: [] }
  const identity = createRuntimePlanIdentity(todos)
  const current = base.current

  if (!current) {
    const isArchivedCompletedPlanReplay = (
      allTodosCompleted(todos)
      && base.archived.some((record) => (
        record.status === 'completed'
        && record.id === identity
      ))
    )
    if (isArchivedCompletedPlanReplay) return base

    return {
      ...base,
      current: createRecord(todos, now, base.turnEpoch),
    }
  }

  const samePlan = (
    current.id === identity
    || hasSameTodoIds(current.todos, todos)
  )
  const evolvingInCurrentTurn = (
    base.turnEpoch != null
    && current.lastActivatedTurnEpoch === base.turnEpoch
    && current.status === 'active'
    && extendsCurrentPlan(current.todos, todos)
  )

  if (!samePlan && !evolvingInCurrentTurn) {
    return {
      ...base,
      archived: [...base.archived, archiveRecord(current, now)],
      current: createRecord(todos, now, base.turnEpoch),
    }
  }

  const completed = allTodosCompleted(todos)
  const reactivated = (
    !completed
    && base.turnEpoch != null
    && didTodoBecomeActive(current.todos, todos)
  )
  const nextCurrent: AgentRuntimePlanRecord = {
    ...current,
    id: identity,
    todos,
    updatedAt: now,
    ...(completed
      ? {
          status: 'completed' as const,
          visible: true,
          completedAt: now,
          expiresAt: current.expiresAt ?? now + RUNTIME_PLAN_RETENTION_MS,
        }
      : reactivated
        ? {
            status: 'active' as const,
            visible: true,
            lastActivatedTurnEpoch: base.turnEpoch,
            interruptedAt: undefined,
            expiresAt: undefined,
          }
        : {}),
  }

  return { ...base, current: nextCurrent }
}

export function activateRuntimePlanTodo(
  state: AgentRuntimePlanSessionState | undefined,
  todoId: string,
  now: number,
): AgentRuntimePlanSessionState | undefined {
  const current = state?.current
  if (!state || !current || state.turnEpoch == null) return state
  if (!current.todos.some((todo) => todo.id === todoId)) return state

  return {
    ...state,
    current: {
      ...current,
      status: 'active',
      visible: true,
      updatedAt: now,
      lastActivatedTurnEpoch: state.turnEpoch,
      interruptedAt: undefined,
      expiresAt: undefined,
    },
  }
}

export function interruptRuntimePlan(
  state: AgentRuntimePlanSessionState | undefined,
  now: number,
): AgentRuntimePlanSessionState | undefined {
  const current = state?.current
  if (!state || !current || allTodosCompleted(current.todos)) return state
  return {
    ...state,
    current: {
      ...current,
      status: 'interrupted',
      // 本轮结束后保留一次“待继续”状态；下一轮 begin 时再隐藏。
      visible: true,
      updatedAt: now,
      interruptedAt: now,
      expiresAt: current.expiresAt ?? now + RUNTIME_PLAN_RETENTION_MS,
    },
  }
}

export function pruneExpiredRuntimePlans(
  states: Map<string, AgentRuntimePlanSessionState>,
  now: number,
): Map<string, AgentRuntimePlanSessionState> {
  const next = new Map<string, AgentRuntimePlanSessionState>()
  for (const [sessionId, state] of states) {
    const archived = state.archived.filter(
      (record) => record.expiresAt == null || record.expiresAt > now,
    )
    const current = (
      state.current?.expiresAt != null
      && state.current.expiresAt <= now
      && state.current.status !== 'active'
    )
      ? undefined
      : state.current
    if (current || archived.length > 0) {
      next.set(sessionId, { ...state, current, archived })
    }
  }
  return next
}

export function runtimePlanStatesFromPersistedStore(
  store: AgentRuntimePlanPersistedStore,
  now: number,
): Map<string, AgentRuntimePlanSessionState> {
  return pruneExpiredRuntimePlans(
    new Map(Object.entries(store.sessions)),
    now,
  )
}

export function runtimePlanStatesToPersistedStore(
  states: Map<string, AgentRuntimePlanSessionState>,
  now: number,
): AgentRuntimePlanPersistedStore {
  return {
    sessions: Object.fromEntries(pruneExpiredRuntimePlans(states, now)),
    updatedAt: now,
  }
}

export function getVisibleRuntimePlanTodos(
  state: AgentRuntimePlanSessionState | undefined,
  fallbackTodos: AgentRuntimeTodoItem[],
): AgentRuntimeTodoItem[] {
  if (!state) return fallbackTodos
  return state.current?.visible ? state.current.todos : []
}
