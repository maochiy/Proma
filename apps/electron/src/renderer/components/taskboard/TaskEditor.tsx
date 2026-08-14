/**
 * TaskEditor — 任务新建/编辑对话框
 *
 * 从 dashi TaskEditor.tsx 移植核心交互（Tailwind 版）：
 * - 新建：标题、描述、状态、优先级、负责人、标签、截止日期、重复
 * - 编辑：标题、描述、属性修改
 * - cmd/ctrl + Enter 快速创建；校验标题非空
 * - 点击遮罩 / Esc 关闭，关闭时保留草稿
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Calendar, Flag, LoaderCircle, MessageCircle, MoreHorizontal, Tag, X } from 'lucide-react'
import type {
  ActorIdentity, Recurrence, Task, TaskDraft, TaskPriority, TaskStatus,
} from '@proma/shared'
import { cn } from '@/lib/utils'
import {
  PRIORITY_LABELS, PRIORITY_CHIP, STATUS_LABELS, STATUS_TONES,
  actorKey, assigneeTargetForActor,
} from './taskboard-constants'
import { TaskPropertyPicker } from './TaskPropertyPicker'
import { LabelPicker } from './LabelPicker'
import { ModelPicker } from './ModelPicker'
import { useTaskSessionSummary } from '@/hooks/useTaskSessionSummary'

const RECURRENCE_UNITS: Record<Recurrence['unit'], string> = {
  day: '天', week: '周', month: '月', year: '年',
}

function isoDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}
function dateFromNow(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return isoDate(date)
}
function endOfWeek(): string {
  const date = new Date()
  const daysUntilFriday = (5 - date.getDay() + 7) % 7
  date.setDate(date.getDate() + daysUntilFriday)
  return isoDate(date)
}
function displayDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' })
    .format(new Date(`${value}T12:00:00`))
}

export interface NewTaskEditorDraft {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignee: ActorIdentity
  selectedLabels: string[]
  dueDate: string
  recurrence: Recurrence | null
}

interface TaskEditorProps {
  task: Task | null
  initialStatus: TaskStatus
  initialDraft: NewTaskEditorDraft | null
  labels: string[]
  currentUser: ActorIdentity
  /** 可选的执行模型（拖入处理中自动执行时使用） */
  modelOptions?: import('@proma/shared').ModelOption[]
  modelLoading?: boolean
  onOpenConversation?: (task: Task) => void
  onCancel: (draft: NewTaskEditorDraft | null) => void
  onSave: (draft: TaskDraft) => Promise<void>
}

