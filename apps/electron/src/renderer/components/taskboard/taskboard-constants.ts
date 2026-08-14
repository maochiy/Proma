/**
 * 任务看板常量与工具函数
 *
 * 从 dashi-taskboard 的 issueBoardStatuses / labels / actors 移植，
 * 用 Tailwind 重写视觉表现，保留行为语义。
 */

import type { Task, TaskStatus } from '@proma/shared'
import { TASKBOARD_CODEX_AGENT } from '@proma/shared'

/** 看板主列（四列） */
export const MAIN_STATUSES = ['todo', 'in_progress', 'blocked', 'in_review'] as const satisfies readonly TaskStatus[]

/** 次列（其他任务面板） */
export const SECONDARY_STATUSES = ['backlog', 'done', 'canceled'] as const satisfies readonly TaskStatus[]

/** 其他任务面板的标签页 */
export const OTHER_TASK_TABS = [...SECONDARY_STATUSES, 'archived'] as const

export type MainTaskStatus = (typeof MAIN_STATUSES)[number]
export type SecondaryTaskStatus = (typeof SECONDARY_STATUSES)[number]
export type OtherTaskTab = (typeof OTHER_TASK_TABS)[number]

/** 状态的中文标签 */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: '待立项',
  todo: '待处理',
  in_progress: '处理中',
  in_review: '待确认',
  blocked: '受阻',
  done: '已完成',
  canceled: '已取消',
}

/** 状态对应的 Tailwind 视觉（圆点 / 图标底色） */
export const STATUS_TONES: Record<TaskStatus, { dot: string; text: string; bg: string }> = {
  backlog: { dot: 'bg-slate-400', text: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800' },
  todo: { dot: 'bg-sky-400', text: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-100 dark:bg-sky-900/40' },
  in_progress: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900/40' },
  in_review: { dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/40' },
  blocked: { dot: 'bg-red-400', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/40' },
  done: { dot: 'bg-emerald-400', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/40' },
  canceled: { dot: 'bg-zinc-400', text: 'text-zinc-500 dark:text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800' },
}

/** 优先级中文标签 */
export const PRIORITY_LABELS: Record<string, string> = {
  none: '无优先级',
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
}

/** 优先级视觉效果（chip） */
export const PRIORITY_CHIP: Record<string, string> = {
  none: 'bg-foreground/5 text-foreground/50',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  low: 'bg-foreground/5 text-foreground/60',
}

/** 默认标签色板（来自 dashi labels.ts） */
export const DEFAULT_LABEL_COLORS: Record<string, string> = {
  缺陷: '#eb5757',
  特性: '#bb87fc',
  'for-claude': '#5b8cff',
  hold: '#d99b25',
  改进: '#4ea7fc',
  'phase-1': '#1d4ed8',
  'phase-2': '#0f766e',
  'phase-3': '#7c3aed',
  'phase-4': '#b45309',
  'phase-5': '#be123c',
  'phase-6': '#475569',
}

/** 标签的展示名（BUG / 新功能 等特殊映射） */
export function labelDisplayName(name: string): string {
  if (name === '缺陷' || name.toUpperCase() === 'BUG') return 'BUG'
  if (name === '特性' || name === '新功能') return '新功能'
  if (name === '改进') return '改进'
  return name
}

/** 标签色调（影响 chip 底色） */
export function labelTone(name: string): 'bug' | 'feature' | null {
  if (name === '缺陷' || name.toUpperCase() === 'BUG') return 'bug'
  if (name === '特性' || name === '新功能') return 'feature'
  return null
}

/** 标签颜色（按名称查色板，未知标签用灰色） */
export function labelColor(name: string): string {
  return DEFAULT_LABEL_COLORS[name] ?? '#8b8d92'
}

/** 标签展示信息 */
export function labelPresentation(name: string): { name: string; tone: 'bug' | 'feature' | null; color: string } {
  const tone = labelTone(name)
  return {
    name: labelDisplayName(name),
    tone,
    color: tone === 'bug' ? '#eb5757' : tone === 'feature' ? '#bb87fc' : labelColor(name),
  }
}

/** 操作者身份 → 唯一键（user:id / agent:id） */
export function actorKey(actor: { type: string; id: string }): string {
  return `${actor.type}:${actor.id}`
}

/** 指派目标 → 操作者身份 */
export function actorForAssigneeTarget(target: 'current-user' | 'codex-agent', currentUser: { type: 'user'; id: string; name: string; avatarUrl: string | null }): { type: 'user' | 'agent'; id: string; name: string; avatarUrl: string | null } {
  return target === 'codex-agent' ? TASKBOARD_CODEX_AGENT : currentUser
}

/** 操作者身份 → 指派目标（未知身份返回 undefined，表示不修改） */
export function assigneeTargetForActor(
  actor: { type: string; id: string },
  currentUser: { type: 'user'; id: string },
): 'current-user' | 'codex-agent' | undefined {
  if (actor.type === 'agent') return 'codex-agent'
  return actor.id === currentUser.id ? 'current-user' : undefined
}

/** 按 sortOrder 排序（与 dashi sortTasks 一致） */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )
}

/** 任务 → 草稿（撤销恢复用） */
export function taskToDraft(task: Task): {
  title: string
  description: string
  status: TaskStatus
  priority: Task['priority']
  labels: string[]
  agentModelId: Task['agentModelId']
  agentChannelId: Task['agentChannelId']
  developmentContext: Task['developmentContext']
  startDate: string | null
  dueDate: string | null
  recurrence: Task['recurrence']
} {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    labels: task.labels,
    agentModelId: task.agentModelId,
    agentChannelId: task.agentChannelId,
    developmentContext: task.developmentContext,
    startDate: task.startDate,
    dueDate: task.dueDate,
    recurrence: task.recurrence,
  }
}

/** 当前用户操作者身份（从档案派生，未设置时用本地默认用户） */
export function currentActor(name: string, avatar: string): { type: 'user'; id: string; name: string; avatarUrl: string | null } {
  return { type: 'user', id: 'local-user', name: name || '本地用户', avatarUrl: avatar || null }
}
