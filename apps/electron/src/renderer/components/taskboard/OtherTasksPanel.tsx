/**
 * OtherTasksPanel — 其他任务面板（次列 + 归档）
 *
 * 从 dashi OtherTasksPanel.tsx 移植：
 * - 标签页：待立项 / 已完成 / 已取消 / 已归档
 * - 非归档标签页支持拖拽放入（复用 BoardColumn 的让位算法）
 * - 归档标签页显示恢复 / 永久删除操作
 */

import * as React from 'react'
import type { DragEvent } from 'react'
import { Archive, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { ActorIdentity, Task, TaskDraft, TaskStatus } from '@proma/shared'
import { cn } from '@/lib/utils'
import {
  OTHER_TASK_TABS, STATUS_LABELS, STATUS_TONES,
  type OtherTaskTab,
} from './taskboard-constants'
import { TaskCard } from './TaskCard'

function archivedDate(value: string | null): string {
  if (!value) return ''
  const formatted = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })
    .format(new Date(value))
  return `${formatted} 归档`
}

function ArchivedTaskCard({
  task, busy, restoring, onRestore, onDelete,
}: {
  task: Task
  busy: boolean
  restoring: boolean
  onRestore: (task: Task) => void
  onDelete: (task: Task) => void
}): React.ReactElement {
  return (
    <article className={cn('mb-1.5 rounded-lg border border-border/70 bg-card p-2.5 shadow-sm', `status-${task.status}`)}>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-foreground/40">ID: {task.identifier}</span>
        <span className="ml-auto text-[11px] text-foreground/40">{archivedDate(task.archivedAt)}</span>
      </div>
      <h3 className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-foreground/90">{task.title}</h3>
      <div className="mt-2 flex items-center gap-1.5">
        <span className={cn('inline-flex items-center gap-1 text-[11px]', STATUS_TONES[task.status].text)}>
          <span className={cn('size-1.5 rounded-full', STATUS_TONES[task.status].dot)} />
          {STATUS_LABELS[task.status]}
        </span>
        <button
          className="ml-auto inline-flex items-center gap-1 rounded bg-foreground/5 px-1.5 py-px text-[11px] text-foreground/70 hover:bg-foreground/10"
          type="button"
          disabled={busy}
          onClick={() => onRestore(task)}
        >
          <RotateCcw size={11} />
          {restoring ? '恢复中…' : '恢复'}
        </button>
        <button
          className="inline-flex items-center rounded bg-foreground/5 p-1 text-foreground/50 hover:bg-destructive/10 hover:text-destructive"
          type="button"
          aria-label={`永久删除 ${task.identifier}`}
          title="永久删除"
          disabled={busy}
          onClick={() => onDelete(task)}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </article>
  )
}

