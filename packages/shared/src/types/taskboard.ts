/**
 * 任务看板（Taskboard）相关类型
 *
 * 从 dashi-taskboard 任务面板完整迁移的领域模型。
 * 存储层由主进程 taskboard-store 负责（JSON/JSONL + IPC），本文件仅定义跨进程类型与 IPC 通道。
 */

/** 任务状态（7 种，含看板主列与次列/归档） */
export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'canceled',
] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

/** 任务优先级（none 表示未设置） */
export const TASK_PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low'] as const

export type TaskPriority = (typeof TASK_PRIORITIES)[number]

/** 操作者类型：用户或 Agent */
export type ActorType = 'user' | 'agent'

/** 指派目标（新建任务时选择） */
export type AssigneeTarget = 'current-user' | 'codex-agent'

/** 任务关系类型 */
export type IssueRelationType = 'parent' | 'blocks' | 'blocked_by' | 'related'

/** 操作者身份 */
export interface ActorIdentity {
  type: ActorType
  id: string
  name: string
  avatarUrl: string | null
}

/** 开发上下文：分支或 worktree */
export type DevelopmentContext =
  | { type: 'branch'; branch: string }
  | { type: 'worktree'; path: string; branch: string | null }

/** 重复周期 */
export type Recurrence = {
  interval: number
  unit: 'day' | 'week' | 'month' | 'year'
}

/** 任务关系摘要（列表行/卡片引用用） */
export interface TaskRelationSummary {
  id: string
  identifier: string
  projectId: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  assignee: ActorIdentity
  archivedAt: string | null
}

/** 任务的全量关系集合 */
export interface TaskRelations {
  parent: TaskRelationSummary | null
  subIssues: TaskRelationSummary[]
  blockedBy: TaskRelationSummary[]
  blocks: TaskRelationSummary[]
  related: TaskRelationSummary[]
}

/** 任务绑定的会话引用（用于跳转 Proma Agent 会话） */
export interface TaskConversationRef {
  threadId: string
  source: 'task' | 'comment'
  sourceId: string
  title: string
  updatedAt: string
}

/** 附件元数据（正文存储在主进程附件目录） */
export interface Attachment {
  id: string
  taskId: string
  commentId: string | null
  filename: string
  contentType: string
  size: number
  createdAt: string
}

/** 评论 */
export interface Comment {
  id: string
  taskId: string
  body: string
  authorType: ActorType
  authorId: string
  authorName: string
  authorAvatarUrl: string | null
  threadId: string | null
  attachments: Attachment[]
  version: number
  createdAt: string
  updatedAt: string
}

/** 任务变更条目（活动时间线用） */
export interface TaskActivityChange {
  field: string
  before: unknown
  after: unknown
}

/** 任务变更活动记录 */
export interface TaskChangeActivity {
  id: string
  taskId: string
  actorType: ActorType
  actorId: string
  actorName: string
  actorAvatarUrl: string | null
  changes: TaskActivityChange[]
  createdAt: string
}

/** 项目 */
export interface Project {
  id: string
  name: string
  workspacePath: string | null
  issueCount: number
  createdAt: string
  updatedAt: string
}

/** 任务完整模型 */
export interface Task {
  id: string
  identifier: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  labels: string[]
  sortOrder: number
  threadId: string | null
  /** 绑定会话使用的模型 ID（任务→会话联动执行） */
  agentModelId: string | null
  /** 绑定会话使用的渠道 ID */
  agentChannelId: string | null
  conversationRefs: TaskConversationRef[]
  participants: ActorIdentity[]
  previewImage: Attachment | null
  /** 活动指纹：用于撤销/冲突检测的紧凑序列化 */
  activityKey: string
  activityUpdatedAt: string
  creatorType: ActorType
  creatorId: string
  creatorName: string
  creatorAvatarUrl: string | null
  assignee: ActorIdentity
  workflowId: string | null
  developmentContext: DevelopmentContext | null
  startDate: string | null
  dueDate: string | null
  recurrence: Recurrence | null
  archivedAt: string | null
  relations: TaskRelations
  version: number
  createdAt: string
  updatedAt: string
}

/** 宿主编解码（服务端注入给前端的环境信息；本地桌面端由渲染层直接获取） */
export interface HostContext {
  user?: ActorIdentity
  language?: string
  workspacePath?: string
  threadId?: string
  theme?: 'light' | 'dark'
  projectId?: string
  projects?: Array<{ id: string; name: string }>
  titlebarLeftInset?: number
  sidebarCollapsed?: boolean
  threadRunning?: boolean
  threadTodoProgress?: { completed: number; total: number }
}

/** 新建任务草稿 */
export interface TaskDraft {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  labels: string[]
  /** 执行会话使用的模型 ID */
  agentModelId?: string | null
  /** 执行会话使用的渠道 ID */
  agentChannelId?: string | null
  assigneeTarget?: AssigneeTarget
  developmentContext: DevelopmentContext | null
  startDate: string | null
  dueDate: string | null
  recurrence: Recurrence | null
}

/** 任务事件（IPC 推送载荷） */
export interface TaskEvent {
  type: string
  projectId?: string
  taskId?: string
  task?: Task
  comment?: Comment
  attachment?: Attachment
  project?: Project
  at: string
}

/** 任务看板业务错误（含版本冲突等细节） */
export interface TaskboardError {
  code: string
  message: string
  details?: unknown
}

/** ---------- 输入类型（IPC 请求载荷） ---------- */

export interface CreateProjectInput {
  id: string
  name: string
  workspacePath?: string | null
}

