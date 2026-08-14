/**
 * 任务看板（Taskboard）存储服务
 *
 * 从 dashi-taskboard 的 server/database.mjs 迁移的核心业务逻辑，改为本地 JSON/JSONL + IPC。
 * - 项目/评论/活动/附件元数据/关系：JSON 数组，原子写（safe-file）
 * - 任务：tasks.jsonl（每任务一行，追加写）
 * - 全量数据加载进内存 Map，写操作内存更新后原子落盘（单进程 Electron，无并发竞态）
 *
 * 保留 dashi 的关键业务规则：
 * - 乐观锁：task/comment 每次写 version+1，冲突返回 VERSION_CONFLICT
 * - 浮动 sortOrder：新建插顶 min-1000；跨列移动 min-1000；同列移动 max+1000
 * - identifier 续号：{prefix}-{n}
 * - 关系：parent 唯一 + 环检测；self/cross-project 校验
 * - 活动时间线：记录 field/before/after；聚合 participants + conversationRefs + previewImage + activityKey
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeJsonFileAtomic, writeTextFileAtomic, readJsonFileSafe } from '../safe-file'
import {
  getTaskboardProjectsPath,
  getTaskboardTasksPath,
  getTaskboardCommentsPath,
  getTaskboardActivitiesPath,
  getTaskboardAttachmentsMetadataPath,
  getTaskboardAttachmentsDir,
  getTaskboardAttachmentStoragePath,
  getTaskboardRelationsPath,
} from '../config-paths'
import {
  TASKBOARD_DEFAULT_PROJECT_ID,
  TASKBOARD_LOCAL_USER,
  TASKBOARD_CODEX_AGENT,
  type ActorIdentity,
  type Attachment,
  type Comment,
  type Project,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type TaskChangeActivity,
  type TaskActivityChange,
  type TaskConversationRef,
  type TaskRelationSummary,
  type CreateProjectInput,
  type CreateTaskInput,
  type UpdateTaskInput,
  type MoveTaskInput,
  type ArchiveTaskInput,
  type AddRelationInput,
  type CreateCommentInput,
  type UpdateCommentInput,
  type DeleteCommentInput,
  type ListTasksFilters,
  type RelationUpdateResult,
  type IssueRelationType,
  type DevelopmentContext,
  type Recurrence,
} from '@proma/shared'

/** 任务看板业务错误 */
export class TaskboardError extends Error {
  code: string
  status: number
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'TaskboardError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function now(): string {
  return new Date().toISOString()
}

/** 关系表记录 */
interface TaskRelationRecord {
  relationType: 'parent' | 'blocks' | 'related'
  sourceTaskId: string
  targetTaskId: string
  createdAt: string
}

/** 项目内部记录（含续号计数器） */
interface ProjectRecord extends Project {
  nextTaskNumber: number
}

const PROJECT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

function projectPrefix(projectId: string): string {
  const prefix = projectId.toUpperCase().replace(/[^A-Z0-9]+/g, '')
  return (prefix || 'TASK').slice(0, 12)
}

/** 聚合参与者/会话引用/预览图/活动指纹到任务上（对应 dashi attachTaskActivity） */
function attachTaskActivity(
  task: Task,
  comments: Comment[],
  activities: TaskChangeActivity[],
  previewImage: Attachment | null,
): Task {
  const orderedComments = [...comments].sort((a, b) => a.id.localeCompare(b.id))
  const orderedActivities = [...activities].sort((a, b) => a.id.localeCompare(b.id))

  const participants: ActorIdentity[] = []
  const participantIds = new Set<string>()
  const addParticipant = (actor: ActorIdentity | null | undefined): void => {
    if (!actor) return
    const key = `${actor.type}:${actor.id}`
    if (participantIds.has(key)) return
    participantIds.add(key)
    participants.push(actor)
  }
  addParticipant({
    type: task.creatorType,
    id: task.creatorId,
    name: task.creatorName,
    avatarUrl: task.creatorAvatarUrl,
  })
  addParticipant(task.assignee)
  for (const comment of orderedComments) {
    addParticipant({
      type: comment.authorType,
      id: comment.authorId,
      name: comment.authorName,
      avatarUrl: comment.authorAvatarUrl,
    })
  }
  for (const activity of orderedActivities) {
    addParticipant({
      type: activity.actorType,
      id: activity.actorId,
      name: activity.actorName,
      avatarUrl: activity.actorAvatarUrl,
    })
  }

  const conversationRefs: TaskConversationRef[] = []
  if (task.threadId) {
    conversationRefs.push({
      threadId: task.threadId,
      source: 'task',
      sourceId: task.id,
      title: task.title,
      updatedAt: task.updatedAt,
    })
  }
  for (const comment of orderedComments) {
    if (!comment.threadId) continue
    conversationRefs.push({
      threadId: comment.threadId,
      source: 'comment',
      sourceId: comment.id,
      title: commentTitle(comment.body),
      updatedAt: comment.updatedAt,
    })
  }

  task.conversationRefs = conversationRefs
  task.participants = participants
  task.previewImage = previewImage
  task.activityKey = JSON.stringify({
    version: 1,
    task: [task.id, task.version, task.updatedAt],
    comments: orderedComments.map((c) => [c.id, c.version, c.updatedAt]),
    changes: orderedActivities.map((a) => [a.id, a.createdAt]),
  })
  task.activityUpdatedAt = [...orderedComments, ...orderedActivities].reduce(
    (latest, item: Comment | TaskChangeActivity) => {
      const updatedAt = 'updatedAt' in item ? item.updatedAt : item.createdAt
      return updatedAt > latest ? updatedAt : latest
    },
    task.updatedAt,
  )
  return task
}

