import type {
  AgentSidePanelStaticTab,
  AgentSidePanelTab,
} from '@/atoms/agent-atoms'

const DEFAULT_TABS: AgentSidePanelStaticTab[] = ['session', 'workspace', 'changes']

/** 返回加号菜单中当前可打开且尚未打开的功能。 */
export function getAvailableAgentSidePanelTabs(input: {
  openTabs: AgentSidePanelTab[]
  hasExecutionGraph: boolean
  hasPlan: boolean
  hasSideChat: boolean
}): AgentSidePanelStaticTab[] {
  const candidates = [...DEFAULT_TABS]
  if (input.hasPlan) candidates.push('plan')
  if (input.hasExecutionGraph) candidates.push('execution')
  if (input.hasSideChat) candidates.push('chat')
  return candidates.filter((tab) => !input.openTabs.includes(tab))
}
