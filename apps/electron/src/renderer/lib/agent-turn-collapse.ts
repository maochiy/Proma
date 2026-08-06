export type AgentTurnManualCollapseState = 'expanded' | 'collapsed'

export type AgentAutoCollapseBlockReason =
  | 'background-agent-running'
  | 'cancelled'
  | 'final-answer-not-started'
  | 'no-renderable-activity'
  | 'error-or-blocked'
  | 'full-transcript'

export interface AgentTurnCollapsePolicyInput {
  finalAnswerStarted: boolean
  cancellation: 'none' | 'user' | 'error'
  hasRenderableActivity: boolean
  hasRunningSubagent?: boolean
  hasErrorOrBlockingItem?: boolean
  fullTranscript?: boolean
}

export interface AgentTurnCollapsePolicy {
  collapsible: boolean
  defaultExpanded: boolean
  blockedReason?: AgentAutoCollapseBlockReason
}

export function resolveAgentTurnCollapsePolicy(
  input: AgentTurnCollapsePolicyInput,
): AgentTurnCollapsePolicy {
  const isUserCancelled = input.cancellation === 'user'

  // 用户停止：有活动轨迹即可折叠，默认收起（与运行中视觉一致，只换状态文案）
  // 正常完成：正文开始后可折叠、默认收起
  const collapsible = input.hasRenderableActivity && (
    input.finalAnswerStarted || isUserCancelled
  )

  let blockedReason: AgentAutoCollapseBlockReason | undefined
  if (input.fullTranscript) blockedReason = 'full-transcript'
  else if (input.hasRunningSubagent) blockedReason = 'background-agent-running'
  else if (isUserCancelled) blockedReason = 'cancelled'
  else if (!input.finalAnswerStarted) blockedReason = 'final-answer-not-started'
  else if (!input.hasRenderableActivity) blockedReason = 'no-renderable-activity'
  else if (input.hasErrorOrBlockingItem || input.cancellation === 'error') blockedReason = 'error-or-blocked'

  return {
    collapsible,
    // 用户停止不强制全展开；其它阻止自动折叠的原因仍保持展开
    defaultExpanded: isUserCancelled
      ? false
      : (!collapsible || blockedReason !== undefined),
    blockedReason,
  }
}

export function resolveAgentTurnExpanded(
  policy: AgentTurnCollapsePolicy,
  manualState?: AgentTurnManualCollapseState,
  fullTranscript?: boolean,
): boolean {
  if (fullTranscript) return true
  if (manualState) return manualState === 'expanded'
  return policy.defaultExpanded
}
