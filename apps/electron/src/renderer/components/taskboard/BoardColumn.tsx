/**
 * BoardColumn — 看板列（Tailwind 版）
 *
 * 从 dashi BoardColumn.tsx 完整移植拖拽让位逻辑：
 * - draggedTaskIndex / remainingIndexes / beforeIndex / previewIndex
 * - dragDistance = draggedTaskHeight + 8
 * - getTaskDragShift 计算每张卡的 translate3d 位移
 * - findDropBefore 按 clientY 找插入点
 */

import * as React from 'react'
import type { DragEvent } from 'react'
import { Plus } from 'lucide-react'
import type { ActorIdentity, Task, TaskDraft, TaskStatus } from '@proma/shared'
import { cn } from '@/lib/utils'
import { STATUS_LABELS, STATUS_TONES } from './taskboard-constants'
import { TaskCard } from './TaskCard'

interface BoardColumnProps {
  scrollRef: (element: HTMLDivElement | null) => void
  status: TaskStatus
  tasks: Task[]
  now: number
  emptyMessage: string
  isDropTarget: boolean
  draggedTaskId: string | null
  draggedTaskHeight: number
  movingTaskId: string | null
  settlingTaskId: string | null
  contextMenuTaskId: string | null
  availableLabels: string[]
  currentUser: ActorIdentity
  onCreate: (status: TaskStatus) => void
  onEdit: (task: Task) => void
  onUpdate: (task: Task, changes: Partial<TaskDraft>) => Promise<Task>
  onComplete: (task: Task) => void
  onContextMenu: (task: Task, position: { x: number; y: number }) => void
  onDragStart: (task: Task, height: number) => void
  onDragEnd: () => void
  onDragEnter: (status: TaskStatus) => void
  onDrop: (status: TaskStatus, taskId: string, beforeTaskId: string | null) => void
  /** 根据任务返回所属项目名（全局视图下显示项目 tag） */
  getProjectTag?: (task: Task) => string | null
  /** 查看/创建任务对话 */
  onOpenConversation?: (task: Task) => void
}

export function BoardColumn({
  scrollRef, status, tasks, now, emptyMessage, isDropTarget, draggedTaskId,
  draggedTaskHeight, movingTaskId, settlingTaskId, contextMenuTaskId,
  availableLabels, currentUser, onCreate, onEdit, onUpdate, onComplete,
  onContextMenu, onDragStart, onDragEnd, onDragEnter, onDrop, getProjectTag,
  onOpenConversation,
}: BoardColumnProps): React.ReactElement {
  const tone = STATUS_TONES[status]
  const label = STATUS_LABELS[status]
  const [dropBeforeTaskId, setDropBeforeTaskId] = React.useState<string | null | undefined>()
  const taskIndexes = new Map(tasks.map((task, index) => [task.id, index]))
  const remainingTasks = tasks.filter((task) => task.id !== draggedTaskId)
  const remainingIndexes = new Map(remainingTasks.map((task, index) => [task.id, index]))
  const draggedTaskIndex = draggedTaskId ? taskIndexes.get(draggedTaskId) ?? -1 : -1
  const beforeIndex = dropBeforeTaskId
    ? remainingIndexes.get(dropBeforeTaskId) ?? remainingTasks.length
    : remainingTasks.length
  const previewIndex = isDropTarget && dropBeforeTaskId !== undefined ? beforeIndex : -1
  const dragDistance = draggedTaskHeight + 8

  React.useEffect(() => {
    if (!isDropTarget || !draggedTaskId) setDropBeforeTaskId(undefined)
  }, [draggedTaskId, isDropTarget])

  function findDropBefore(container: HTMLElement, clientY: number): string | null {
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-task-id]'))
      .filter((card) => card.dataset.taskId !== draggedTaskId)
    return cards.find((card) => clientY < card.getBoundingClientRect().top + card.offsetHeight / 2)
      ?.dataset.taskId ?? null
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
    const taskId =
      event.dataTransfer.getData('application/x-taskboard-task') ||
      event.dataTransfer.getData('text/plain')
    if (taskId) onDrop(status, taskId, findDropBefore(event.currentTarget, event.clientY))
    setDropBeforeTaskId(undefined)
  }

  function getTaskDragShift(task: Task): number {
    if (!draggedTaskId || task.id === draggedTaskId) return 0
    let shift = 0
    const taskIndex = taskIndexes.get(task.id) ?? -1
    const remainingIndex = remainingIndexes.get(task.id) ?? -1

    if (draggedTaskIndex >= 0 && taskIndex > draggedTaskIndex) shift -= dragDistance
    if (previewIndex >= 0 && remainingIndex >= previewIndex) shift += dragDistance
    return shift
  }

  return (
    <section
      className={cn(
        'flex h-full w-[280px] min-w-[260px] flex-1 flex-col rounded-lg transition-colors',
        isDropTarget ? 'bg-foreground/[0.06] ring-1 ring-primary/30' : 'bg-foreground/[0.03]',
      )}
      aria-labelledby={`column-${status}`}
      onDragEnter={() => onDragEnter(status)}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragEnter(status)
        setDropBeforeTaskId(findDropBefore(event.currentTarget, event.clientY))
      }}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setDropBeforeTaskId(undefined)
        }
      }}
      onDrop={handleDrop}
    >
      <header className="flex flex-shrink-0 items-center gap-2 px-3 py-2">
        <span className={cn('flex items-center gap-1.5')}>
          <span className={cn('size-2 rounded-full', tone.dot)} />
          <h2 id={`column-${status}`} className="text-[13px] font-semibold text-foreground/85">{label}</h2>
        </span>
        <span className="text-[12px] font-medium tabular-nums text-foreground/40">{tasks.length}</span>
        <button
          type="button"
          className="ml-auto flex size-5 items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground/80"
          onClick={() => onCreate(status)}
          aria-label={`在${label}中新建议题`}
          title={`添加到${label}`}
        >
          <Plus size={14} />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2" ref={scrollRef}>
        {tasks.map((task) => {
          const dragShift = getTaskDragShift(task)
          return (
            <TaskCard
              key={task.id}
              task={task}
              now={now}
              isDragging={draggedTaskId === task.id}
              dragShift={dragShift}
              isMoving={movingTaskId === task.id}
              isSettling={settlingTaskId === task.id}
              isContextMenuOpen={contextMenuTaskId === task.id}
              availableLabels={availableLabels}
              currentUser={currentUser}
              onEdit={onEdit}
              onUpdate={onUpdate}
              onComplete={onComplete}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              projectTag={getProjectTag?.(task) ?? null}
              onOpenConversation={onOpenConversation}
            />
          )
        })}
        {tasks.length === 0 && (
          <div className="mt-2 rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-[12px] text-foreground/30">
            {emptyMessage}
          </div>
        )}
      </div>
    </section>
  )
}
