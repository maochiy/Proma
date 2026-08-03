import * as React from 'react'
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  Loader2,
  XCircle,
} from 'lucide-react'
import type { AgentRuntimeTodoItem } from '@proma/shared'
import { cn } from '@/lib/utils'

interface RuntimePlanListProps {
  todos: AgentRuntimeTodoItem[]
  running: boolean
  planActive?: boolean
  compact?: boolean
  className?: string
}

export function runtimeTodoStatusLabel(
  todo: AgentRuntimeTodoItem,
  activelyRunning: boolean,
): string {
  if (todo.status === 'completed') return '执行完成'
  if (todo.status === 'blocked') return '已阻塞'
  if (todo.status === 'in_progress') return activelyRunning ? '执行中' : '待继续'
  return '未执行'
}

export function RuntimeTodoStatusIcon({
  todo,
  activelyRunning,
}: {
  todo: AgentRuntimeTodoItem
  activelyRunning: boolean
}): React.ReactElement {
  if (todo.status === 'completed') {
    return <CheckCircle2 className="size-3.5 text-emerald-500" />
  }
  if (todo.status === 'blocked') {
    return <CircleAlert className="size-3.5 text-amber-500" />
  }
  if (todo.status === 'in_progress' && activelyRunning) {
    return <Loader2 className="size-3.5 animate-spin text-sky-500" />
  }
  if (todo.status === 'in_progress') {
    return <XCircle className="size-3.5 text-muted-foreground" />
  }
  return <Circle className="size-3.5 text-muted-foreground/60" />
}

/** 悬浮面板与右侧计划 Tab 共用的只读计划列表。 */
export function RuntimePlanList({
  todos,
  running,
  planActive = true,
  compact = false,
  className,
}: RuntimePlanListProps): React.ReactElement {
  const activelyRunning = running && planActive
  return (
    <div className={cn('space-y-0.5', className)}>
      {todos.map((todo) => (
        <div
          key={todo.id}
          className="flex items-start gap-2 rounded-lg px-2 py-1.5"
          data-todo-status={todo.status}
        >
          <span className="mt-0.5 shrink-0">
            <RuntimeTodoStatusIcon
              todo={todo}
              activelyRunning={activelyRunning}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                'block truncate text-xs leading-5',
                todo.status === 'completed' && 'text-muted-foreground line-through',
              )}
            >
              {todo.content}
            </span>
            {!compact && todo.status === 'in_progress' && todo.activeForm && (
              <span className="block truncate text-[10px] text-muted-foreground">
                {todo.activeForm}
              </span>
            )}
            {!compact && (todo.owner || (todo.blockedBy?.length ?? 0) > 0) && (
              <span className="block truncate text-[10px] text-muted-foreground">
                {todo.owner ? `负责人：${todo.owner}` : ''}
                {todo.owner && (todo.blockedBy?.length ?? 0) > 0 ? ' · ' : ''}
                {(todo.blockedBy?.length ?? 0) > 0
                  ? `等待：${todo.blockedBy?.join('、')}`
                  : ''}
              </span>
            )}
          </span>
          <span
            className={cn(
              'shrink-0 pt-0.5 text-[10px] text-muted-foreground',
              todo.status === 'in_progress' && activelyRunning && 'text-sky-500',
              todo.status === 'completed' && 'text-emerald-500',
              todo.status === 'blocked' && 'text-amber-500',
            )}
          >
            {runtimeTodoStatusLabel(todo, activelyRunning)}
          </span>
        </div>
      ))}
    </div>
  )
}