function commentTitle(body: string): string {
  const firstLine = String(body ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) return '评论'
  const compact = firstLine.replace(/\s+/g, ' ')
  return compact.length > 80 ? `${compact.slice(0, 77)}…` : compact
}

function taskFieldChanges(task: Task, changes: Record<string, unknown>): TaskActivityChange[] {
  return Object.entries(changes).flatMap(([field, after]) => {
    const before = (task as unknown as Record<string, unknown>)[field]
    return JSON.stringify(before) === JSON.stringify(after)
      ? []
      : [{ field, before, after }]
  })
}

function relationActivityValue(type: IssueRelationType, task: TaskRelationSummary) {
  return { type, identifier: task.identifier, title: task.title }
}

/**
 * 任务看板存储服务
 *
 * 内存索引 + 原子落盘。所有读操作读内存，写操作同步内存并写盘。
 */
export class TaskboardStore {
  constructor(private baseDir: string | null = null) {}

  private projects = new Map<string, ProjectRecord>()
  private tasks = new Map<string, Task>()
  private comments = new Map<string, Comment>()
  private activities = new Map<string, TaskChangeActivity>()
  private attachments = new Map<string, Attachment>()
  private relations = new Map<string, TaskRelationRecord>()
  private loaded = false

  // ---------- 生命周期 ----------

  /** 加载全部数据（幂等，首次调用时从磁盘读取） */
  ensureLoaded(): void {
    if (this.loaded) return
    // 无论测试 baseDir 还是默认配置路径，都先确保目录存在
    mkdirSync(this.baseDir ?? dirname(this.projectsPath()), { recursive: true })
    mkdirSync(this.attachmentsDir(), { recursive: true })
    this.loadProjects()
    this.loadTasks()
    this.loadComments()
    this.loadActivities()
    this.loadAttachments()
    this.loadRelations()
    this.loaded = true
  }

  private loadProjects(): void {
    const data = readJsonFileSafe<{ version: number; projects: ProjectRecord[] }>(this.projectsPath())
    const list = data?.projects ?? []
    for (const p of list) {
      this.projects.set(p.id, { ...p, nextTaskNumber: p.nextTaskNumber ?? 1 })
    }
    // 确保默认全局项目存在
    if (!this.projects.has(TASKBOARD_DEFAULT_PROJECT_ID)) {
      const timestamp = now()
      this.projects.set(TASKBOARD_DEFAULT_PROJECT_ID, {
        id: TASKBOARD_DEFAULT_PROJECT_ID,
        name: '全局',
        workspacePath: null,
        issueCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        nextTaskNumber: 1,
      })
    }
  }

  private persistProjects(): void {
    const data = { version: 1, projects: [...this.projects.values()] }
    writeJsonFileAtomic(this.projectsPath(), data)
  }

