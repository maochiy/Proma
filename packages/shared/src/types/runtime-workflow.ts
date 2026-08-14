/**
 * 旧版多 Runtime 工作流兼容类型。
 *
 * Proma 新请求使用 runtime-dispatch.ts 中的 Hermes 动态任务图。
 * 这些类型仅用于读取旧版本数据和迁移，不再作为产品 UI 或主调度入口。
 */

import type { HarnessId, RuntimeId } from './runtime'
import type { RuntimeTaskKind } from './runtime-dispatch'

export type AgentWorkflowStage =
  | 'clarification'
  | 'requirements_confirmed'
  | 'coordination'
  | 'planning'
  | 'plan_approval'
  | 'implementation'
  | 'review'
  | 'final_summary'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 单轮消息可携带的内部调度上下文。 */
export interface AgentDispatchContext {
  taskId?: string
  taskDispatch?: boolean
  executionMode?: string
  collaborationMode?: string
  userAgentCount?: number
  planStage?: 'coordination' | 'planning' | 'implementation'
  planRequested?: boolean
  approvedPlan?: boolean
  planExecutionId?: string
  workflowId?: string
  workflowStage?: AgentWorkflowStage
  /** 主进程校验后的内部阶段，Renderer 不可直接设置。 */
  internalWorkflowStage?: AgentWorkflowStage
  /** Hermes 动态调度运行 ID；仅主进程验证后生效。 */
  dispatchRunId?: string
  /** 当前需求是否已由用户确认。 */
  requirementsConfirmed?: boolean
  /** 最近一次 Pi 澄清尚未收到用户确认，后续消息继续交给 Pi。 */
  clarificationPending?: boolean
  /** 当前任务是否已由用户批准。 */
  approvedTaskIds?: string[]
  /** 主进程生成的任务类型，用户输入不能直接伪造。 */
  internalTaskKind?: RuntimeTaskKind
  /** 仅主进程内部调度入口使用。 */
  internalDispatch?: boolean
}

export type ClarificationStatus = 'not_needed' | 'in_progress' | 'awaiting_confirmation' | 'confirmed'

export interface AgentDispatchState {
  runtimeId: RuntimeId
  intent: string
  clarificationStatus: ClarificationStatus
  workflowId: string | null
  dispatchRunId?: string | null
  updatedAt: number
}

export type WorkflowPlanStatus = 'none' | 'draft' | 'waiting_approval' | 'approved' | 'rejected'
export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type WorkflowArtifactType =
  | 'requirements'
  | 'task_graph'
  | 'implementation_plan'
  | 'implementation_result'
  | 'review_result'
  | 'final_summary'

export interface RuntimeWorkflowRun {
  id: string
  workflowId: string
  runtimeId: RuntimeId
  harnessId: HarnessId
  stage: AgentWorkflowStage
  status: WorkflowRunStatus
  sessionId: string | null
  startedAt: number | null
  completedAt: number | null
  error: string | null
}

export interface WorkflowArtifact {
  id: string
  workflowId: string
  type: WorkflowArtifactType
  content: string
  structured?: Record<string, string | number | boolean | null>
  sourceRuntimeId: RuntimeId
  createdAt: number
}

export interface AgentWorkflow {
  id: string
  threadId: string
  workspaceId: string | null
  stage: AgentWorkflowStage
  requirementStatus: 'draft' | 'awaiting_confirmation' | 'confirmed'
  planStatus: WorkflowPlanStatus
  implementationStatus: 'pending' | 'running' | 'completed' | 'failed'
  reviewStatus: 'pending' | 'running' | 'passed' | 'failed'
  reviewAttempts: number
  runtimeRuns: RuntimeWorkflowRun[]
  artifacts: WorkflowArtifact[]
  createdAt: number
  updatedAt: number
}

export interface WorkflowStartInput {
  threadId: string
  workspaceId?: string
  request: string
}

export interface WorkflowPlanDecisionInput {
  workflowId: string
  decision: 'approve' | 'reject'
  feedback?: string
}

export interface WorkflowCompletionInput {
  workflowId: string
  content: string
  passed?: boolean
}

/** 启动当前工作流阶段时传入的宿主参数。 */
export interface WorkflowRunStageInput {
  workflowId: string
  cwd?: string
  model?: string
  env?: Record<string, string | undefined>
  /** 仅用于审查阶段；未传时由 Runner 根据审查文本推断。 */
  passed?: boolean
}

/** 工作流当前阶段交给 Runtime Adapter 的可执行描述。 */
export interface WorkflowStageDispatch {
  workflowId: string
  runId: string
  stage: AgentWorkflowStage
  runtimeId: RuntimeId
  prompt: string
  inputArtifacts: string[]
  requiresUserApproval: boolean
}

export const WORKFLOW_IPC_CHANNELS = {
  LIST: 'workflow:list',
  GET: 'workflow:get',
  START: 'workflow:start',
  RUN_STAGE: 'workflow:run-stage',
  RUN: 'workflow:run',
  CONFIRM_REQUIREMENTS: 'workflow:confirm-requirements',
  SAVE_COORDINATION: 'workflow:save-coordination',
  SAVE_PLAN: 'workflow:save-plan',
  DECIDE_PLAN: 'workflow:decide-plan',
  COMPLETE_IMPLEMENTATION: 'workflow:complete-implementation',
  COMPLETE_REVIEW: 'workflow:complete-review',
  COMPLETE_SUMMARY: 'workflow:complete-summary',
  CANCEL: 'workflow:cancel',
} as const

export type WorkflowIpcChannel = (typeof WORKFLOW_IPC_CHANNELS)[keyof typeof WORKFLOW_IPC_CHANNELS]
