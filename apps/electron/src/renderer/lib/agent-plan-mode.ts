import type {
  AgentPlanModeChangeSource,
  PromaApprovalMode,
  PromaPermissionMode,
} from '@proma/shared'

export interface PlanModeChange {
  active: boolean
  source: AgentPlanModeChangeSource
}

/** 从 SDK 工具名解析计划阶段变化。 */
export function getPlanModeChangeFromToolName(toolName: string): PlanModeChange | null {
  if (toolName === 'EnterPlanMode') {
    return { active: true, source: 'tool' }
  }
  // ExitPlanMode 只是发起退出计划的审批请求，不能在工具开始时视为已退出。
  // 真正退出由后端在用户批准后发送 plan_mode_changed(active=false)。
  return null
}

/** 更新计划阶段会话集合；无变化时复用原 Set，减少 Jotai 下游刷新。 */
export function updatePlanModeSessionSet(
  prev: Set<string>,
  sessionId: string,
  active: boolean,
): Set<string> {
  if (active) {
    if (prev.has(sessionId)) return prev
    const next = new Set(prev)
    next.add(sessionId)
    return next
  }

  if (!prev.has(sessionId)) return prev
  const next = new Set(prev)
  next.delete(sessionId)
  return next
}

/** 退出计划模式后清除“请执行该计划”等计划建议。 */
export function updatePlanSuggestionForMode(
  prev: Map<string, string>,
  sessionId: string,
  active: boolean,
): Map<string, string> {
  if (active || !prev.has(sessionId)) return prev
  const next = new Map(prev)
  next.delete(sessionId)
  return next
}

/** 历史会话若把 plan 存在审批字段中，回退到安全的“请求批准”。 */
export function normalizeApprovalMode(permissionMode: PromaPermissionMode): PromaApprovalMode {
  return permissionMode === 'plan' ? 'default' : permissionMode
}

/** 独立计划开关优先映射为 CCB plan，关闭后恢复原审批模式。 */
export function getEffectivePermissionMode(
  approvalMode: PromaPermissionMode,
  planModeEnabled: boolean,
): PromaPermissionMode {
  return planModeEnabled ? 'plan' : normalizeApprovalMode(approvalMode)
}
