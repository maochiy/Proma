export interface AgentInteractionRequestCounts {
  permission: number
  askUser: number
  exitPlan: number
}

export type AgentInteractionPanelKind = 'permission' | 'askUser' | 'exitPlan'

/** 同一时间只展示一个阻塞式交互，当前交互完成后再展示队列中的下一类。 */
export function getActiveAgentInteractionPanel(
  counts: AgentInteractionRequestCounts,
): AgentInteractionPanelKind | null {
  if (counts.permission > 0) return 'permission'
  if (counts.askUser > 0) return 'askUser'
  if (counts.exitPlan > 0) return 'exitPlan'
  return null
}

/** 任一阻塞式交互出现时，用交互面板完整替换 Agent 输入框。 */
export function shouldReplaceAgentComposer(
  counts: AgentInteractionRequestCounts,
): boolean {
  return getActiveAgentInteractionPanel(counts) !== null
}
