/**
 * TaskboardView — 任务看板主视图（P2 完整版）
 *
 * 主列（todo / in_progress / blocked / in_review）+ 其他任务面板（backlog / done / canceled / archived）。
 *
 * 交互：
 * - 拖拽移动/排序（跨列与同列，浮动 sortOrder，让位动画）
 * - 右键菜单（状态/优先级/标签/复制/归档）
 * - 新建/编辑对话框
 * - ⌘Z 撤销（移动/属性修改/创建/归档）
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Home, PanelRight, PanelRightClose, Plus, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import type {
  ActorIdentity, Task, TaskDraft, TaskPriority, TaskStatus,
} from '@proma/shared'
import {
  TASKBOARD_CODEX_AGENT, TASKBOARD_LOCAL_USER,
} from '@proma/shared'
import { cn } from '@/lib/utils'
import { userProfileAtom } from '@/atoms/user-profile'
import { useOpenSession } from '@/hooks/useOpenSession'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import {
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  agentSidePanelOpenAtom,
  closeAgentSidePanelAtom,
  openAgentSidePanelLauncherAtom,
  agentWorkspacesAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionsAtom,
  agentSessionDraftsAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  agentRuntimeModelCatalogsAtom,
  getAgentRuntimeModelCatalogKey,
} from '@/atoms/agent-atoms'
import { upsertAgentSession } from '@/lib/agent-session-list'
import { channelsAtom } from '@/atoms/chat-atoms'
import { buildTaskboardModelOptions } from '@/lib/taskboard-agent'
import {
  taskboardArchivedTasksAtom,
  taskboardContextMenuAtom,
  taskboardCurrentProjectIdAtom,
  taskboardEditorAtom,
  taskboardLastProjectIdAtom,
  taskboardProjectsAtom,
  taskboardTasksAtom,
  taskboardTasksByStatusAtom,
  taskboardUndoStackAtom,
  rememberTaskboardProject,
  type TaskboardUndoEntry,
} from '@/atoms/taskboard-atoms'
import { MAIN_STATUSES, sortTasks, taskToDraft, type OtherTaskTab } from './taskboard-constants'
import { BoardColumn } from './BoardColumn'
import { OtherTasksPanel } from './OtherTasksPanel'
import { TaskContextMenu } from './TaskContextMenu'
import { TaskEditor, type NewTaskEditorDraft } from './TaskEditor'
import { ProjectSwitcher } from './ProjectSwitcher'
import { ProjectHome } from './ProjectHome'

/** 看板主列标题 */
const COLUMN_TITLES: Record<string, string> = {
  todo: '待处理',
  in_progress: '处理中',
  blocked: '受阻',
  in_review: '待确认',
}

