/**
 * TaskCard — 看板任务卡片（Tailwind 版）
 *
 * 从 dashi TaskCard.tsx 移植行为逻辑：
 * - 顶部：ID + 未读点 + in_review 的「完成」按钮
 * - 标题、媒体预览、标签、优先级、截止日期、负责人、参与人、处理进度
 * - 拖拽：onDragStart 写入 text/plain + application/x-taskboard-task 两种格式
 * - 属性更新：乐观更新 + 防抖保存
 */

import * as React from 'react'
import { Calendar, Flag, FolderKanban, MessageCircle, Pencil, X } from 'lucide-react'
import type { ActorIdentity, Task, TaskDraft } from '@proma/shared'
import { cn } from '@/lib/utils'
import { actorKey, labelPresentation, PRIORITY_CHIP, PRIORITY_LABELS, STATUS_LABELS } from './taskboard-constants'
import { TaskPropertyPicker } from './TaskPropertyPicker'
import { LabelPicker } from './LabelPicker'
import { TaskSessionSummaryChip } from './TaskSessionSummaryChip'

interface TaskCardProps {
  task: Task
  variant?: 'main' | 'sidebar'
  /** 所属项目名（全局视图下显示，只读） */
  projectTag?: string | null
  now: number
  isDragging: boolean
  dragShift: number
  isMoving: boolean
  isSettling: boolean
  isContextMenuOpen: boolean
  availableLabels: string[]
  currentUser: ActorIdentity
  onEdit: (task: Task) => void
  onUpdate: (task: Task, changes: Partial<TaskDraft>) => Promise<Task>
  onComplete?: (task: Task) => void
  onContextMenu: (task: Task, position: { x: number; y: number }) => void
  onDragStart: (task: Task, height: number) => void
  onDragEnd: () => void
  /** 查看/创建任务对话 */
  onOpenConversation?: (task: Task) => void
}

function calendarDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })
    .format(new Date(`${value}T12:00:00`))
}

function createdDate(value: string): string {
  const formatted = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })
    .format(new Date(value))
  return `${formatted} 创建`
}