export interface CreateTaskInput {
  /** 前端生成的 uuid */
  id: string
  projectId: string
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  labels?: string[]
  sortOrder?: number
  threadId?: string | null
  agentChannelId?: string | null
  agentModelId?: string | null
  assigneeTarget?: AssigneeTarget
  workflowId?: string | null
  developmentContext?: DevelopmentContext | null
  startDate?: string | null
  dueDate?: string | null
  recurrence?: Recurrence | null
  /** 创建者身份（主进程默认本地用户） */
  actor?: ActorIdentity
}

export interface UpdateTaskInput {
  id: string
  version: number
  projectId?: string
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  labels?: string[]
  threadId?: string | null
  agentChannelId?: string | null
  agentModelId?: string | null
  assigneeTarget?: AssigneeTarget
  assignee?: ActorIdentity
  workflowId?: string | null
  developmentContext?: DevelopmentContext | null
  startDate?: string | null
  dueDate?: string | null
  recurrence?: Recurrence | null
  /** 操作者身份（默认本地用户） */
  actor?: ActorIdentity
}

export interface MoveTaskInput {
  id: string
  version: number
  status: TaskStatus
  sortOrder?: number
  threadId?: string | null
  agentModelId?: string | null
  agentChannelId?: string | null
  actor?: ActorIdentity
}

export interface ArchiveTaskInput {
  id: string
  version: number
  /** 绑定会话 ID（迁移用） */
  threadId?: string | null
  actor?: ActorIdentity
}

export interface AddRelationInput {
  id: string
  version: number
  type: IssueRelationType
  relatedTaskId: string
  threadId?: string | null
  actor?: ActorIdentity
}

export interface CreateCommentInput {
  taskId: string
  body: string
  threadId?: string | null
  actor?: ActorIdentity
}

export interface UpdateCommentInput {
  id: string
  version: number
  body: string
  threadId?: string | null
}

export interface DeleteCommentInput {
  id: string
  version: number
}

export interface CreateAttachmentInput {
  taskId: string
  commentId?: string | null
  filename: string
  contentType: string
  /** base64 编码的文件内容 */
  dataBase64: string
}

export interface ListTasksFilters {
  projectId?: string
  status?: TaskStatus
  archived?: 'true' | 'false' | 'all'
}

/** 关系增删结果（两个任务的完整快照） */
export interface RelationUpdateResult {
  task: Task
  relatedTask: Task
}

/** 附件读写结果 */
export interface AttachmentContentResult {
  metadata: Attachment
  /** base64 编码的文件内容 */
  dataBase64: string
}

/** 任务看板相关 IPC 通道常量 */
export const TASKBOARD_IPC_CHANNELS = {
  /** 获取全部项目 */
  LIST_PROJECTS: 'taskboard:list-projects',
  /** 创建项目 */
  CREATE_PROJECT: 'taskboard:create-project',
  /** 删除项目（仅 temp- 前缀的手工项目） */
  DELETE_PROJECT: 'taskboard:delete-project',

  /** 获取任务列表（支持 projectId/status/archived 过滤） */
  LIST_TASKS: 'taskboard:list-tasks',
  /** 获取单个任务（含关系/参与者/预览图） */
  GET_TASK: 'taskboard:get-task',
  /** 创建任务 */
  CREATE_TASK: 'taskboard:create-task',
  /** 更新任务字段 */
  UPDATE_TASK: 'taskboard:update-task',
  /** 移动任务（状态 + 排序） */
  MOVE_TASK: 'taskboard:move-task',
  /** 归档任务 */
  ARCHIVE_TASK: 'taskboard:archive-task',
  /** 恢复任务 */
  RESTORE_TASK: 'taskboard:restore-task',
  /** 删除已归档任务 */
  DELETE_ARCHIVED_TASK: 'taskboard:delete-archived-task',

  /** 获取任务活动时间线 */
  LIST_ACTIVITIES: 'taskboard:list-activities',

  /** 获取任务评论 */
  LIST_COMMENTS: 'taskboard:list-comments',
  /** 创建评论 */
  CREATE_COMMENT: 'taskboard:create-comment',
  /** 更新评论 */
  UPDATE_COMMENT: 'taskboard:update-comment',
  /** 删除评论 */
  DELETE_COMMENT: 'taskboard:delete-comment',

  /** 获取任务附件列表 */
  LIST_ATTACHMENTS: 'taskboard:list-attachments',
  /** 创建任务附件 */
  CREATE_ATTACHMENT: 'taskboard:create-attachment',
  /** 创建评论附件 */
  CREATE_COMMENT_ATTACHMENT: 'taskboard:create-comment-attachment',
  /** 删除附件 */
  DELETE_ATTACHMENT: 'taskboard:delete-attachment',
  /** 读取附件内容（base64） */
  READ_ATTACHMENT_CONTENT: 'taskboard:read-attachment-content',

  /** 添加任务关系 */
  ADD_RELATION: 'taskboard:add-relation',
  /** 移除任务关系 */
  REMOVE_RELATION: 'taskboard:remove-relation',

  /** 任务数据变更事件（main → renderer） */
  CHANGED: 'taskboard:changed',
} as const

/** 默认操作者：本地用户 */
export const TASKBOARD_LOCAL_USER: ActorIdentity = {
  type: 'user',
  id: 'local-user',
  name: '本地用户',
  avatarUrl: null,
}

/** Agent 操作者：Codex Agent */
export const TASKBOARD_CODEX_AGENT: ActorIdentity = {
  type: 'agent',
  id: 'codex-agent',
  name: 'Codex Agent',
  avatarUrl: null,
}

/** 内置默认项目（全局） */
export const TASKBOARD_DEFAULT_PROJECT_ID = 'local'

/** 附件正文大小上限（与 dashi 一致） */
export const TASKBOARD_ATTACHMENT_BODY_LIMIT = 25 * 1024 * 1024