interface OtherTasksPanelProps {
  open: boolean
  activeTab: OtherTaskTab
  tasksByStatus: Record<TaskStatus, Task[]>
  archivedTasks: Task[]
  now: number
  isDropTarget: boolean
  draggedTaskId: string | null
  draggedTaskHeight: number
  movingTaskId: string | null
  settlingTaskId: string | null
  contextMenuTaskId: string | null
  availableLabels: string[]
  currentUser: ActorIdentity
  restoringTaskId: string | null
  deletingTaskId: string | null
  onTabChange: (tab: OtherTaskTab) => void
  onCreate: (status: Exclude<OtherTaskTab, 'archived'>) => void
  onRestore: (task: Task) => void
  onDelete: (task: Task) => void
  onEdit: (task: Task) => void
  onUpdate: (task: Task, changes: Partial<TaskDraft>) => Promise<Task>
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

export function OtherTasksPanel({
  open, activeTab, tasksByStatus, archivedTasks, now, isDropTarget, draggedTaskId,
  draggedTaskHeight, movingTaskId, settlingTaskId, contextMenuTaskId, availableLabels,
  currentUser, restoringTaskId, deletingTaskId, onTabChange, onCreate, onRestore,
  onDelete, onEdit, onUpdate, onContextMenu, onDragStart, onDragEnd, onDragEnter, onDrop,
  getProjectTag, onOpenConversation,
}: OtherTasksPanelProps): React.ReactElement {
  const archived = activeTab === 'archived'
  const activeLabel = archived ? '已归档' : STATUS_LABELS[activeTab]
  const tasks = archived ? archivedTasks : tasksByStatus[activeTab]
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
    if (archived) return
    const taskId =
      event.dataTransfer.getData('application/x-taskboard-task') ||
      event.dataTransfer.getData('text/plain')
    if (taskId) onDrop(activeTab, taskId, findDropBefore(event.currentTarget, event.clientY))
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
    <aside
      className={cn(
        'flex w-[280px] min-w-[260px] flex-shrink-0 flex-col rounded-lg bg-foreground/[0.03] transition-all',
        open ? 'opacity-100' : 'hidden',
      )}
      aria-label="其他任务"
      aria-hidden={!open}
    >
      <div className="flex flex-shrink-0 items-center gap-1 px-2 pt-2" role="tablist" aria-label="其他任务状态">
        {OTHER_TASK_TABS.map((tab) => {
          const label = tab === 'archived' ? '已归档' : STATUS_LABELS[tab]
          const count = tab === 'archived' ? archivedTasks.length : tasksByStatus[tab].length
          const selected = tab === activeTab
          return (
            <button
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[12px] transition-colors',
                selected
                  ? 'bg-foreground/10 font-medium text-foreground/85'
                  : 'text-foreground/50 hover:bg-foreground/5 hover:text-foreground/70',
              )}
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="other-tasks-list"
              title={`${label} ${count}`}
              onClick={() => onTabChange(tab)}
            >
              <span>{label}</span>
              <span className="text-[11px] tabular-nums text-foreground/40">{count}</span>
            </button>
          )
        })}
      </div>

      {!archived && (
        <button
          className="mx-2 mt-1 flex flex-shrink-0 items-center justify-center rounded-md border border-dashed border-border/60 py-1 text-[12px] text-foreground/40 transition-colors hover:bg-foreground/5 hover:text-foreground/70"
          type="button"
          aria-label={`在${activeLabel}中新建议题`}
          title={`添加到${activeLabel}`}
          onClick={() => onCreate(activeTab)}
        >
          <Plus size={13} />
        </button>
      )}

      <div
        className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 pt-1"
        role="tabpanel"
        aria-labelledby={`other-tasks-tab-${activeTab}`}
        onDragEnter={() => { if (!archived) onDragEnter(activeTab) }}
        onDragOver={(event) => {
          if (archived) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          onDragEnter(activeTab)
          setDropBeforeTaskId(findDropBefore(event.currentTarget, event.clientY))
        }}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
            setDropBeforeTaskId(undefined)
          }
        }}
        onDrop={handleDrop}
      >
        {archived ? archivedTasks.map((task) => (
          <ArchivedTaskCard
            key={task.id}
            task={task}
            busy={restoringTaskId !== null || deletingTaskId !== null}
            restoring={restoringTaskId === task.id}
            onRestore={onRestore}
            onDelete={onDelete}
          />
        )) : tasks.map((task) => {
          const dragShift = getTaskDragShift(task)
          return (
            <TaskCard
              key={task.id}
              task={task}
              variant="sidebar"
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
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              projectTag={getProjectTag?.(task) ?? null}
              onOpenConversation={onOpenConversation}
            />
          )
        })}
        {tasks.length === 0 && (
          <div className="mt-2 flex flex-col items-center gap-1 rounded-md border border-dashed border-border/60 px-3 py-6 text-center">
            <Archive size={16} className="text-foreground/25" aria-hidden="true" />
            <strong className="text-[12px] text-foreground/50">
              {archived ? '没有已归档议题。' : `没有${activeLabel}。`}
            </strong>
          </div>
        )}
      </div>
    </aside>
  )
}