export function TaskEditor({
  task, initialStatus, initialDraft, labels: availableLabels, currentUser,
  modelOptions, modelLoading, onOpenConversation, onCancel, onSave,
}: TaskEditorProps): React.ReactElement {
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const titleRef = React.useRef<HTMLTextAreaElement>(null)
  const createSubmitIntentRef = React.useRef(false)
  const moreAnchorRef = React.useRef<HTMLDivElement>(null)
  const moreMenuRef = React.useRef<HTMLDivElement>(null)
  const [morePosition, setMorePosition] = React.useState({ left: 0, top: 0 })
  const [title, setTitle] = React.useState(task?.title ?? initialDraft?.title ?? '')
  const [description, setDescription] = React.useState(task?.description ?? initialDraft?.description ?? '')
  const [status, setStatus] = React.useState<TaskStatus>(task?.status ?? initialStatus)
  const [priority, setPriority] = React.useState<TaskPriority>(task?.priority ?? initialDraft?.priority ?? 'none')
  const [assignee, setAssignee] = React.useState<ActorIdentity>(task?.assignee ?? initialDraft?.assignee ?? currentUser)
  const [selectedLabels, setSelectedLabels] = React.useState<string[]>(task?.labels ?? initialDraft?.selectedLabels ?? [])
  const [dueDate, setDueDate] = React.useState(task?.dueDate ?? initialDraft?.dueDate ?? '')
  const [recurrence, setRecurrence] = React.useState<Recurrence | null>(task?.recurrence ?? initialDraft?.recurrence ?? null)
  const [agentModelId, setAgentModelId] = React.useState<string | null>(task?.agentModelId ?? null)
  const progressSummary = useTaskSessionSummary(
    task?.threadId ?? null,
    task && (task.status === 'in_progress' || task.status === 'blocked') ? (task.status === 'blocked' ? 'blocked' : 'progress') : 'progress',
  )
  const [menu, setMenu] = React.useState<'status' | 'priority' | 'assignee' | 'labels' | 'more' | 'due' | 'recurrence' | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const assigneeOptions = [task?.assignee, currentUser]
    .filter((actor): actor is ActorIdentity => actor !== undefined)
    .filter((actor, index, actors) => (
      actors.findIndex((candidate) => actorKey(candidate) === actorKey(actor)) === index
    ))

  React.useEffect(() => {
    dialogRef.current?.showModal()
    titleRef.current?.focus()
    return () => {
      if (dialogRef.current?.open) dialogRef.current.close()
    }
  }, [])

  React.useEffect(() => {
    const titleElement = titleRef.current
    if (!titleElement) return
    const resizeTitle = (): void => {
      titleElement.style.height = '0px'
      titleElement.style.height = `${titleElement.scrollHeight}px`
    }
    resizeTitle()
  }, [title])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!task) {
      if (!createSubmitIntentRef.current) return
      createSubmitIntentRef.current = false
    }
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('请为议题填写一个简短、明确的标题。')
      titleRef.current?.focus()
      return
    }
    if (recurrence && !dueDate) {
      setError('重复议题需要先设置最早截止日期。')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const assigneeTarget = task && actorKey(assignee) === actorKey(task.assignee)
        ? undefined
        : assignee.type === 'agent'
          ? 'codex-agent'
          : assignee.id === currentUser.id
            ? 'current-user'
            : undefined
      await onSave({
        title: cleanTitle,
        description: description.trim(),
        status,
        priority,
        labels: selectedLabels,
        agentModelId,
        agentChannelId: modelOptions?.find((option) => option.modelId === agentModelId)?.channelId ?? null,
        ...(assigneeTarget ? { assigneeTarget } : {}),
        developmentContext: task?.developmentContext ?? null,
        startDate: task?.startDate ?? null,
        dueDate: dueDate || null,
        recurrence,
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法保存这个议题。')
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>): void {
    if ((event.nativeEvent as unknown as { isComposing?: boolean }).isComposing || event.keyCode === 229) return
    if (event.key !== 'Enter') return
    if (!task && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      createSubmitIntentRef.current = true
      event.currentTarget.requestSubmit()
      return
    }
    if (event.target !== titleRef.current) return
    event.preventDefault()
    if (task) event.currentTarget.requestSubmit()
  }

  function cancelEditor(): void {
    onCancel(task ? null : {
      title, description, status, priority, assignee, selectedLabels, dueDate, recurrence,
    })
  }

  const isMoreMenuOpen = menu === 'more' || menu === 'due' || menu === 'recurrence'

  // 「更多」弹层点击外部 / Escape / resize / scroll 关闭（与 TaskPropertyPicker 一致）
  React.useEffect(() => {
    if (!isMoreMenuOpen) return
    function closeFromOutside(event: PointerEvent): void {
      const target = event.target as Node
      if (!moreAnchorRef.current?.contains(target) && !moreMenuRef.current?.contains(target)) {
        setMenu(null)
      }
    }
    function closeFromEscape(event: globalThis.KeyboardEvent): void {
      if (event.key !== 'Escape') return
      setMenu(null)
    }
    function closeFromViewportChange(): void {
      setMenu(null)
    }
    document.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('keydown', closeFromEscape)
    window.addEventListener('resize', closeFromViewportChange)
    window.addEventListener('scroll', closeFromViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      window.removeEventListener('keydown', closeFromEscape)
      window.removeEventListener('resize', closeFromViewportChange)
      window.removeEventListener('scroll', closeFromViewportChange, true)
    }
  }, [isMoreMenuOpen])

  // 「更多」弹层定位：与 TaskPropertyPicker 同款（fixed + 视口边缘防溢出）
  React.useLayoutEffect(() => {
    if (!isMoreMenuOpen) return
    const anchor = moreAnchorRef.current
    const popover = moreMenuRef.current
    if (!anchor || !popover) return
    const anchorRect = anchor.getBoundingClientRect()
    const popoverRect = popover.getBoundingClientRect()
    const gap = 4
    const edge = 8
    const openAbove = anchorRect.bottom + gap + popoverRect.height > window.innerHeight - edge
      && anchorRect.top - gap - popoverRect.height >= edge
    const left = Math.max(edge, Math.min(anchorRect.right - popoverRect.width, window.innerWidth - popoverRect.width - edge))
    const top = openAbove ? anchorRect.top - popoverRect.height - gap : anchorRect.bottom + gap
    // 仅在实际位置变化时更新，避免触发多余渲染导致死循环
    setMorePosition((prev) => (
      prev.left === left && prev.top === top ? prev : { left, top: Math.max(edge, top) }
    ))
    // 菜单打开 / 子菜单切换（more→due→recurrence）时重新定位；内容宽度变化由渲染后测量保证
  }, [isMoreMenuOpen, menu])

  function chooseDueDate(value: string): void {
    setDueDate(value)
    setMenu(null)
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="task-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) cancelEditor()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) cancelEditor()
      }}
      className="fixed inset-0 z-[300] m-auto max-h-[min(760px,calc(100vh-32px))] w-[750px] max-w-[92vw] overflow-visible rounded-xl border border-border/70 bg-background p-0 shadow-2xl backdrop:bg-black/40"
    >
      <form className="flex max-h-[min(760px,calc(100vh-32px))] flex-col overflow-y-auto" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
        <header className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <strong id="task-dialog-title" className="text-[14px] font-semibold text-foreground">
            {task ? task.identifier : '新建议题'}
          </strong>
          <button
            type="button"
            className="ml-auto flex size-6 items-center justify-center rounded-md text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
            onClick={cancelEditor}
            disabled={saving}
            aria-label="关闭编辑器"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex flex-col gap-2 px-4 py-3">
          <label className="block">
            <span className="sr-only">标题</span>
            <textarea
              ref={titleRef}
              rows={1}
              value={title}
              onChange={(event) => setTitle(event.target.value.replace(/\n/g, ''))}
              placeholder="议题标题"
              maxLength={240}
              autoComplete="off"
              className="w-full resize-none bg-transparent text-[18px] font-semibold text-foreground outline-none placeholder:text-foreground/30"
            />
          </label>
          <label className="block">
            <span className="sr-only">描述</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="添加描述…"
              rows={5}
              className="w-full resize-y rounded-md border border-border/60 bg-transparent px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50"
            />
          </label>
        </div>

        {/* 元信息：受阻 + 会话联动 */}
        {task && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2">
            {task.relations.blockedBy.length > 0 && status === 'blocked' && (
              <div className="flex items-center gap-1.5 rounded-md bg-red-100/70 px-2 py-1 text-[12px] text-red-700 dark:bg-red-900/40 dark:text-red-300">
                <span className="size-2 rounded-full bg-red-500" />
                <span className="font-medium">被阻塞</span>
              </div>
            )}
            {task.relations.blockedBy.map((issue) => (
              <span
                key={issue.id}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] text-foreground/70"
                title={`${issue.identifier} · ${issue.title}`}
              >
                <span className={cn('size-2 rounded-full', {
                  'bg-red-400': issue.status === 'blocked',
                  'bg-amber-400': issue.status === 'in_review',
                  'bg-blue-500': issue.status === 'in_progress',
                  'bg-sky-400': issue.status === 'todo',
                  'bg-emerald-400': issue.status === 'done',
                  'bg-zinc-400': issue.status === 'canceled' || issue.status === 'backlog',
                })} />
                {issue.identifier} · {issue.title}
              </span>
            ))}
            {onOpenConversation && (
              <button
                type="button"
                onClick={() => onOpenConversation(task)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] text-foreground/70 transition-colors hover:bg-foreground/5"
                title={task.threadId ? "打开任务绑定的会话" : "创建会话并关联任务"}
              >
                <MessageCircle size={13} className="text-primary" />
                {task.threadId ? '查看对话' : '开始对话'}
              </button>
            )}
          </div>
        )}

        {/* 处理中 / 受阻：会话摘要 */}
        {task && task.threadId && (task.status === 'in_progress' || task.status === 'blocked') && (
          <div className="border-t border-border/60 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className={cn('size-1.5 rounded-full', task.status === 'blocked' ? 'bg-red-500' : 'bg-blue-500 animate-pulse')} />
              <span className="text-[11px] font-medium text-foreground/60">
                {task.status === 'blocked' ? '阻塞原因' : '最新进度'}
              </span>
              {progressSummary.running && (
                <span className="inline-flex items-center gap-1 text-[11px] text-blue-500">
                  <LoaderCircle size={11} className="animate-spin" />
                  运行中
                </span>
              )}
            </div>
            <div className="mt-1.5 rounded-md border border-border/50 bg-foreground/[0.03] px-3 py-2 text-[12px] leading-relaxed text-foreground/75">
              {progressSummary.loading
                ? <span className="text-foreground/40">正在读取会话进度…</span>
                : progressSummary.summary
                  ? <p className="whitespace-pre-wrap">{progressSummary.summary}</p>
                  : <span className="text-foreground/40">暂无会话摘要</span>}
            </div>
          </div>
        )}

        <div className="border-t border-border/60 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <ModelPicker
              modelId={agentModelId}
              options={modelOptions ?? []}
              loading={modelLoading}
              onChange={setAgentModelId}
            />
            <TaskPropertyPicker
              value={status}
              options={(Object.keys(STATUS_LABELS) as TaskStatus[]).map((value) => ({
                value,
                label: STATUS_LABELS[value],
                icon: <span className={cn('size-2 rounded-full', STATUS_TONES[value].dot)} />,
              }))}
              open={menu === 'status'}
              triggerClassName={cn('inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[12px] text-foreground/80 hover:bg-foreground/5')}
              ariaLabel="状态"
              onOpenChange={(open) => setMenu(open ? 'status' : null)}
              onChange={setStatus}
            />
            <TaskPropertyPicker
              value={priority}
              options={(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((value) => ({
                value,
                label: PRIORITY_LABELS[value] ?? value,
                icon: <Flag size={12} />,
                className: PRIORITY_CHIP[value] ?? '',
              }))}
              open={menu === 'priority'}
              triggerClassName={cn('inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[12px] text-foreground/80 hover:bg-foreground/5')}
              ariaLabel="优先级"
              onOpenChange={(open) => setMenu(open ? 'priority' : null)}
              onChange={setPriority}
            />
            <TaskPropertyPicker
              value={actorKey(assignee)}
              options={assigneeOptions.map((actor) => ({
                value: actorKey(actor),
                label: actor.id === currentUser.id ? `${actor.name}（我）` : actor.name,
                icon: <span className="flex size-4 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">{actor.name.slice(0, 1)}</span>,
              }))}
              open={menu === 'assignee'}
              triggerClassName="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[12px] text-foreground/80 hover:bg-foreground/5"
              ariaLabel="负责人"
              onOpenChange={(open) => setMenu(open ? 'assignee' : null)}
              onChange={(value) => {
                const selected = assigneeOptions.find((actor) => actorKey(actor) === value)
                if (selected) setAssignee(selected)
              }}
            />
            <LabelPicker
              availableLabels={availableLabels}
              selectedLabels={selectedLabels}
              open={menu === 'labels'}
              showIcon
              triggerClassName="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[12px] text-foreground/80 hover:bg-foreground/5"
              onOpenChange={(open) => setMenu(open ? 'labels' : null)}
              onChange={setSelectedLabels}
            />

            {dueDate && (
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[12px] text-foreground/80 hover:bg-foreground/5"
                type="button"
                onClick={() => setMenu('due')}
              >
                <Calendar size={12} />
                截止 {displayDate(dueDate)}
              </button>
            )}
            {recurrence && (
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[12px] text-foreground/80 hover:bg-foreground/5"
                type="button"
                onClick={() => setMenu('recurrence')}
              >
                每 {recurrence.interval} {RECURRENCE_UNITS[recurrence.unit]}
              </button>
            )}

        <div ref={moreAnchorRef} className="relative ml-auto">
          <button
            className="inline-flex items-center rounded-md border border-border/60 px-2 py-1 text-[12px] text-foreground/80 hover:bg-foreground/5"
            type="button"
            aria-label="更多属性"
            onClick={() => setMenu(menu === 'more' ? null : 'more')}
          >
            <MoreHorizontal size={13} />
          </button>
          {(menu === 'more' || menu === 'due' || menu === 'recurrence') && createPortal(
            <div
              ref={moreMenuRef}
              style={{ position: 'fixed', left: morePosition.left, top: morePosition.top }}
              className="z-[500] rounded-lg border border-border/70 bg-popover shadow-xl"
            >
              {menu === 'more' && (
                <div className="w-44 p-1">
                  <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-popover-foreground/85 hover:bg-accent" type="button" onClick={() => setMenu('due')}>
                    <Calendar size={13} /> 设置截止日期
                  </button>
                  <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-popover-foreground/85 hover:bg-accent" type="button" onClick={() => setMenu('recurrence')}>
                    <Tag size={13} /> 设置重复…
                  </button>
                </div>
              )}
              {menu === 'due' && (
                <div className="w-48 p-1">
                  <label className="mb-1 flex items-center gap-2 rounded-md px-2 py-1 text-[12px] text-popover-foreground/85">
                    <span>自定义…</span>
                    <input type="date" value={dueDate} onChange={(event) => chooseDueDate(event.target.value)} className="ml-auto rounded border border-border/60 bg-background px-1 text-[11px]" />
                  </label>
                  {[
                    { label: '明天', value: dateFromNow(1) },
                    { label: '本周结束', value: endOfWeek() },
                    { label: '一周后', value: dateFromNow(7) },
                  ].map((item) => (
                    <button key={item.label} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[12px] text-popover-foreground/85 hover:bg-accent" type="button" onClick={() => chooseDueDate(item.value)}>
                      <strong>{item.label}</strong><span className="text-[11px] text-foreground/40">{displayDate(item.value)}</span>
                    </button>
                  ))}
                  {dueDate && (
                    <button className="flex w-full items-center rounded-md px-2 py-1.5 text-[12px] text-destructive hover:bg-destructive/10" type="button" onClick={() => { setDueDate(''); setRecurrence(null); setMenu(null) }}>
                      清除截止日期
                    </button>
                  )}
                </div>
              )}
              {menu === 'recurrence' && (
                <div className="w-56 p-2">
                  <label className="mb-2 flex items-center gap-2 text-[12px] text-popover-foreground/85">
                    <span>最早截止日期</span>
                    <input type="date" value={dueDate || dateFromNow(7)} onChange={(event) => setDueDate(event.target.value)} className="ml-auto rounded border border-border/60 bg-background px-1 text-[11px]" />
                  </label>
                  <label className="mb-2 flex items-center gap-2 text-[12px] text-popover-foreground/85">
                    <span>重复频率</span>
                    <span className="ml-auto flex items-center gap-1">
                      <input type="number" min={1} max={365} value={recurrence?.interval ?? 1} onChange={(event) => setRecurrence({ interval: Number(event.target.value), unit: recurrence?.unit ?? 'week' })} className="w-14 rounded border border-border/60 bg-background px-1 text-[11px]" />
                      <select value={recurrence?.unit ?? 'week'} onChange={(event) => setRecurrence({ interval: recurrence?.interval ?? 1, unit: event.target.value as Recurrence['unit'] })} className="rounded border border-border/60 bg-background px-1 text-[11px]">
                        {(Object.keys(RECURRENCE_UNITS) as Recurrence['unit'][]).map((unit) => <option value={unit} key={unit}>{RECURRENCE_UNITS[unit]}</option>)}
                      </select>
                    </span>
                  </label>
                  <button className="w-full rounded-md bg-primary px-2 py-1 text-[12px] font-medium text-primary-foreground hover:bg-primary/90" type="button" onClick={() => { if (!dueDate) setDueDate(dateFromNow(7)); if (!recurrence) setRecurrence({ interval: 1, unit: 'week' }); setMenu(null) }}>
                    设置重复
                  </button>
                  {recurrence && (
                    <button className="mt-1 w-full rounded-md px-2 py-1 text-[12px] text-destructive hover:bg-destructive/10" type="button" onClick={() => { setRecurrence(null); setMenu(null) }}>
                      清除重复
                    </button>
                  )}
                </div>
              )}
            </div>,
            dialogRef.current ?? document.body,
          )}
        </div>
          </div>

          {error && (
            <div className="mt-2 rounded-md bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive" role="alert">{error}</div>
          )}

          <footer className="mt-2 flex items-center justify-end gap-2">
            <span className="mr-auto text-[11px] text-foreground/40" aria-hidden="true">
              {task ? `编辑 ${task.identifier}` : ''}
            </span>
            <button
              className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              type="submit"
              disabled={saving}
              onClick={() => { if (!task) createSubmitIntentRef.current = true }}
            >
              {saving ? '正在保存…' : task ? '保存更改' : '创建议题'}
            </button>
          </footer>
        </div>
      </form>
    </dialog>
  )
}
