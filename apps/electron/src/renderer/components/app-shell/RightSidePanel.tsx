/**
 * RightSidePanel — 右侧边栏容器
 *
 * 在 Agent 模式下显示文件面板，样式与 LeftSidebar 一致。
 * 从全局 atom 读取当前会话 ID 和路径。
 * 管理「会话文件 / 工作区文件 / 代码改动」Tab 切换。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { appModeAtom } from '@/atoms/app-mode'
import {
  currentAgentSessionIdAtom,
  agentSessionPathMapAtom,
  agentDiffPanelTabAtom,
  agentSidePanelLauncherAtom,
  agentSidePanelTabsAtom,
  closeAgentSidePanelTabAtom,
  closeAgentSidePanelAtom,
  openAgentSidePanelTabAtom,
  reorderAgentSidePanelTabsAtom,
} from '@/atoms/agent-atoms'
import type { AgentSidePanelTab } from '@/atoms/agent-atoms'
import { SidePanel } from '@/components/agent/SidePanel'

export function RightSidePanel({ width }: { width?: number }): React.ReactElement | null {
  const appMode = useAtomValue(appModeAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const diffPanelTabMap = useAtomValue(agentDiffPanelTabAtom)
  const sidePanelTabsMap = useAtomValue(agentSidePanelTabsAtom)
  const launcherMap = useAtomValue(agentSidePanelLauncherAtom)
  const setDiffPanelTabMap = useSetAtom(agentDiffPanelTabAtom)
  const openSidePanelTab = useSetAtom(openAgentSidePanelTabAtom)
  const closeSidePanelTab = useSetAtom(closeAgentSidePanelTabAtom)
  const reorderSidePanelTabs = useSetAtom(reorderAgentSidePanelTabsAtom)
  const closeSidePanel = useSetAtom(closeAgentSidePanelAtom)

  const setActiveTab = React.useCallback((tab: AgentSidePanelTab) => {
    if (!currentSessionId) return
    setDiffPanelTabMap((prev) => {
      const map = new Map(prev)
      map.set(currentSessionId, tab)
      return map
    })
  }, [currentSessionId, setDiffPanelTabMap])

  const handleOpenTab = React.useCallback((tab: AgentSidePanelTab) => {
    if (!currentSessionId) return
    openSidePanelTab({ sessionId: currentSessionId, tab })
  }, [currentSessionId, openSidePanelTab])

  const handleCloseTab = React.useCallback((tab: AgentSidePanelTab) => {
    if (!currentSessionId) return
    closeSidePanelTab({ sessionId: currentSessionId, tab })
  }, [closeSidePanelTab, currentSessionId])

  const handleReorderTabs = React.useCallback((
    source: AgentSidePanelTab,
    target: AgentSidePanelTab,
  ) => {
    if (!currentSessionId || source === target) return
    reorderSidePanelTabs({ sessionId: currentSessionId, source, target })
  }, [currentSessionId, reorderSidePanelTabs])

  if (appMode !== 'agent' || !currentSessionId) {
    return null
  }

  const sessionPath = sessionPathMap.get(currentSessionId) ?? null
  const openTabs = sidePanelTabsMap.get(currentSessionId) ?? []
  const launcherVisible = launcherMap.get(currentSessionId) ?? openTabs.length === 0
  const storedActiveTab = diffPanelTabMap.get(currentSessionId)
  const activeTab = storedActiveTab && openTabs.includes(storedActiveTab)
    ? storedActiveTab
    : (openTabs[0] ?? 'session')

  return (
    <SidePanel
      sessionId={currentSessionId}
      sessionPath={sessionPath}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      openTabs={openTabs}
      launcherVisible={launcherVisible}
      onOpenTab={handleOpenTab}
      onCloseTab={handleCloseTab}
      onReorderTabs={handleReorderTabs}
      onClosePanel={() => closeSidePanel(currentSessionId)}
      width={width}
    />
  )
}
