import * as React from 'react'
import { Check, Circle, CircleAlert } from 'lucide-react'
import { useAtomValue } from 'jotai'
import type { AgentRuntimeTodoItem } from '@proma/shared'
import { agentRuntimeExecutionGraphsAtom } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'

interface RuntimeTodoHoverProgressProps {
  sessionId: string
}

const FLOATING_PLAN_CARD_CLASS =
  'rounded-[14px] border border-black/[0.07] bg-card text-card-foreground shadow-md dark:border-white/[0.10]'

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
  if (todo.status === 'blocked') {
    return <CircleAlert className="size-4 shrink-0 text-amber-500" />
  }
  return <Circle className="size-4 shrink-0 text-foreground/85" strokeWidth={1.75} />
}

/** 输入框正上方的 CCB Todo 进度；默认收起，鼠标移入显示完整步骤。 */
export function RuntimeTodoHoverProgress({
  sessionId,
}: RuntimeTodoHoverProgressProps): React.ReactElement | null {
  const graphs = useAtomValue(agentRuntimeExecutionGraphsAtom)
  const todos = graphs.get(sessionId)?.todos ?? []

  if (todos.length === 0) return null

  const stepIndex = currentStepIndex(todos)

  return (
    <div
      className="group relative z-30 mx-auto mb-2 w-fit"
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
        <Circle
          className="size-3.5 shrink-0 text-sky-200 dark:text-sky-400/75"
          strokeWidth={2}
        />
        <span className="tabular-nums">第 {stepIndex + 1} / {todos.length} 步</span>
      </div>
    </div>
  )
}
