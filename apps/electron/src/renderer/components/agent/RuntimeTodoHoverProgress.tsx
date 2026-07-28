import * as React from 'react'
import { Check, Circle, CircleAlert, Loader2 } from 'lucide-react'
import { useAtomValue } from 'jotai'
import type { AgentRuntimeTodoItem } from '@proma/shared'
import { agentRuntimeExecutionGraphsAtom } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'

interface RuntimeTodoHoverProgressProps {
  sessionId: string
}

function isCompleted(todo: AgentRuntimeTodoItem): boolean {
  return todo.status === 'completed'
}

function currentStepIndex(todos: AgentRuntimeTodoItem[]): number {
  const active = todos.findIndex(todo => todo.status === 'in_progress')
  if (active >= 0) return active
  const pending = todos.findIndex(todo => !isCompleted(todo))
  if (pending >= 0) return pending
  return Math.max(0, todos.length - 1)
}

function TodoStatusIcon({ todo }: { todo: AgentRuntimeTodoItem }): React.ReactElement {
  if (todo.status === 'completed') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
        <Check className="size-2.5" strokeWidth={2.5} />
      </span>
    )
  }
  if (todo.status === 'in_progress') {
    return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
  }
  if (todo.status === 'blocked') {
    return <CircleAlert className="size-4 shrink-0 text-amber-500" />
  }
  return <Circle className="size-4 shrink-0 text-muted-foreground/70" />
}

/** 输入框正上方的 CCB Todo 进度；默认收起，鼠标移入显示完整步骤。 */
export function RuntimeTodoHoverProgress({
  sessionId,
}: RuntimeTodoHoverProgressProps): React.ReactElement | null {
  const graphs = useAtomValue(agentRuntimeExecutionGraphsAtom)
  const todos = graphs.get(sessionId)?.todos ?? []
  const [hovered, setHovered] = React.useState(false)

  if (todos.length === 0) return null

  const stepIndex = currentStepIndex(todos)
  const currentTodo = todos[stepIndex]

  return (
    <div
      className="relative z-30 mx-auto -mb-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <div
          className={cn(
            'absolute bottom-full left-1/2 mb-2 w-[min(390px,calc(100vw-3rem))] -translate-x-1/2',
            'rounded-xl bg-popover/98 p-2.5 text-popover-foreground shadow-xl ring-1 ring-black/8',
            'animate-in fade-in zoom-in-95 slide-in-from-bottom-1 duration-150',
          )}
        >
          <div className="space-y-1">
            {todos.map((todo, index) => (
              <div
                key={todo.id}
                className={cn(
                  'flex items-start gap-2 rounded-lg px-2 py-1.5 text-[13px] leading-5',
                  index === stepIndex && 'bg-accent/65',
                )}
              >
                <span className="mt-0.5">
                  <TodoStatusIcon todo={todo} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    'break-words',
                    isCompleted(todo) && 'text-muted-foreground line-through decoration-muted-foreground/45',
                  )}>
                    {todo.content}
                  </p>
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
      )}

      <div
        className={cn(
          'flex h-9 cursor-default items-center gap-2 rounded-full bg-background/95 px-3.5',
          'text-[13px] text-muted-foreground shadow-sm ring-1 ring-border/70 backdrop-blur-md',
          'transition-colors hover:bg-accent/65 hover:text-foreground',
        )}
      >
        {currentTodo?.status === 'in_progress'
          ? <Loader2 className="size-3.5 animate-spin text-primary" />
          : <Circle className="size-3.5 text-primary/60" />}
        <span className="tabular-nums">第 {stepIndex + 1} / {todos.length} 步</span>
      </div>
    </div>
  )
}
