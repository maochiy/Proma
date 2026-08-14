/**
 * taskboard-session-sync — 会话 ↔ 任务看板双向同步
 *
 * 会话（Agent Session）与任务看板任务是两个独立实体，但通过以下字段绑定：
 * - 任务.threadId = 会话 id（任务→会话方向，已由渲染层实现）
 * - 会话.taskboardTaskId = 任务 id（会话→任务方向，本服务维护）
 *
 * 本服务承载"会话 → 任务"方向的自动建卡与状态映射：
 * - 会话发送首条消息（onRunStarted）→ 自动在会话所属项目创建任务卡，状态 in_progress
 * - 会话完成/停止/出错（onComplete/onError）→ 按状态映射更新任务状态
 * - 无工作区的会话归入全局项目（'local'）
 * - 委派/子 Agent 会话（parentSessionId / sourceDelegationId）不自动建卡，避免污染
 *
 * 每次写库后调用 notifyTaskboardChanged() 广播，让渲染层实时刷新。
 */

import { randomUUID } from 'node:crypto'
import {
  TASKBOARD_DEFAULT_PROJECT_ID,
  TASKBOARD_CODEX_AGENT,
  type AgentSessionMeta,
  type Task,
  type TaskStatus,
} from '@proma/shared'
import { taskboardStore } from './taskboard-store'
import { notifyTaskboardChanged } from './taskboard-notify'
import {
  getAgentSessionMeta,
  getAgentSessionMessages,
  updateAgentSessionMeta,
} from '../agent-session-manager'
import { getAgentWorkspace } from '../agent-workspace-manager'

/** 是否需要为该会话自动建任务卡（会话→任务方向） */
export function shouldAutoCreateTask(session: AgentSessionMeta): boolean {
  if (session.draft) return false
  if (session.parentSessionId || session.sourceDelegationId) return false
  return true
}

/** 会话所属的项目 id：有工作区用工作区 id，无则归全局项目 */
export function resolveSessionProjectId(session: AgentSessionMeta): string {
  return session.workspaceId || TASKBOARD_DEFAULT_PROJECT_ID
}

/** 确保工作区对应的任务看板项目存在，返回项目 id */
export function ensureProjectForWorkspace(workspaceId: string | undefined): string {
  if (!workspaceId || workspaceId === TASKBOARD_DEFAULT_PROJECT_ID) {
    return TASKBOARD_DEFAULT_PROJECT_ID
  }
  const existing = taskboardStore.getProject(workspaceId)
  if (existing) return workspaceId
  const workspace = getAgentWorkspace(workspaceId)
  taskboardStore.createProject({
    id: workspaceId,
    name: workspace?.name || workspaceId,
    workspacePath: workspace?.path ?? null,
  })
  return workspaceId
}

/** 从会话消息中提取首条用户消息作为任务描述摘要 */
function extractFirstUserMessageSummary(sessionId: string): string {
  const messages = getAgentSessionMessages(sessionId)
  for (const message of messages) {
    if (message.role === 'user' && message.content.trim()) {
      const collapsed = message.content.replace(/\s+/g, ' ').trim()
      return collapsed.length > 200 ? `${collapsed.slice(0, 200)}…` : collapsed
    }
  }
  return ''
}

/**
 * 会话发送首条消息时调用：确保绑定任务存在。
 *
 * - 会话已绑定 taskboardTaskId 且任务存在 → 仅同步状态，不重复建卡
 * - 存在 threadId === session.id 的任务（任务→会话方向已建）→ 复用，绑定 taskboardTaskId
 * - 否则在会话所属项目创建任务，双向绑定
 */
export function syncSessionToTask(session: AgentSessionMeta): Task | null {
  if (!shouldAutoCreateTask(session)) return null

  // 1. 会话已绑定任务
  if (session.taskboardTaskId) {
    const bound = taskboardStore.getTask(session.taskboardTaskId)
    if (bound) {
      if (bound.threadId !== session.id) {
        const updated = taskboardStore.updateTask({
          id: bound.id,
          version: bound.version,
          threadId: session.id,
          actor: TASKBOARD_CODEX_AGENT,
        })
        notifyTaskboardChanged()
        return updated
      }
      return bound
    }
  }

  // 2. 已存在 threadId 指向本会话的任务（任务→会话方向）
  const existing = taskboardStore.listTasks({ archived: 'false' })
    .find((t) => t.threadId === session.id)
  if (existing) {
    try {
      updateAgentSessionMeta(session.id, { taskboardTaskId: existing.id })
    } catch { /* 会话可能尚不可写 */ }
    return existing
  }

  // 3. 新建任务
  const projectId = ensureProjectForWorkspace(session.workspaceId)
  const task = taskboardStore.createTask({
    id: randomUUID(),
    projectId,
    title: session.title || '新 Agent 会话',
    description: extractFirstUserMessageSummary(session.id),
    status: 'in_progress',
    threadId: session.id,
    agentChannelId: session.channelId ?? null,
    agentModelId: session.modelId ?? null,
    actor: TASKBOARD_CODEX_AGENT,
  })
  try {
    updateAgentSessionMeta(session.id, { taskboardTaskId: task.id })
  } catch { /* 会话可能尚不可写 */ }
  notifyTaskboardChanged()
  return task
}

/**
 * 会话完成/停止/出错时调用：按结果映射更新绑定任务状态。
 *
 * 每次同步前先 syncSessionToTask 确保绑定任务存在（覆盖首轮建卡后直接完成的情况）。
 */
export function syncSessionStatusToTask(
  sessionId: string,
  outcome: {
    stoppedByUser?: boolean
    error?: string
    resultErrors?: string[]
    backgroundTasksPending?: boolean
  },
): Task | null {
  const session = getAgentSessionMeta(sessionId)
  if (!session) return null
  const task = syncSessionToTask(session)
  if (!task) return null

  let status: TaskStatus
  if (outcome.backgroundTasksPending) {
    // 后台任务仍在飞行，保持处理中
    status = 'in_progress'
  } else if (outcome.error || (outcome.resultErrors && outcome.resultErrors.length > 0)) {
    status = 'blocked'
  } else if (outcome.stoppedByUser) {
    status = 'blocked'
  } else {
    status = 'done'
  }

  if (task.status !== status) {
    const updated = taskboardStore.updateTask({
      id: task.id,
      version: task.version,
      status,
      actor: TASKBOARD_CODEX_AGENT,
    })
    notifyTaskboardChanged()
    return updated
  }
  return task
}
