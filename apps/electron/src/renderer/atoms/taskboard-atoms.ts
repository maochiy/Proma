/**
 * 任务看板（Taskboard）状态管理
 *
 * - taskboardProjectsAtom：项目列表
 * - taskboardTasksAtom：全部任务（由初始化器从主进程加载并订阅变更刷新）
 * - taskboardArchivedTasksAtom：已归档任务（按当前项目过滤）
 * - taskboardCurrentProjectIdAtom：当前看板项目 id
 * - taskboardEditorAtom：新建/编辑对话框状态
 * - taskboardContextMenuAtom：卡片右键菜单状态
 * - taskboardUndoStackAtom：撤销栈（存放操作前快照，用于 ⌘Z 回滚）
 */

import { atom } from 'jotai'
import type { Project, Task, TaskStatus } from '@proma/shared'

/** 全部项目列表 */
export const taskboardProjectsAtom = atom<Project[]>([])

/** 全部任务列表（含归档，由视图按需过滤） */
export const taskboardTasksAtom = atom<Task[]>([])

/** 当前看板项目 id（默认全局项目） */
export const taskboardCurrentProjectIdAtom = atom<string>('')

/** 上次选择的项目 id（localStorage 持久化，重新进入时恢复；空则显示项目首页） */
const TASKBOARD_LAST_PROJECT_KEY = 'taskboard.lastProjectId'

export function rememberTaskboardProject(projectId: string): void {
  if (projectId) {
    try { window.localStorage.setItem(TASKBOARD_LAST_PROJECT_KEY, projectId) } catch {}
  } else {
    try { window.localStorage.removeItem(TASKBOARD_LAST_PROJECT_KEY) } catch {}
  }
}

export const taskboardLastProjectIdAtom = atom<string>(() => {
  try { return window.localStorage.getItem(TASKBOARD_LAST_PROJECT_KEY) ?? '' } catch { return '' }
})

/** 新建/编辑对话框状态 */
export interface TaskboardEditorState {
  task: Task | null
  status: TaskStatus
}

export const taskboardEditorAtom = atom<TaskboardEditorState | null>(null)

/** 卡片右键菜单状态 */
export interface TaskboardContextMenuState {
  taskId: string
  x: number
  y: number
}

export const taskboardContextMenuAtom = atom<TaskboardContextMenuState | null>(null)

/** 撤销操作类型 */
export type TaskboardUndoType = 'move' | 'update' | 'create' | 'archive'

/** 撤销栈条目：保存操作类型与任务快照，用于 ⌘Z 回滚 */
export interface TaskboardUndoEntry {
  op: TaskboardUndoType
  taskId: string
  before: Task
  after: Task
  /** create 操作撤销时归档用（创建的任务 after 快照） */
  createdTask?: Task
}

/** 撤销栈（最多保留 50 条） */
export const taskboardUndoStackAtom = atom<TaskboardUndoEntry[]>([])

/** 全局项目 id（复用 local，与 ProjectHome/ProjectSwitcher 一致） */
export const GLOBAL_PROJECT_ID = 'local'

/**
 * 当前项目下的任务（非归档）。
 * 全局项目（'local'）下聚合所有项目的任务；普通项目下仅过滤当前项目。
 */
export const taskboardActiveTasksAtom = atom((get) => {
  const projectId = get(taskboardCurrentProjectIdAtom)
  const all = get(taskboardTasksAtom).filter((t) => t.archivedAt === null)
  if (projectId === GLOBAL_PROJECT_ID) return all
  return all.filter((t) => t.projectId === projectId)
})

/** 当前项目下的已归档任务（按 archivedAt 倒序） */
export const taskboardArchivedTasksAtom = atom((get) => {
  const projectId = get(taskboardCurrentProjectIdAtom)
  return get(taskboardTasksAtom)
    .filter((t) => t.projectId === projectId && t.archivedAt !== null)
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
})

/** 按状态分组的任务（看板列数据源） */
export const taskboardTasksByStatusAtom = atom((get) => {
  const tasks = get(taskboardActiveTasksAtom)
  // 全局视图下按项目分组排列（同项目相邻），普通视图按 sortOrder
  const projectId = get(taskboardCurrentProjectIdAtom)
  const byStatus: Record<TaskStatus, Task[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    blocked: [],
    done: [],
    canceled: [],
  }
  for (const task of tasks) {
    byStatus[task.status]?.push(task)
  }
  for (const key of Object.keys(byStatus) as TaskStatus[]) {
    // 全局视图跨项目：先按项目 id 分组，再按 sortOrder；普通视图按 sortOrder
    byStatus[key]?.sort((a, b) => {
      if (projectId === GLOBAL_PROJECT_ID && a.projectId !== b.projectId) {
        return a.projectId.localeCompare(b.projectId)
      }
      return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    })
  }
  return byStatus
})