export function TaskboardView(): React.ReactElement {
  const projects = useAtomValue(taskboardProjectsAtom)
  const tasks = useAtomValue(taskboardTasksAtom)
  const tasksByStatus = useAtomValue(taskboardTasksByStatusAtom)
  const archivedTasks = useAtomValue(taskboardArchivedTasksAtom)
  const currentProjectId = useAtomValue(taskboardCurrentProjectIdAtom)
  const setCurrentProjectId = useSetAtom(taskboardCurrentProjectIdAtom)
  const lastProjectId = useAtomValue(taskboardLastProjectIdAtom)
  const setTasks = useSetAtom(taskboardTasksAtom)
  const editor = useAtomValue(taskboardEditorAtom)
  const setEditor = useSetAtom(taskboardEditorAtom)
  const contextMenu = useAtomValue(taskboardContextMenuAtom)
  const setContextMenu = useSetAtom(taskboardContextMenuAtom)
  const undoStack = useAtomValue(taskboardUndoStackAtom)
  const setUndoStack = useSetAtom(taskboardUndoStackAtom)
  const userProfile = useAtomValue(userProfileAtom)
  const openSession = useOpenSession()
  const currentAgentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const isSidePanelOpen = useAtomValue(agentSidePanelOpenAtom)
  const openSidePanelLauncher = useSetAtom(openAgentSidePanelLauncherAtom)
  const closeSidePanel = useSetAtom(closeAgentSidePanelAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const setCurrentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setAgentSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setAgentSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const setAgentDraftsMap = useSetAtom(agentSessionDraftsAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)

  const toggleSidePanel = React.useCallback((): void => {
    if (!currentAgentSessionId) return
    if (isSidePanelOpen) {
      closeSidePanel(currentAgentSessionId)
      return
    }
    openSidePanelLauncher(currentAgentSessionId)
  }, [
    closeSidePanel,
    currentAgentSessionId,
    isSidePanelOpen,
    openSidePanelLauncher,
  ])
  const channels = useAtomValue(channelsAtom)
  const runtimeModelCatalogs = useAtomValue(agentRuntimeModelCatalogsAtom)
  const [modelOptions, setModelOptions] = React.useState<import('@proma/shared').ModelOption[]>([])
  const [modelLoading, setModelLoading] = React.useState(false)

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null
  // 全局视图下为卡片提供所属项目名（只读 tag）；普通视图不显示
  const getProjectTag = React.useCallback((task: Task): string | null => {
    if (currentProjectId !== 'local') return null
    const project = projects.find((p) => p.id === task.projectId)
    return project?.name ?? (task.projectId === 'local' ? '全局' : task.projectId)
  }, [currentProjectId, projects])
  const currentUser: ActorIdentity = React.useMemo(
    () => ({ type: 'user', id: 'local-user', name: userProfile.userName || '本地用户', avatarUrl: userProfile.avatar || null }),
    [userProfile.userName, userProfile.avatar],
  )

  // 可用标签：默认色板 + 全部任务已用标签
  const availableLabels = React.useMemo(
    () => [...new Set([
      '缺陷', '特性', '改进', 'for-claude', 'hold',
      ...tasks.flatMap((task) => task.labels),
    ])],
    [tasks],
  )

  // 拖拽状态
  const [draggedTaskId, setDraggedTaskId] = React.useState<string | null>(null)
  const [draggedTaskHeight, setDraggedTaskHeight] = React.useState(0)
  const [dropTarget, setDropTarget] = React.useState<TaskStatus | null>(null)
  const [movingTaskId, setMovingTaskId] = React.useState<string | null>(null)
  const [settlingTaskId, setSettlingTaskId] = React.useState<string | null>(null)
  const [busyTaskId, setBusyTaskId] = React.useState<string | null>(null)
  const [otherTab, setOtherTab] = React.useState<OtherTaskTab>('backlog')
  const tasksRef = React.useRef(tasks)
  tasksRef.current = tasks

  // 编辑器保存的是打开瞬间的任务快照。会话发送后主进程会异步写入
  // threadId 并广播任务变更，这里同步编辑器快照，保证按钮能从「开始对话」
  // 更新为「查看对话」，再次点击时打开原会话而不是重新创建。
  React.useEffect(() => {
    if (!editor?.task) return
    const latestTask = tasks.find((task) => task.id === editor.task?.id)
    if (!latestTask || latestTask === editor.task) return
    setEditor({ ...editor, task: latestTask })
  }, [editor, setEditor, tasks])

  // 首次打开任务看板：若上次选择了项目且该项目仍存在，则自动恢复（保留上次打开的样子）；
  // 否则回到项目首页。以后用户手动切换时不再自动覆盖（由 handleSelectProject 显式恢复）。
  const restoredRef = React.useRef(false)

  /** 选择项目（首页卡片 / 顶部下拉），记住并进入项目看板 */
  const handleSelectProject = React.useCallback((projectId: string): void => {
    rememberTaskboardProject(projectId)
    setCurrentProjectId(projectId)
    // 项目 ↔ 工作区联动：任务看板项目与 Agent 工作区按 id 对应（首页已按 workspace id 同步），
    // 打开项目时自动把当前 Agent 工作区切到对应工作区，保证后续会话落在正确的项目下。
    const workspace = workspaces.find((w) => w.id === projectId)
    if (workspace && workspace.id !== currentWorkspaceId) {
      setCurrentWorkspaceId(workspace.id)
      window.electronAPI.updateSettings({ agentWorkspaceId: workspace.id }).catch(console.error)
    }
    setDropTarget(null)
    setDraggedTaskId(null)
    setDraggedTaskHeight(0)
    setContextMenu(null)
    setUndoStack([])
  }, [rememberTaskboardProject, setCurrentProjectId, setCurrentWorkspaceId, setContextMenu, setUndoStack, workspaces, currentWorkspaceId])

  /** 返回项目首页 */
  const handleGoHome = React.useCallback((): void => {
    rememberTaskboardProject('')
    setCurrentProjectId('')
    setContextMenu(null)
    setUndoStack([])
  }, [rememberTaskboardProject, setCurrentProjectId, setContextMenu, setUndoStack])

  /**
   * 打开任务绑定的 Agent 会话（任务 ↔ 会话关联）
   * - 有 threadId：直接打开已有会话
   * - 无 threadId：创建草稿会话，预填任务内容到输入框，用户点击发送后才真正创建会话并绑定 threadId
   */
  const handleOpenConversation = React.useCallback(async (task: Task): Promise<void> => {
    // 打开会话后关闭编辑弹窗，避免弹窗残留遮挡看板
    setEditor(null)

    // 已有绑定 → 直接打开
    if (task.threadId) {
      openSession('agent', task.threadId, task.title || '任务会话')
      return
    }

    // 无绑定 → 创建草稿会话并预填内容到输入框（不发送，不绑定）
    const channelId = task.agentChannelId ?? agentChannelId
    const modelId = task.agentModelId ?? agentModelId
    const workspaceId = currentWorkspaceId ?? undefined

    try {
      // 创建草稿会话（draft=true，发送时才转为正式会话）
      const meta = await window.electronAPI.createAgentSession(
        task.title,
        channelId ?? undefined,
        workspaceId,
        modelId ?? undefined,
        true, // draft=true，不进入侧边栏历史
        task.id, // taskboardTaskId：发送后由全局监听器绑定 threadId 回任务
      )

      // 同步到本地会话列表与 per-session 渠道/模型 map：
      // AgentView 打开该会话时能读到 sessionMeta.modelId，使用任务里选的模型，
      // 而不是回退到全局默认模型。
      setAgentSessions((prev) => upsertAgentSession(prev, meta))
      // 标记为草稿会话：与「新建对话」行为一致，未发送前不显示在侧边栏，
      // 发送后由 AgentView 移除 draft 标记并出现在侧边栏。
      setDraftSessionIds((prev) => {
        const next = new Set(prev)
        next.add(meta.id)
        return next
      })
      if (channelId) {
        setAgentSessionChannelMap((prev) => {
          const map = new Map(prev)
          map.set(meta.id, channelId)
          return map
        })
      }
      if (modelId) {
        setAgentSessionModelMap((prev) => {
          const map = new Map(prev)
          map.set(meta.id, modelId)
          return map
        })
      }

      // 预填内容：有描述用描述，无则用标题
      const content = task.description.trim() || task.title

      // 预填到输入框（不发送）
      setAgentDraftsMap((prev) => {
        const map = new Map(prev)
        map.set(meta.id, content)
        return map
      })

      // 打开草稿会话（输入框已预填内容，用户可编辑后发送）
      openSession('agent', meta.id, task.title || '任务会话')
      toast(`已为任务「${task.title}」预填内容，点击发送后开始对话`)
    } catch (error) {
      console.error('[任务看板] 创建草稿会话失败:', error)
      toast.error(error instanceof Error ? error.message : '创建草稿会话失败')
    }
  }, [openSession, agentChannelId, agentModelId, currentWorkspaceId, setTasks, setEditor, setAgentSessions, setAgentSessionChannelMap, setAgentSessionModelMap, setDraftSessionIds])

  // 项目加载完成后进行一次恢复判定
  React.useEffect(() => {
    if (restoredRef.current || projects.length === 0) return
    restoredRef.current = true
    if (lastProjectId) {
      const remembered = projects.some((p) => p.id === lastProjectId)
      if (remembered) {
        setCurrentProjectId(lastProjectId)
        return
      }
    }
    // 无上次项目或已失效 → 回到首页
    setCurrentProjectId('')
  }, [projects, lastProjectId, setCurrentProjectId])

  // 加载当前渠道的模型目录，供「新建任务」选择执行模型
  React.useEffect(() => {
    let cancelled = false
    if (!agentChannelId) {
      setModelOptions([])
      return
    }
    setModelLoading(true)
    void window.electronAPI.getAgentRuntimeModelCatalog(
      agentChannelId,
      undefined,
      currentWorkspaceId ?? undefined,
    ).then((catalog) => {
      if (cancelled) return
      setModelOptions(buildTaskboardModelOptions({
        channelId: agentChannelId,
        catalog,
        channels,
      }))
    }).catch((error) => {
      if (cancelled) return
      console.error('[任务看板] 模型目录加载失败:', error)
      setModelOptions([])
    }).finally(() => {
      if (!cancelled) setModelLoading(false)
    })
    return () => { cancelled = true }
  }, [agentChannelId, currentWorkspaceId, channels, runtimeModelCatalogs])

  // 撤销栈（最多 50 条）
  const pushUndo = React.useCallback((entry: TaskboardUndoEntry): void => {
    setUndoStack((current) => [...current.slice(-49), entry])
  }, [setUndoStack])

  const refreshQuiet = async (): Promise<void> => {
    try {
      const [projectList, taskList] = await Promise.all([
        window.electronAPI.listTaskboardProjects(),
        window.electronAPI.listTaskboardTasks(),
      ])
      setTasks(taskList)
    } catch (error) {
      console.error('刷新任务看板失败', error)
    }
  }

  // ---------- 移动 ----------
  async function moveTask(
    task: Task,
    status: TaskStatus,
    beforeTaskId: string | null = null,
    useDropPosition = false,
  ): Promise<void> {
    if (movingTaskId) {
      setDropTarget(null)
      setDraggedTaskId(null)
      setDraggedTaskHeight(0)
      return
    }

    const destination = tasks.filter((candidate) => candidate.status === status && candidate.id !== task.id)
    const statusChanged = task.status !== status
    const insertionIndex = statusChanged && !useDropPosition
      ? 0
      : beforeTaskId
        ? destination.findIndex((candidate) => candidate.id === beforeTaskId)
        : destination.length
    const targetIndex = insertionIndex < 0 ? destination.length : insertionIndex
    const desiredOrder = [...destination]
    desiredOrder.splice(targetIndex, 0, task)
    const currentOrder = tasks.filter((candidate) => candidate.status === status)
    if (
      task.status === status
      && currentOrder.length === desiredOrder.length
      && currentOrder.every((candidate, index) => candidate.id === desiredOrder[index]?.id)
    ) {
      setDropTarget(null)
      setDraggedTaskId(null)
      setDraggedTaskHeight(0)
      return
    }
    const previousTask = destination[targetIndex - 1] ?? null
    const nextTask = destination[targetIndex] ?? null
    const sortOrder = previousTask && nextTask
      ? (previousTask.sortOrder + nextTask.sortOrder) / 2
      : previousTask
        ? previousTask.sortOrder + 1024
        : nextTask
          ? nextTask.sortOrder - 1024
          : 1024
    const previous = task
    setActionError(null)
    setMovingTaskId(task.id)
    setTasks((current) => sortTasks(current.map((candidate) =>
      candidate.id === task.id ? { ...candidate, status, sortOrder } : candidate,
    )))

    try {
      const moved = await window.electronAPI.moveTaskboardTask({
        id: task.id, version: task.version, status, sortOrder,
      })
      setTasks((current) => sortTasks(current.map((candidate) =>
        candidate.id === moved.id ? moved : candidate,
      )))
      const message = task.status === status
        ? `${task.identifier} 排序已调整。`
        : `${task.identifier} 已移至${COLUMN_TITLES[status] ?? status}。`
      pushUndo({
        op: 'move',
        taskId: moved.id,
        before: previous,
        after: moved,
      })
      toast(message)

      // 任务状态与会话生命周期解耦：仅记录关联，不自动创建/控制会话
    } catch (error) {
      setTasks((current) => sortTasks(current.map((candidate) =>
        candidate.id === previous.id ? previous : candidate,
      )))
      toast.error(error instanceof Error ? error.message : '移动任务失败')
      void refreshQuiet()
    } finally {
      setMovingTaskId(null)
      setDropTarget(null)
      setDraggedTaskId(null)
      setDraggedTaskHeight(0)
    }
  }

  function startTaskDrag(task: Task, height: number): void {
    setDraggedTaskId(task.id)
    setDraggedTaskHeight(height)
    setDropTarget(task.status)
  }

  function endTaskDrag(): void {
    setDraggedTaskId(null)
    setDraggedTaskHeight(0)
    setDropTarget(null)
  }

  function finishTaskDrop(destination: TaskStatus, taskId: string, beforeTaskId: string | null = null): void {
    const task = tasks.find((candidate) => candidate.id === taskId)
    setDraggedTaskId(null)
    setDraggedTaskHeight(0)
    setDropTarget(null)
    if (!task) return
    setSettlingTaskId(task.id)
    window.setTimeout(() => {
      setSettlingTaskId((current) => (current === task.id ? null : current))
    }, 220)
    void moveTask(task, destination, beforeTaskId, true)
  }

  // ---------- 属性更新 ----------
  const [actionError, setActionError] = React.useState<string | null>(null)

  async function updateTaskProperties(task: Task, changes: Partial<TaskDraft>): Promise<Task> {
    const previous = task
    const { assigneeTarget, ...taskChanges } = changes
    const optimisticAssignee = assigneeTarget
      ? (assigneeTarget === 'codex-agent' ? TASKBOARD_CODEX_AGENT : currentUser)
      : task.assignee
    const optimisticParticipants = assigneeTarget
      && !task.participants.some((participant) => (
        participant.type === optimisticAssignee.type && participant.id === optimisticAssignee.id
      ))
      ? [...task.participants, optimisticAssignee]
      : task.participants
    setActionError(null)
    setTasks((current) => current.map((candidate) =>
      candidate.id === task.id
        ? { ...candidate, ...taskChanges, assignee: optimisticAssignee, participants: optimisticParticipants }
        : candidate,
    ))

    try {
      const updated = await window.electronAPI.updateTaskboardTask({
        id: task.id, version: task.version, ...changes,
      })
      setTasks((current) => sortTasks(current.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      )))
      pushUndo({ op: 'update', taskId: previous.id, before: previous, after: updated })
      return updated
    } catch (error) {
      setTasks((current) => sortTasks(current.map((candidate) =>
        candidate.id === previous.id ? previous : candidate,
      )))
      toast.error(error instanceof Error ? error.message : '更新任务失败')
      void refreshQuiet()
      throw error
    }
  }

  // ---------- 创建 / 编辑 / 归档 / 恢复 / 删除 ----------
  async function handleSave(draft: TaskDraft): Promise<void> {
    if (editor?.task) {
      const updated = await window.electronAPI.updateTaskboardTask({
        id: editor.task.id,
        version: editor.task.version,
        ...draft,
      })
      setTasks((current) => sortTasks(current.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      )))
      pushUndo({ op: 'update', taskId: editor.task.id, before: editor.task, after: updated })
      toast(`${updated.identifier} 已更新。`)
    } else {
      const created = await window.electronAPI.createTaskboardTask({
        id: crypto.randomUUID(),
        projectId: currentProject?.id ?? 'local',
        // 任务↔会话解耦：新建任务不预绑定会话，「查看对话」时才建立关联
        threadId: null,
        ...draft,
      })
      setTasks((current) => sortTasks([...current, created]))
      pushUndo({
        op: 'create',
        taskId: created.id,
        before: created,
        after: created,
        createdTask: created,
      })
      toast(`${created.identifier} 已创建。`)
    }
    setEditor(null)
  }

  async function handleDuplicate(task: Task): Promise<void> {
    try {
      const duplicated = await window.electronAPI.createTaskboardTask({
        id: crypto.randomUUID(),
        projectId: task.projectId,
        ...taskToDraft(task),
        assigneeTarget: task.assignee.type === 'agent' ? 'codex-agent' : 'current-user',
        developmentContext: null,
      })
      setTasks((current) => sortTasks([...current, duplicated]))
      toast(`${duplicated.identifier} 副本已创建。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建副本失败')
    }
  }

  async function handleArchive(task: Task): Promise<void> {
    try {
      const archived = await window.electronAPI.archiveTaskboardTask({
        id: task.id, version: task.version,
      })
      setTasks((current) => current.filter((candidate) => candidate.id !== task.id))
      pushUndo({ op: 'archive', taskId: archived.id, before: task, after: archived })
      toast(`${task.identifier} 已归档。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '归档失败')
    }
  }

  async function handleRestore(task: Task): Promise<void> {
    setBusyTaskId(task.id)
    try {
      const restored = await window.electronAPI.restoreTaskboardTask({
        id: task.id, version: task.version,
      })
      setTasks((current) => sortTasks([
        ...current.filter((candidate) => candidate.id !== restored.id),
        restored,
      ]))
      toast(`${task.identifier} 已恢复。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '恢复失败')
    } finally {
      setBusyTaskId(null)
    }
  }

  async function handleDelete(task: Task): Promise<void> {
    setBusyTaskId(task.id)
    try {
      const result = await window.electronAPI.deleteArchivedTaskboardTask(task.id, task.version)
      setTasks((current) => current.filter((candidate) => candidate.id !== result.task.id))
      toast(`${task.identifier} 已永久删除。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    } finally {
      setBusyTaskId(null)
    }
  }

  // ---------- 撤销 ----------
  const undoInFlight = React.useRef(false)
  async function performUndo(): Promise<void> {
    if (undoInFlight.current) return
    const entry = undoStack.at(-1)
    if (!entry) return
    undoInFlight.current = true
    setUndoStack((current) => current.slice(0, -1))
    setContextMenu(null)
    setActionError(null)
    try {
      const candidate = tasksRef.current.find((t) => t.id === entry.taskId)
      const current = candidate && candidate.version >= entry.after.version ? candidate : entry.after
      if (entry.op === 'create') {
        // 撤销创建：归档新任务
        const archived = await window.electronAPI.archiveTaskboardTask({
          id: current.id, version: current.version,
        })
        setTasks((tasks) => tasks.filter((t) => t.id !== archived.id))
        toast(`${entry.before.identifier} 已归档。`)
        return
      }
      if (entry.op === 'archive') {
        // 撤销归档：恢复任务
        const restored = await window.electronAPI.restoreTaskboardTask({
          id: current.id, version: current.version,
        })
        setTasks((tasks) => sortTasks([
          ...tasks.filter((t) => t.id !== restored.id),
          restored,
        ]))
        toast(`${entry.before.identifier} 已恢复。`)
        return
      }
      if (entry.op === 'move') {
        // 撤销移动：恢复原状态 + sortOrder
        const moved = await window.electronAPI.moveTaskboardTask({
          id: current.id, version: current.version,
          status: entry.before.status, sortOrder: entry.before.sortOrder,
        })
        setTasks((tasks) => sortTasks(tasks.map((t) => (t.id === moved.id ? moved : t))))
        toast(`${entry.before.identifier} 已还原。`)
        return
      }
      // 撤销属性更新：恢复字段
      const restored = await window.electronAPI.updateTaskboardTask({
        id: current.id, version: current.version, ...taskToDraft(entry.before),
      })
      setTasks((tasks) => sortTasks(tasks.map((t) => (t.id === restored.id ? restored : t))))
      toast(`${entry.before.identifier} 已还原。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法撤回这次操作')
      void refreshQuiet()
    } finally {
      undoInFlight.current = false
    }
  }

  // ⌘Z / Ctrl+Z 撤销
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        const target = event.target as HTMLElement
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
        if (undoStack.length > 0) {
          event.preventDefault()
          void performUndo()
        }
      }
      if (event.key === 'Escape' && contextMenu) {
        setContextMenu(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undoStack.length, contextMenu, performUndo, setContextMenu])

  // ---------- 复制 ----------
  async function handleCopy(text: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      toast(message)
    } catch {
      toast.error('复制失败')
    }
  }

  const contextMenuTask = contextMenu
    ? tasks.find((task) => task.id === contextMenu.taskId) ?? null
    : null

  const emptyMessages: Record<TaskStatus, string> = {
    todo: '暂无待处理任务',
    in_progress: '暂无处理中任务',
    blocked: '暂无受阻任务',
    in_review: '暂无待确认任务',
    backlog: '暂无待立项任务',
    done: '暂无已完成任务',
    canceled: '暂无已取消任务',
  }

  // 未选择项目 → 项目首页
  if (!currentProjectId) {
    return (
      <ProjectHome
        projects={projects}
        loading={false}
        onOpenProject={handleSelectProject}
      />
    )
  }

  return (
    <div className="flex h-full flex-col bg-content-area">
      {/* 顶部工具栏 */}
      <div className="titlebar-no-drag flex flex-shrink-0 items-center justify-between border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-[16px] font-semibold text-foreground">任务看板</h1>
          {currentProject && (
            <button
              type="button"
              onClick={handleGoHome}
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground"
              title="返回项目首页"
              aria-label="返回项目首页"
            >
              <Home size={15} />
            </button>
          )}
          {currentProject && (
            <ProjectSwitcher
              projects={projects}
              currentProjectId={currentProject.id}
              onSelect={handleSelectProject}
            />
          )}
          {undoStack.length > 0 && (
            <button
              type="button"
              onClick={() => void performUndo()}
              className="flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-[12px] text-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
              title="撤销上一次操作 (⌘Z)"
            >
              <Undo2 size={13} />
              撤销
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditor({ task: null, status: 'todo' })}
            className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus size={14} />
            新建任务
          </button>
          <button
            type="button"
            onClick={toggleSidePanel}
            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
            title={isSidePanelOpen ? '折叠右侧面板' : '打开右侧面板'}
            aria-label={isSidePanelOpen ? '折叠右侧面板' : '打开右侧面板'}
            aria-pressed={isSidePanelOpen}
          >
            {isSidePanelOpen ? <PanelRightClose size={15} /> : <PanelRight size={15} />}
          </button>
        </div>
      </div>

      {actionError && (
        <div className="flex-shrink-0 border-b border-destructive/20 bg-destructive/5 px-4 py-1.5 text-[12px] text-destructive">
          {actionError}
        </div>
      )}

      {/* 看板主体 */}
      <div className="flex flex-1 min-h-0 gap-3 overflow-x-auto overflow-y-hidden p-3">
        {MAIN_STATUSES.map((status) => (
          <BoardColumn
            key={status}
            scrollRef={() => {}}
            status={status}
            tasks={tasksByStatus[status]}
            now={Date.now()}
            emptyMessage={emptyMessages[status]}
            isDropTarget={dropTarget === status}
            draggedTaskId={draggedTaskId}
            draggedTaskHeight={draggedTaskHeight}
            movingTaskId={movingTaskId}
            settlingTaskId={settlingTaskId}
            contextMenuTaskId={contextMenu?.taskId ?? null}
            availableLabels={availableLabels}
            currentUser={currentUser}
            onCreate={(initialStatus) => setEditor({ task: null, status: initialStatus })}
            onEdit={(task) => setEditor({ task, status: task.status })}
            onUpdate={updateTaskProperties}
            onComplete={(task) => void updateTaskProperties(task, { status: 'done' })}
            onContextMenu={(task, position) => setContextMenu({ taskId: task.id, ...position })}
            onDragStart={startTaskDrag}
            onDragEnd={endTaskDrag}
            onDragEnter={setDropTarget}
            onDrop={finishTaskDrop}
            getProjectTag={getProjectTag}
            onOpenConversation={handleOpenConversation}
          />
        ))}

        {/* 其他任务面板 */}
        <OtherTasksPanel
          open
          activeTab={otherTab}
          tasksByStatus={tasksByStatus}
          archivedTasks={archivedTasks}
          now={Date.now()}
          isDropTarget={dropTarget !== null}
          draggedTaskId={draggedTaskId}
          draggedTaskHeight={draggedTaskHeight}
          movingTaskId={movingTaskId}
          settlingTaskId={settlingTaskId}
          contextMenuTaskId={contextMenu?.taskId ?? null}
          availableLabels={availableLabels}
          currentUser={currentUser}
          restoringTaskId={busyTaskId}
          deletingTaskId={busyTaskId}
          onTabChange={setOtherTab}
          onCreate={(initialStatus) => setEditor({ task: null, status: initialStatus })}
          onRestore={(task) => void handleRestore(task)}
          onDelete={(task) => void handleDelete(task)}
          onEdit={(task) => setEditor({ task, status: task.status })}
          onUpdate={updateTaskProperties}
          onContextMenu={(task, position) => setContextMenu({ taskId: task.id, ...position })}
          onDragStart={startTaskDrag}
          onDragEnd={endTaskDrag}
          onDragEnter={setDropTarget}
          onDrop={finishTaskDrop}
          getProjectTag={getProjectTag}
          onOpenConversation={handleOpenConversation}
        />
      </div>

      {/* 右键菜单 */}
      {contextMenuTask && contextMenu && (
        <TaskContextMenu
          task={contextMenuTask}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          labels={availableLabels}
          onClose={() => setContextMenu(null)}
          onEdit={(task) => {
            setEditor({ task, status: task.status })
          }}
          onStatusChange={(task, status) => void updateTaskProperties(task, { status })}
          onPriorityChange={(task, priority) => void updateTaskProperties(task, { priority })}
          onLabelsChange={(task, labels) => void updateTaskProperties(task, { labels })}
          onDuplicate={(task) => void handleDuplicate(task)}
          onCopy={(text, message) => void handleCopy(text, message)}
          onArchive={(task) => void handleArchive(task)}
        />
      )}

      {/* 新建/编辑对话框 */}
      {editor && (
        <TaskEditor
          task={editor.task}
          initialStatus={editor.status}
          initialDraft={null}
          labels={availableLabels}
          currentUser={currentUser}
          modelOptions={modelOptions}
          modelLoading={modelLoading}
          onOpenConversation={handleOpenConversation}
          onCancel={(draft: NewTaskEditorDraft | null) => {
            setEditor(null)
          }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