function elapsedTime(startedAt: string | null, now: number): string {
  if (!startedAt) return ''
  const elapsed = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  if (elapsed < 60) return `${elapsed}s`
  const minutes = Math.floor(elapsed / 60)
  if (minutes < 60) return `${minutes}m${elapsed % 60 ? `${elapsed % 60}s` : ''}`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60 ? `${minutes % 60}m` : ''}`
}

function TaskLabels({ task }: { task: Task }): React.ReactElement {
  return (
    <>
      {task.labels.slice(0, 2).map((label) => {
        const presentation = labelPresentation(label)
        return (
          <span
            key={label}
            className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium"
            style={{ color: presentation.color, backgroundColor: `${presentation.color}1a` }}
          >
            {presentation.tone && (
              <i className="size-1.5 rounded-full" style={{ backgroundColor: presentation.color }} aria-hidden="true" />
            )}
            <span>{presentation.name}</span>
          </span>
        )
      })}
      {task.labels.length > 2 && (
        <span
          className="inline-flex items-center rounded px-1 py-px text-[11px] text-foreground/50"
          title={task.labels.slice(2).map((l) => labelPresentation(l).name).join(', ')}
        >
          +{task.labels.length - 2}
        </span>
      )}
    </>
  )
}

function PriorityControl({
  task, disabled, open, onOpenChange, onChange,
}: {
  task: Task
  disabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (priority: Task['priority']) => void
}): React.ReactElement {
  return (
    <TaskPropertyPicker
      value={task.priority}
      options={(Object.keys(PRIORITY_LABELS) as Task['priority'][]).map((value) => ({
        value,
        label: PRIORITY_LABELS[value] ?? value,
        icon: <Flag size={12} />,
        className: PRIORITY_CHIP[value] ?? '',
      }))}
      open={open}
      disabled={disabled}
      className="card-property-control"
      triggerClassName={cn('inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px]', PRIORITY_CHIP[task.priority] ?? '')}
      ariaLabel={`${task.identifier} 优先级`}
      title={`优先级：${PRIORITY_LABELS[task.priority] ?? task.priority}`}
      onOpenChange={onOpenChange}
      onChange={onChange}
    />
  )
}

function DueDateControl({
  task, disabled, onChange,
}: {
  task: Task
  disabled: boolean
  onChange: (dueDate: string | null) => void
}): React.ReactElement | null {
  if (!task.dueDate) return null
  return (
    <label
      className="inline-flex items-center gap-1 rounded bg-foreground/5 px-1.5 py-px text-[11px] text-foreground/70"
      title={`截止日期 ${task.dueDate}`}
    >
      <Calendar size={11} />
      {calendarDate(task.dueDate)}
      <input
        type="date"
        aria-label={`${task.identifier} 截止日期`}
        value={task.dueDate}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
      />
    </label>
  )
}

function AssigneeControl({
  task, currentUser, disabled, onChange,
}: {
  task: Task
  currentUser: ActorIdentity
  disabled: boolean
  onChange: (target: 'current-user' | 'codex-agent') => void
}): React.ReactElement {
  const options = [task.assignee, currentUser]
    .filter((actor, index, actors) => actor && actors.findIndex((c) => actorKey(c) === actorKey(actor)) === index)
  return (
    <label
      className="inline-flex items-center gap-1 rounded bg-foreground/5 px-1.5 py-px text-[11px] text-foreground/70"
      title={`负责人：${task.assignee.name}`}
    >
      <span className="flex size-4 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">
        {task.assignee.name.slice(0, 1)}
      </span>
      <select
        aria-label={`${task.identifier} 负责人`}
        value={task.assignee.id}
        disabled={disabled}
        onChange={(event) => {
          const selected = options.find((actor) => actor.id === event.target.value)
          if (!selected) return
          const target = selected.type === 'agent' ? 'codex-agent' : selected.id === currentUser.id ? 'current-user' : undefined
          if (target) onChange(target)
        }}
        className="bg-transparent text-[11px] text-inherit outline-none"
      >
        {options.map((actor) => (
          <option value={actor.id} key={actor.id}>
            {actor.id === currentUser.id ? `${actor.name}（我）` : actor.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function ParticipantAvatars({ participants }: { participants: ActorIdentity[] }): React.ReactElement | null {
  if (participants.length === 0) return null
  return (
    <span
      className="inline-flex -space-x-1"
      aria-label={`参与人：${participants.map((p) => p.name).join('、')}`}
    >
      {participants.map((participant) => (
        <span
          key={actorKey(participant)}
          className="flex size-4 items-center justify-center rounded-full border border-background bg-primary/15 text-[9px] font-semibold text-primary"
        >
          {participant.name.slice(0, 1)}
        </span>
      ))}
    </span>
  )
}

export function TaskCard({
  task, variant = 'main', now, isDragging, dragShift, isMoving, isSettling,
  isContextMenuOpen, availableLabels, currentUser, onEdit, onUpdate, onComplete,
  onContextMenu, onDragStart, onDragEnd, projectTag, onOpenConversation,
}: TaskCardProps): React.ReactElement {
  const [propertyMenu, setPropertyMenu] = React.useState<'priority' | 'labels' | null>(null)
  const [savingProperty, setSavingProperty] = React.useState<'priority' | 'labels' | 'dueDate' | 'assignee' | null>(null)

  const processingCard = task.status === 'in_progress'
  const hasProperties = task.priority !== 'none' || task.labels.length > 0 || task.dueDate
  const showsProperties = !processingCard && (hasProperties || task.participants.length > 0)
  const propertyDisabled = savingProperty !== null

  function updateProperty(changes: Partial<TaskDraft>, property: NonNullable<typeof savingProperty>): void {
    setSavingProperty(property)
    void onUpdate(task, changes)
      .catch(() => {})
      .finally(() => setSavingProperty((current) => (current === property ? null : current)))
  }

  return (
    <article
      className={cn(
        'group relative flex flex-col gap-1.5 rounded-lg border border-border/70 bg-card p-2.5 shadow-sm transition-all',
                'hover:border-border hover:shadow-md',
        isDragging && 'opacity-40 ring-2 ring-primary/40',
        dragShift !== 0 && 'transition-transform duration-150',
        isMoving && 'opacity-60',
        isSettling && 'transition-transform duration-200 ease-out',
        isContextMenuOpen && 'ring-2 ring-primary/30',
        propertyMenu && 'shadow-lg',
      )}
      style={dragShift ? { transform: `translate3d(0, ${dragShift}px, 0)` } : undefined}
      draggable={!isMoving}
      aria-labelledby={`task-${task.id}-title`}
      data-task-id={task.id}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(task, { x: event.clientX, y: event.clientY })
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.setData('application/x-taskboard-task', task.id)
        onDragStart(task, event.currentTarget.offsetHeight)
      }}
      onDragEnd={onDragEnd}
    >
      {/* 点击卡片打开编辑 */}
      <button
        className="task-card-open pointer-events-auto absolute inset-0 z-0 cursor-pointer"
        type="button"
        aria-label={`打开 ${task.identifier}: ${task.title}`}
        onClick={() => onEdit(task)}
      />

      {/* 顶部行 */}
      <div className="pointer-events-auto relative z-10 flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-foreground/40">ID: {task.identifier}</span>
        {projectTag && (
          <span
            className="inline-flex max-w-[120px] items-center gap-0.5 truncate rounded bg-foreground/5 px-1 py-px text-[10px] font-medium text-foreground/55"
            title={`所属项目：${projectTag}`}
          >
            <FolderKanban size={9} className="shrink-0 text-foreground/40" />
            <span className="truncate">{projectTag}</span>
          </span>
        )}
        {onOpenConversation && (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-foreground/40 transition-colors hover:text-primary"
            title={task.threadId ? "查看对话" : "开始对话"}
            onClick={(event) => {
              event.stopPropagation()
              onOpenConversation(task)
            }}
          >
            <MessageCircle size={11} />
          </button>
        )}
        {task.status === 'in_review' && onComplete && (
          <button
            className="ml-auto inline-flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-px text-[11px] font-medium text-white hover:bg-emerald-700"
            type="button"
            aria-label={`完成 ${task.identifier}`}
            title="完成"
            onClick={(event) => {
              event.stopPropagation()
              onComplete(task)
            }}
          >
            <span>完成</span>
          </button>
        )}
        {variant === 'sidebar' && (
          <span className="ml-auto inline-flex items-center gap-1">
            <AssigneeControl
              task={task}
              currentUser={currentUser}
              disabled={propertyDisabled}
              onChange={(assigneeTarget) => updateProperty({ assigneeTarget }, 'assignee')}
            />
            <span className="text-[11px] text-foreground/40">{createdDate(task.createdAt)}</span>
          </span>
        )}
      </div>

      {/* 标题 */}
      <h3
        id={`task-${task.id}-title`}
        className="pointer-events-none relative z-10 line-clamp-2 text-[13px] font-medium leading-snug text-foreground/90"
      >
        {task.title}
      </h3>

      {/* 描述首图预览 */}
      {(() => {
        const match = task.description.match(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))/)
        const src = match?.[1] ?? match?.[2]
        if (!src) return null
        return (
          <div className="pointer-events-none relative z-10 overflow-hidden rounded-md border border-border/50">
            <img src={src} alt="" loading="lazy" className="max-h-[180px] w-full object-cover" />
          </div>
        )
      })()}

      {/* 属性区 */}
      {showsProperties && (
        <div className="pointer-events-auto relative z-10 flex flex-wrap items-center gap-1">
          {task.priority !== 'none' && (
            <PriorityControl
              task={task}
              disabled={propertyDisabled}
              open={propertyMenu === 'priority'}
              onOpenChange={(open) => setPropertyMenu(open ? 'priority' : null)}
              onChange={(priority) => updateProperty({ priority }, 'priority')}
            />
          )}
          {task.labels.length > 0 && (
            <LabelPicker
              availableLabels={availableLabels}
              selectedLabels={task.labels}
              open={propertyMenu === 'labels'}
              disabled={propertyDisabled}
              className="card-label-picker card-property-control"
              triggerClassName="inline-flex items-center gap-1 rounded bg-foreground/5 px-1 py-px text-[11px] text-foreground/70 hover:bg-foreground/10"
              triggerContent={<TaskLabels task={task} />}
              onOpenChange={(open) => setPropertyMenu(open ? 'labels' : null)}
              onChange={(labels) => updateProperty({ labels }, 'labels')}
            />
          )}
          <DueDateControl
            task={task}
            disabled={propertyDisabled}
            onChange={(dueDate) => updateProperty({ dueDate, ...(dueDate ? {} : { recurrence: null }) }, 'dueDate')}
          />
          {variant === 'main' && task.participants.length > 0 && (
            <AssigneeControl
              task={task}
              currentUser={currentUser}
              disabled={propertyDisabled}
              onChange={(assigneeTarget) => updateProperty({ assigneeTarget }, 'assignee')}
            />
          )}
        </div>
      )}

      {/* 处理中卡片：进度分段条 + 状态行 */}
      {processingCard && (
        <>
          <div className="pointer-events-none relative z-10 mt-0.5 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400">
              <span className="size-1.5 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
              {elapsedTime(task.activityUpdatedAt, now) ? `已处理 ${elapsedTime(task.activityUpdatedAt, now)}...` : '正在处理...'}
            </span>
          </div>
          {task.threadId && (
            <TaskSessionSummaryChip threadId={task.threadId} status="in_progress" />
          )}
        </>
      )}

      {/* 受阻：阻塞原因摘要 */}
      {task.status === 'blocked' && task.threadId && (
        <TaskSessionSummaryChip threadId={task.threadId} status="blocked" />
      )}
    </article>
  )
}
