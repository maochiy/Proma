import type {
  AgentSidePanelStaticTab,
  AgentSidePanelTab,
} from '@/atoms/agent-atoms'

const DEFAULT_TABS: AgentSidePanelStaticTab[] = ['browser', 'session', 'workspace', 'changes']
export type AgentSidePanelAddTab = AgentSidePanelStaticTab | 'terminal'

/** 返回加号菜单中当前可打开且尚未打开的功能。 */
export function getAvailableAgentSidePanelTabs(input: {
  openTabs: AgentSidePanelTab[]
  hasExecutionGraph: boolean
  hasPlan: boolean
  hasSideChat: boolean
}): AgentSidePanelAddTab[] {
  const candidates = [...DEFAULT_TABS]
  if (input.hasPlan) candidates.push('plan')
  if (input.hasExecutionGraph) candidates.push('execution')
  if (input.hasSideChat) candidates.push('chat')
  // 浏览器可同时打开多个实例：始终出现在加号菜单，不因已打开而过滤。
  return [
    'browser',
    ...candidates.filter((tab) => tab !== 'browser' && !input.openTabs.includes(tab)),
    'terminal',
  ]
}