  private loadTasks(): void {
    const filePath = this.tasksPath()
    if (!existsSync(filePath)) return
    const raw = readFileSync(filePath, 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as Task
        // 兼容旧数据：补齐新增的会话执行配置字段
        if (parsed.agentModelId === undefined) parsed.agentModelId = null
        if (parsed.agentChannelId === undefined) parsed.agentChannelId = null
        this.tasks.set(parsed.id, parsed)
      } catch (error) {
        console.warn('[任务看板] 忽略损坏的任务行:', error)
      }
    }
  }

  private persistTask(task: Task): void {
    // JSONL：每任务一行。任务可能多次变更，这里采用「整文件原子重写」保证一致性。
    const filePath = this.tasksPath()
    const lines = [...this.tasks.values()].map((t) => JSON.stringify(t)).join('\n')
    writeTextFileAtomic(filePath, lines.length > 0 ? `${lines}\n` : '')
  }

  private loadComments(): void {
    const data = readJsonFileSafe<{ version: number; comments: Comment[] }>(this.commentsPath())
    for (const c of data?.comments ?? []) this.comments.set(c.id, c)
  }

  private persistComments(): void {
    writeJsonFileAtomic(this.commentsPath(), { version: 1, comments: [...this.comments.values()] })
  }

  private loadActivities(): void {
    const data = readJsonFileSafe<{ version: number; activities: TaskChangeActivity[] }>(this.activitiesPath())
    for (const a of data?.activities ?? []) this.activities.set(a.id, a)
  }

  private persistActivities(): void {
    writeJsonFileAtomic(this.activitiesPath(), { version: 1, activities: [...this.activities.values()] })
  }

  private loadAttachments(): void {
    const data = readJsonFileSafe<{ version: number; attachments: Attachment[] }>(this.attachmentsMetadataPath())
    for (const a of data?.attachments ?? []) this.attachments.set(a.id, a)
  }

  private persistAttachments(): void {
    writeJsonFileAtomic(this.attachmentsMetadataPath(), { version: 1, attachments: [...this.attachments.values()] })
  }

  private loadRelations(): void {
    const data = readJsonFileSafe<{ version: number; relations: TaskRelationRecord[] }>(this.relationsPath())
    for (const r of data?.relations ?? []) this.relations.set(this.relationKey(r), r)
  }

  private persistRelations(): void {
    writeJsonFileAtomic(this.relationsPath(), { version: 1, relations: [...this.relations.values()] })
  }

  private relationKey(r: TaskRelationRecord): string {
    return `${r.relationType}:${r.sourceTaskId}:${r.targetTaskId}`
  }

  // ---------- 私有工具 ----------

  private requireProject(id: string): ProjectRecord {
    const project = this.projects.get(id)
    if (!project) throw new TaskboardError(404, 'PROJECT_NOT_FOUND', `项目 '${id}' 不存在`)
    return project
  }

  private requireTask(id: string): Task {
    const task = this.getTask(id)
    if (!task) throw new TaskboardError(404, 'TASK_NOT_FOUND', `任务 '${id}' 不存在`)
    return task
  }

  private requireTaskRaw(id: string): Task {
    const task = this.tasks.get(id)
    if (!task) throw new TaskboardError(404, 'TASK_NOT_FOUND', `任务 '${id}' 不存在`)
    return task
  }

  private requireComment(id: string): Comment {
    const comment = this.comments.get(id)
    if (!comment) throw new TaskboardError(404, 'COMMENT_NOT_FOUND', `评论 '${id}' 不存在`)
    return comment
  }

  private requireVersion(version: number, actualVersion: number, id: string, kind: 'TASK' | 'COMMENT'): void {
    if (version !== actualVersion) {
      throw new TaskboardError(409, 'VERSION_CONFLICT', `${kind === 'TASK' ? '任务' : '评论'}已被其他端修改`, {
        expectedVersion: version,
        actualVersion,
      })
    }
  }

  /** 任务关联的附件（按任务过滤，可选是否含评论附件） */
  private attachmentsForTask(taskId: string, includeComment = true): Attachment[] {
    return [...this.attachments.values()]
      .filter((a) => a.taskId === taskId && (includeComment || a.commentId === null))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  private attachmentsForComment(commentId: string): Attachment[] {
    return [...this.attachments.values()]
      .filter((a) => a.commentId === commentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  private commentsForTask(taskId: string): Comment[] {
    return [...this.comments.values()]
      .filter((c) => c.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  private activitiesForTask(taskId: string): TaskChangeActivity[] {
    return [...this.activities.values()]
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  private taskPreviewImage(taskId: string): Attachment | null {
    const image = this.attachmentsForTask(taskId, false).find((a) => a.contentType.startsWith('image/'))
    return image ?? null
  }

  /** 组装任务的关系集合 */
  private taskWithRelations(task: Task): Task {
    const result: Task = { ...task }
    const parentRec = [...this.relations.values()].find(
      (r) => r.relationType === 'parent' && r.targetTaskId === task.id,
    )
    const summary = (t: Task): TaskRelationSummary => ({
      id: t.id,
      identifier: t.identifier,
      projectId: t.projectId,
      title: t.title,
      status: t.status,
      priority: t.priority,
      assignee: t.assignee,
      archivedAt: t.archivedAt,
    })
    const parent = parentRec ? this.tasks.get(parentRec.sourceTaskId) : undefined
    const subIssues = [...this.relations.values()]
      .filter((r) => r.relationType === 'parent' && r.sourceTaskId === task.id)
      .map((r) => this.tasks.get(r.targetTaskId))
      .filter((t): t is Task => Boolean(t))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    const blockedBy = [...this.relations.values()]
      .filter((r) => r.relationType === 'blocks' && r.targetTaskId === task.id)
      .map((r) => this.tasks.get(r.sourceTaskId))
      .filter((t): t is Task => Boolean(t))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    const blocks = [...this.relations.values()]
      .filter((r) => r.relationType === 'blocks' && r.sourceTaskId === task.id)
      .map((r) => this.tasks.get(r.targetTaskId))
      .filter((t): t is Task => Boolean(t))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    const related = [...this.relations.values()]
      .filter((r) => r.relationType === 'related' && (r.sourceTaskId === task.id || r.targetTaskId === task.id))
      .map((r) => this.tasks.get(r.sourceTaskId === task.id ? r.targetTaskId : r.sourceTaskId))
      .filter((t): t is Task => Boolean(t))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    result.relations = { parent: parent ? summary(parent) : null, subIssues: subIssues.map(summary), blockedBy: blockedBy.map(summary), blocks: blocks.map(summary), related: related.map(summary) }
    return result
  }

  /** 组装完整任务（关系 + 参与者 + 会话引用 + 预览图 + activityKey） */
  private hydrateTask(task: Task): Task {
    const withRelations = this.taskWithRelations(task)
    const comments = this.commentsForTask(task.id)
    const activities = this.activitiesForTask(task.id)
    return attachTaskActivity(withRelations, comments, activities, this.taskPreviewImage(task.id))
  }

  private recordTaskActivity(taskId: string, actor: ActorIdentity, changes: TaskActivityChange[], timestamp: string): void {
    if (changes.length === 0) return
    const activity: TaskChangeActivity = {
      id: randomUUID(),
      taskId,
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name,
      actorAvatarUrl: actor.avatarUrl,
      changes,
      createdAt: timestamp,
    }
    this.activities.set(activity.id, activity)
    this.persistActivities()
  }

  private touchTask(id: string, version: number, threadId: string | null | undefined, timestamp: string): void {
    const task = this.requireTaskRaw(id)
    this.requireVersion(version, task.version, id, 'TASK')
    task.threadId = threadId ?? task.threadId
    task.version += 1
    task.updatedAt = timestamp
    this.tasks.set(id, task)
    this.persistTask(task)
  }

  private resolveAssignee(assigneeTarget: 'current-user' | 'codex-agent' | undefined, actor: ActorIdentity): ActorIdentity {
    if (assigneeTarget === undefined || assigneeTarget === 'current-user') return actor
    if (assigneeTarget === 'codex-agent') return TASKBOARD_CODEX_AGENT
    return actor
  }


  // ---------- 路径（测试可覆盖） ----------

  private projectsPath(): string {
    return this.baseDir ? join(this.baseDir, 'projects.json') : getTaskboardProjectsPath()
  }

  private tasksPath(): string {
    return this.baseDir ? join(this.baseDir, 'tasks.jsonl') : getTaskboardTasksPath()
  }

  private commentsPath(): string {
    return this.baseDir ? join(this.baseDir, 'comments.json') : getTaskboardCommentsPath()
  }

  private activitiesPath(): string {
    return this.baseDir ? join(this.baseDir, 'activities.json') : getTaskboardActivitiesPath()
  }

  private attachmentsMetadataPath(): string {
    return this.baseDir ? join(this.baseDir, 'attachments.json') : getTaskboardAttachmentsMetadataPath()
  }

  private attachmentsDir(): string {
    return this.baseDir ? join(this.baseDir, 'attachments') : getTaskboardAttachmentsDir()
  }

  private attachmentStoragePath(id: string): string {
    return join(this.attachmentsDir(), id)
  }

  private relationsPath(): string {
    return this.baseDir ? join(this.baseDir, 'relations.json') : getTaskboardRelationsPath()
  }
  // ---------- 项目 ----------

  listProjects(): Project[] {
    this.ensureLoaded()
    return [...this.projects.values()]
      .map((p) => this.toProject(p))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  private toProject(p: ProjectRecord): Project {
    return {
      id: p.id,
      name: p.name,
      workspacePath: p.workspacePath,
      issueCount: [...this.tasks.values()].filter((t) => t.projectId === p.id && t.archivedAt === null).length,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }
  }

  getProject(id: string): Project | null {
    this.ensureLoaded()
    const project = this.projects.get(id)
    return project ? this.toProject(project) : null
  }

  createProject(input: CreateProjectInput): Project {
    this.ensureLoaded()
    if (this.projects.has(input.id)) {
      throw new TaskboardError(409, 'PROJECT_EXISTS', `项目 '${input.id}' 已存在`)
    }
    const timestamp = now()
    const project: ProjectRecord = {
      id: input.id,
      name: input.name,
      workspacePath: input.workspacePath ?? null,
      issueCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      nextTaskNumber: 1,
    }
    this.projects.set(input.id, project)
    this.persistProjects()
    return this.toProject(project)
  }

  deleteProject(id: string): Project {
    this.ensureLoaded()
    const project = this.requireProject(id)
    if (!id.startsWith('temp-')) {
      throw new TaskboardError(403, 'PROJECT_DELETE_FORBIDDEN', '仅可删除手工创建的项目')
    }
    const hasTasks = [...this.tasks.values()].some((t) => t.projectId === id)
    if (hasTasks) {
      const issueCount = [...this.tasks.values()].filter((t) => t.projectId === id).length
      throw new TaskboardError(409, 'PROJECT_NOT_EMPTY', '项目仍包含任务', { issueCount })
    }
    this.projects.delete(id)
    this.persistProjects()
    return this.toProject(project)
  }

  // ---------- 任务 ----------

  listTasks(filters: ListTasksFilters = {}): Task[] {
    this.ensureLoaded()
    const rows = [...this.tasks.values()].filter((t) => {
      if (filters.projectId && t.projectId !== filters.projectId) return false
      if (filters.status && t.status !== filters.status) return false
      if (filters.archived === 'false' && t.archivedAt !== null) return false
      if (filters.archived === 'true' && t.archivedAt === null) return false
      return true
    })
    const statusOrder: Record<TaskStatus, number> = {
      backlog: 1, todo: 2, in_progress: 3, in_review: 4, blocked: 5, done: 6, canceled: 7,
    }
    rows.sort(
      (a, b) =>
        statusOrder[a.status] - statusOrder[b.status]
        || a.sortOrder - b.sortOrder
        || a.createdAt.localeCompare(b.createdAt)
        || a.id.localeCompare(b.id),
    )
    return rows.map((t) => this.hydrateTask(t))
  }

  getTask(id: string): Task | null {
    this.ensureLoaded()
    const task = this.tasks.get(id)
    return task ? this.hydrateTask(task) : null
  }

  createTask(input: CreateTaskInput): Task {
    this.ensureLoaded()
    if (input.recurrence && !(input.dueDate ?? null)) {
      throw new TaskboardError(400, 'INVALID_FIELD', '重复任务必须有截止日期')
    }
    const project = this.requireProject(input.projectId)

    // identifier 续号
    const projectTasks = [...this.tasks.values()].filter((t) => t.projectId === project.id)
    const firstIdentifier = [...projectTasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0]?.identifier
    const prefix = firstIdentifier ? firstIdentifier.replace(/-\d+$/, '') : projectPrefix(project.id)
    const maxNumber = projectTasks.reduce((max, t) => {
      const match = t.identifier.match(new RegExp(`^${prefix}-(\\d+)$`))
      if (!match) return max
      const n = Number(match[1])
      return Number.isFinite(n) && n > max ? n : max
    }, 0)
    const number = Math.max(project.nextTaskNumber, maxNumber + 1)
    const identifier = `${prefix}-${number}`
    project.nextTaskNumber = number + 1
    project.updatedAt = now()
    this.persistProjects()

    const id = input.id || randomUUID()
    const timestamp = now()
    const actor = input.actor ?? TASKBOARD_LOCAL_USER
    const status = input.status ?? 'backlog'
    let sortOrder = input.sortOrder
    if (sortOrder === undefined) {
      const min = [...this.tasks.values()]
        .filter((t) => t.projectId === project.id && t.status === status && t.archivedAt === null)
        .reduce((min, t) => Math.min(min, t.sortOrder), Infinity)
      sortOrder = min === Infinity ? 1000 : min - 1000
    }

    const task: Task = {
      id,
      identifier,
      projectId: project.id,
      title: input.title,
      description: input.description ?? '',
      status,
      priority: input.priority ?? 'none',
      labels: input.labels ?? [],
      sortOrder,
      threadId: input.threadId ?? null,
      agentModelId: input.agentModelId ?? null,
      agentChannelId: input.agentChannelId ?? null,
      conversationRefs: [],
      participants: [],
      previewImage: null,
      activityKey: '',
      activityUpdatedAt: timestamp,
      creatorType: actor.type,
      creatorId: actor.id,
      creatorName: actor.name,
      creatorAvatarUrl: actor.avatarUrl,
      assignee: this.resolveAssignee(input.assigneeTarget, actor),
      workflowId: input.workflowId ?? null,
      developmentContext: input.developmentContext ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      recurrence: input.recurrence ?? null,
      archivedAt: null,
      relations: { parent: null, subIssues: [], blockedBy: [], blocks: [], related: [] },
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.tasks.set(id, task)
    this.persistTask(task)
    return this.hydrateTask(task)
  }

  updateTask(input: UpdateTaskInput): Task {
    this.ensureLoaded()
    const current = this.requireTaskRaw(input.id)
    this.requireVersion(input.version, current.version, input.id, 'TASK')
    const actor = input.actor ?? TASKBOARD_LOCAL_USER

    const changes = this.buildUpdateChanges(input, current)
    const activityChanges = taskFieldChanges(current, changes as unknown as Record<string, unknown>)

    const targetProject = input.projectId !== undefined
      ? this.projects.get(input.projectId)
      : undefined
    if (input.projectId !== undefined && !targetProject) {
      throw new TaskboardError(404, 'PROJECT_NOT_FOUND', `项目 '${input.projectId}' 不存在`)
    }
    const projectChanged = Boolean(targetProject && targetProject.id !== current.projectId)
    if (projectChanged) {
      const hasRelation = [...this.relations.values()].some(
        (r) => r.sourceTaskId === current.id || r.targetTaskId === current.id,
      )
      if (hasRelation) {
        throw new TaskboardError(409, 'CROSS_PROJECT_RELATION', '移动项目前请先移除任务关系')
      }
    }

    const dueDate = input.dueDate !== undefined ? input.dueDate : current.dueDate
    const recurrence = input.recurrence !== undefined ? input.recurrence : current.recurrence
    if (recurrence && !dueDate) {
      throw new TaskboardError(400, 'INVALID_FIELD', '重复任务必须有截止日期')
    }

    const timestamp = now()
    const updated: Task = { ...current }

    if (input.title !== undefined) updated.title = input.title
    if (input.description !== undefined) updated.description = input.description
    if (input.status !== undefined) updated.status = input.status
    if (input.priority !== undefined) updated.priority = input.priority
    if (input.labels !== undefined) updated.labels = [...input.labels]
    if (input.workflowId !== undefined) updated.workflowId = input.workflowId
    if (input.startDate !== undefined) updated.startDate = input.startDate
    if (input.dueDate !== undefined) updated.dueDate = input.dueDate
    if (input.developmentContext !== undefined) updated.developmentContext = input.developmentContext
    if (input.recurrence !== undefined) updated.recurrence = input.recurrence
    if (input.projectId !== undefined) updated.projectId = input.projectId
    if (input.assigneeTarget !== undefined) updated.assignee = this.resolveAssignee(input.assigneeTarget, actor)
    if (input.assignee !== undefined) updated.assignee = input.assignee
    if (input.threadId !== undefined && !input.projectId) updated.threadId = input.threadId
    if (input.agentModelId !== undefined) updated.agentModelId = input.agentModelId
    if (input.agentChannelId !== undefined) updated.agentChannelId = input.agentChannelId

    // 状态变更 → 自动重排到新列顶部
    if (input.status !== undefined && input.status !== current.status) {
      const placementProjectId = projectChanged ? targetProject!.id : current.projectId
      const min = [...this.tasks.values()]
        .filter((t) => t.projectId === placementProjectId && t.status === input.status && t.archivedAt === null && t.id !== current.id)
        .reduce((min, t) => Math.min(min, t.sortOrder), Infinity)
      updated.sortOrder = min === Infinity ? 1000 : min - 1000
    }

    updated.version += 1
    updated.updatedAt = timestamp
    this.tasks.set(current.id, updated)
    this.persistTask(updated)

    if (projectChanged) {
      this.projects.get(current.projectId)!.updatedAt = timestamp
      this.projects.get(targetProject!.id)!.updatedAt = timestamp
      this.persistProjects()
    }
    this.recordTaskActivity(current.id, actor, activityChanges, timestamp)
    return this.hydrateTask(updated)
  }

  private buildUpdateChanges(input: UpdateTaskInput, current: Task): Record<string, unknown> {
    const changes: Record<string, unknown> = {}
    if (input.title !== undefined) changes.title = input.title
    if (input.description !== undefined) changes.description = input.description
    if (input.status !== undefined) changes.status = input.status
    if (input.priority !== undefined) changes.priority = input.priority
    if (input.labels !== undefined) changes.labels = input.labels
    if (input.workflowId !== undefined) changes.workflowId = input.workflowId
    if (input.startDate !== undefined) changes.startDate = input.startDate
    if (input.dueDate !== undefined) changes.dueDate = input.dueDate
    if (input.developmentContext !== undefined) changes.developmentContext = input.developmentContext
    if (input.recurrence !== undefined) changes.recurrence = input.recurrence
    if (input.projectId !== undefined) changes.projectId = input.projectId
    if (input.assignee !== undefined) changes.assignee = input.assignee
    if (input.assigneeTarget !== undefined) changes.assignee = this.resolveAssignee(input.assigneeTarget, input.actor ?? TASKBOARD_LOCAL_USER)
    if (input.threadId !== undefined && !input.projectId) changes.threadId = input.threadId
    if (input.agentModelId !== undefined) changes.agentModelId = input.agentModelId
    if (input.agentChannelId !== undefined) changes.agentChannelId = input.agentChannelId
    return changes
  }

  moveTask(input: MoveTaskInput): Task {
    this.ensureLoaded()
    const current = this.requireTaskRaw(input.id)
    this.requireVersion(input.version, current.version, input.id, 'TASK')
    if (current.archivedAt !== null) {
      throw new TaskboardError(409, 'TASK_ARCHIVED', '已归档任务不可移动')
    }
    const actor = input.actor ?? TASKBOARD_LOCAL_USER

    let sortOrder = input.sortOrder
    if (input.status !== current.status && sortOrder === undefined) {
      const min = [...this.tasks.values()]
        .filter((t) => t.projectId === current.projectId && t.status === input.status && t.archivedAt === null && t.id !== current.id)
        .reduce((min, t) => Math.min(min, t.sortOrder), Infinity)
      sortOrder = min === Infinity ? 1000 : min - 1000
    } else if (sortOrder === undefined) {
      const max = [...this.tasks.values()]
        .filter((t) => t.projectId === current.projectId && t.status === input.status && t.archivedAt === null && t.id !== current.id)
        .reduce((max, t) => Math.max(max, t.sortOrder), 0)
      sortOrder = max + 1000
    }

    const timestamp = now()
    const statusChanged = input.status !== current.status
    current.status = input.status
    current.sortOrder = sortOrder
    if (input.threadId !== undefined) current.threadId = input.threadId
    if (input.agentModelId !== undefined) current.agentModelId = input.agentModelId
    if (input.agentChannelId !== undefined) current.agentChannelId = input.agentChannelId
    current.version += 1
    current.updatedAt = timestamp
    this.tasks.set(current.id, current)
    this.persistTask(current)

    const activityChanges = statusChanged
      ? taskFieldChanges(current, { status: input.status })
      : []
    this.recordTaskActivity(current.id, actor, activityChanges, timestamp)
    return this.hydrateTask(current)
  }

  archiveTask(input: ArchiveTaskInput): Task {
    this.ensureLoaded()
    const current = this.requireTaskRaw(input.id)
    this.requireVersion(input.version, current.version, input.id, 'TASK')
    const actor = input.actor ?? TASKBOARD_LOCAL_USER
    const timestamp = now()
    const before = current.archivedAt
    current.archivedAt = timestamp
    if (input.threadId !== undefined) current.threadId = input.threadId
    current.version += 1
    current.updatedAt = timestamp
    this.tasks.set(current.id, current)
    this.persistTask(current)
    this.recordTaskActivity(current.id, actor, [{ field: 'archivedAt', before, after: timestamp }], timestamp)
    return this.hydrateTask(current)
  }

  restoreTask(input: ArchiveTaskInput): Task {
    this.ensureLoaded()
    const current = this.requireTaskRaw(input.id)
    this.requireVersion(input.version, current.version, input.id, 'TASK')
    if (current.archivedAt === null) {
      throw new TaskboardError(409, 'TASK_NOT_ARCHIVED', '仅已归档任务可恢复')
    }
    const actor = input.actor ?? TASKBOARD_LOCAL_USER
    const timestamp = now()
    const before = current.archivedAt
    current.archivedAt = null
    if (input.threadId !== undefined) current.threadId = input.threadId
    current.version += 1
    current.updatedAt = timestamp
    this.tasks.set(current.id, current)
    this.persistTask(current)
    this.recordTaskActivity(current.id, actor, [{ field: 'archivedAt', before, after: null }], timestamp)
    return this.hydrateTask(current)
  }

  /** 删除已归档任务，返回被删除任务与应清理的附件 id 列表 */
  deleteArchivedTask(id: string, version: number): { task: Task; attachmentIds: string[] } {
    this.ensureLoaded()
    const current = this.requireTaskRaw(id)
    this.requireVersion(version, current.version, id, 'TASK')
    if (current.archivedAt === null) {
      throw new TaskboardError(409, 'TASK_NOT_ARCHIVED', '仅已归档任务可删除')
    }
    const attachmentIds = this.attachmentsForTask(id).map((a) => a.id)
    // 删除任务及其评论/附件/活动/关系
    for (const c of this.commentsForTask(id)) this.comments.delete(c.id)
    for (const a of this.activitiesForTask(id)) this.activities.delete(a.id)
    for (const att of this.attachmentsForTask(id)) this.attachments.delete(att.id)
    for (const [key, r] of [...this.relations.entries()]) {
      if (r.sourceTaskId === id || r.targetTaskId === id) this.relations.delete(key)
    }
    this.tasks.delete(id)
    this.persistTask(current) // 重写剩余任务
    this.persistComments()
    this.persistActivities()
    this.persistAttachments()
    this.persistRelations()
    return { task: current, attachmentIds }
  }

  // ---------- 评论 ----------

  listComments(taskId: string): Comment[] {
    this.ensureLoaded()
    this.requireTask(taskId)
    return this.commentsForTask(taskId).map((c) => ({ ...c, attachments: this.attachmentsForComment(c.id) }))
  }

  createComment(input: CreateCommentInput): Comment {
    this.ensureLoaded()
    const task = this.requireTask(input.taskId)
    const actor = input.actor ?? TASKBOARD_LOCAL_USER
    const timestamp = now()
    const comment: Comment = {
      id: randomUUID(),
      taskId: task.id,
      body: input.body,
      authorType: actor.type,
      authorId: actor.id,
      authorName: actor.name,
      authorAvatarUrl: actor.avatarUrl,
      threadId: input.threadId ?? null,
      attachments: [],
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.comments.set(comment.id, comment)
    this.persistComments()
    return { ...comment }
  }

  updateComment(input: UpdateCommentInput): Comment {
    this.ensureLoaded()
    const current = this.requireComment(input.id)
    this.requireVersion(input.version, current.version, input.id, 'COMMENT')
    current.body = input.body
    if (input.threadId !== undefined) current.threadId = input.threadId
    current.version += 1
    current.updatedAt = now()
    this.comments.set(current.id, current)
    this.persistComments()
    return { ...current, attachments: this.attachmentsForComment(current.id) }
  }

  deleteComment(input: DeleteCommentInput): Comment {
    this.ensureLoaded()
    const current = this.requireComment(input.id)
    this.requireVersion(input.version, current.version, input.id, 'COMMENT')
    const attachmentIds = this.attachmentsForComment(input.id).map((a) => a.id)
    for (const att of this.attachmentsForComment(input.id)) this.attachments.delete(att.id)
    this.comments.delete(input.id)
    this.persistComments()
    this.persistAttachments()
    return { ...current, attachments: [] }
  }

  // ---------- 活动 ----------

  listTaskActivities(taskId: string): TaskChangeActivity[] {
    this.ensureLoaded()
    this.requireTask(taskId)
    return this.activitiesForTask(taskId)
  }

  // ---------- 附件 ----------

  listTaskAttachments(taskId: string): Attachment[] {
    this.ensureLoaded()
    this.requireTask(taskId)
    return this.attachmentsForTask(taskId, false)
  }

  listCommentAttachments(commentId: string): Attachment[] {
    this.ensureLoaded()
    this.requireComment(commentId)
    return this.attachmentsForComment(commentId)
  }

  /**
   * 创建附件：正文写入磁盘，元数据记录。
   * commentId 为空表示任务附件，否则为评论附件。
   */
  createAttachment(
    taskId: string,
    commentId: string | null,
    filename: string,
    contentType: string,
    dataBase64: string,
  ): Attachment {
    this.ensureLoaded()
    const task = this.requireTask(taskId)
    if (commentId) this.requireComment(commentId)
    const id = randomUUID()
    const timestamp = now()
    const buffer = Buffer.from(dataBase64, 'base64')
    mkdirSync(this.attachmentsDir(), { recursive: true })
    writeFileSync(this.attachmentStoragePath(id), buffer, { flag: 'wx' })
    const attachment: Attachment = {
      id,
      taskId: task.id,
      commentId,
      filename,
      contentType,
      size: buffer.length,
      createdAt: timestamp,
    }
    this.attachments.set(id, attachment)
    this.persistAttachments()
    return attachment
  }

  getAttachment(id: string): Attachment | null {
    this.ensureLoaded()
    return this.attachments.get(id) ?? null
  }

  /** 读取附件内容为 base64 */
  readAttachmentContent(id: string): { metadata: Attachment; dataBase64: string } {
    this.ensureLoaded()
    const attachment = this.requireAttachment(id)
    const storagePath = this.attachmentStoragePath(id)
    if (!existsSync(storagePath)) {
      throw new TaskboardError(404, 'ATTACHMENT_NOT_FOUND', `附件正文 '${id}' 不存在`)
    }
    const buffer = readFileSync(storagePath)
    return { metadata: attachment, dataBase64: buffer.toString('base64') }
  }

  deleteAttachment(id: string): Attachment {
    this.ensureLoaded()
    const attachment = this.requireAttachment(id)
    this.attachments.delete(id)
    this.persistAttachments()
    try {
      unlinkSync(this.attachmentStoragePath(id))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return attachment
  }

  private requireAttachment(id: string): Attachment {
    const attachment = this.attachments.get(id)
    if (!attachment) throw new TaskboardError(404, 'ATTACHMENT_NOT_FOUND', `附件 '${id}' 不存在`)
    return attachment
  }

  // ---------- 关系 ----------

  addRelation(input: AddRelationInput): RelationUpdateResult {
    this.ensureLoaded()
    const task = this.requireTaskRaw(input.id)
    const relatedTask = this.requireTaskRaw(input.relatedTaskId)
    this.requireVersion(input.version, task.version, input.id, 'TASK')
    this.validateRelationTasks(task, relatedTask)
    const actor = input.actor ?? TASKBOARD_LOCAL_USER

    const { relationType, sourceTaskId, targetTaskId } = this.relationEndpoints(input.type, task.id, relatedTask.id)
    if (relationType === 'parent') {
      this.assertNoParentCycle(task.id, relatedTask.id)
      const existing = [...this.relations.values()].find((r) => r.relationType === 'parent' && r.targetTaskId === task.id)
      if (existing?.sourceTaskId === relatedTask.id) {
        throw new TaskboardError(409, 'RELATION_EXISTS', '该父子关系已存在')
      }
      if (existing) {
        this.relations.delete(this.relationKey(existing))
      }
    } else {
      const existing = this.relations.get(this.relationKey({ relationType, sourceTaskId, targetTaskId, createdAt: '' }))
      if (existing) {
        throw new TaskboardError(409, 'RELATION_EXISTS', '该任务关系已存在')
      }
    }

    const timestamp = now()
    const previousRelation = input.type === 'parent' && task.relations?.parent
      ? relationActivityValue(input.type, task.relations.parent)
      : null
    const record: TaskRelationRecord = { relationType, sourceTaskId, targetTaskId, createdAt: timestamp }
    this.relations.set(this.relationKey(record), record)
    this.persistRelations()
    this.touchTask(task.id, input.version, input.threadId, timestamp)
    this.recordTaskActivity(task.id, actor, [{
      field: 'relation',
      before: previousRelation,
      after: relationActivityValue(input.type, relatedTaskSummary(relatedTask)),
    }], timestamp)
    return { task: this.hydrateTask(this.requireTaskRaw(task.id)), relatedTask: this.hydrateTask(this.requireTaskRaw(relatedTask.id)) }
  }

  removeRelation(input: AddRelationInput): RelationUpdateResult {
    this.ensureLoaded()
    const task = this.requireTaskRaw(input.id)
    const relatedTask = this.requireTaskRaw(input.relatedTaskId)
    this.requireVersion(input.version, task.version, input.id, 'TASK')
    this.validateRelationTasks(task, relatedTask)
    const actor = input.actor ?? TASKBOARD_LOCAL_USER

    const { relationType, sourceTaskId, targetTaskId } = this.relationEndpoints(input.type, task.id, relatedTask.id)
    const key = this.relationKey({ relationType, sourceTaskId, targetTaskId, createdAt: '' })
    const record = this.relations.get(key)
    if (!record) {
      throw new TaskboardError(404, 'RELATION_NOT_FOUND', '该任务关系不存在')
    }
    this.relations.delete(key)
    this.persistRelations()
    const timestamp = now()
    this.touchTask(task.id, input.version, input.threadId, timestamp)
    this.recordTaskActivity(task.id, actor, [{
      field: 'relation',
      before: relationActivityValue(input.type, relatedTaskSummary(relatedTask)),
      after: null,
    }], timestamp)
    return { task: this.hydrateTask(this.requireTaskRaw(task.id)), relatedTask: this.hydrateTask(this.requireTaskRaw(relatedTask.id)) }
  }

  private validateRelationTasks(task: Task, relatedTask: Task): void {
    if (task.id === relatedTask.id) {
      throw new TaskboardError(400, 'SELF_RELATION', '任务不能与自身建立关系')
    }
    if (task.projectId !== relatedTask.projectId) {
      throw new TaskboardError(400, 'CROSS_PROJECT_RELATION', '任务关系必须保持在同一个项目内')
    }
  }

  private relationEndpoints(type: IssueRelationType, taskId: string, relatedTaskId: string): Omit<TaskRelationRecord, 'createdAt'> {
    if (type === 'parent') {
      return { relationType: 'parent', sourceTaskId: relatedTaskId, targetTaskId: taskId }
    }
    if (type === 'blocks') {
      return { relationType: 'blocks', sourceTaskId: taskId, targetTaskId: relatedTaskId }
    }
    if (type === 'blocked_by') {
      return { relationType: 'blocks', sourceTaskId: relatedTaskId, targetTaskId: taskId }
    }
    const sorted: [string, string] = taskId < relatedTaskId ? [taskId, relatedTaskId] : [relatedTaskId, taskId]
    return { relationType: 'related', sourceTaskId: sorted[0], targetTaskId: sorted[1] }
  }

  private assertNoParentCycle(childId: string, parentId: string): void {
    // DFS 走查 parent 链，检测是否会把 childId 变成 parentId 的祖先
    const visited = new Set<string>()
    const stack = [parentId]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current === childId) {
        throw new TaskboardError(409, 'RELATION_CYCLE', '该父子关系将形成环路')
      }
      if (visited.has(current)) continue
      visited.add(current)
      for (const r of this.relations.values()) {
        if (r.relationType === 'parent' && r.targetTaskId === current) {
          stack.push(r.sourceTaskId)
        }
      }
    }
  }

  // ---------- 清理 ----------

  /** 删除物理附件文件（供 deleteArchivedTask 清理） */
  cleanupAttachmentFiles(ids: string[]): void {
    for (const id of ids) {
      try {
        unlinkSync(this.attachmentStoragePath(id))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}

function relatedTaskSummary(t: Task): TaskRelationSummary {
  return {
    id: t.id,
    identifier: t.identifier,
    projectId: t.projectId,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee,
    archivedAt: t.archivedAt,
  }
}

/** 单例实例 */
export const taskboardStore = new TaskboardStore()
