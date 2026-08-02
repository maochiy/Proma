import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  agentRuntimeExecutionGraphsAtom,
  agentSessionStreamingStateAtomFamily,
  agentSidePanelRuntimeHistoryAtom,
} from '@/atoms/agent-atoms'
import { sortRuntimeTodos } from './RuntimeTodoHoverProgress'
import { RuntimePlanList } from './RuntimePlanList'

export function RuntimePlanPanel({
  sessionId,
}: {
  sessionId: string
}): React.ReactElement {
  const graph = useAtomValue(agentRuntimeExecutionGraphsAtom).get(sessionId)
  const history = useAtomValue(agentSidePanelRuntimeHistoryAtom).get(sessionId)
  const running = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
    ?.running === true
  const sourceTodos = graph?.todos.length
    ? graph.todos
    : (history?.todos ?? [])
  const todos = React.useMemo(
    () => sortRuntimeTodos(sourceTodos),
    [sourceTodos],
  )

  return (
    <div
      className="scrollbar-none h-full min-h-0 overflow-y-auto px-3 py-2"
      data-runtime-plan-panel
    >
      {todos.length > 0 ? (
        <RuntimePlanList todos={todos} running={running} />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
          当前没有计划数据。
        </div>
      )}
    </div>
  )
}
