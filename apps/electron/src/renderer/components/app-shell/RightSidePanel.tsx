/**
 * RightSidePanel — 右侧边栏容器
 *
 * 在 Agent 模式下显示文件面板，样式与 LeftSidebar 一致。
 * 从全局 atom 读取当前会话 ID 和路径。
 * 管理「会话文件 / 工作区文件 / 代码改动」Tab 切换。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
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
  agentSessionsAtom,
  createAgentTerminalTab,
  getAgentTerminalSessionId,
} from '@/atoms/agent-atoms'
import type { AgentSidePanelTab } from '@/atoms/agent-atoms'
import { SidePanel } from '@/components/agent/SidePanel'
import type { AgentSidePanelAddTab } from '@/lib/agent-side-panel-tabs'

export function RightSidePanel({ width }: { width?: number }): React.ReactElement | null {
  const appMode = useAtomValue(appModeAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const diffPanelTabMap = useAtomValue(agentDiffPanelTabAtom)
  const sidePanelTabsMap = useAtomValue(agentSidePanelTabsAtom)
  const launcherMap = useAtomValue(agentSidePanelLauncherAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
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

  const sessionPath = currentSessionId
    ? (sessionPathMap.get(currentSessionId) ?? null)
    : null

  const handleCreateTerminal = React.useCallback(async (): Promise<void> => {
    if (!currentSessionId) return
    const conversationTitle = agentSessions.find((session) => session.id === currentSessionId)?.title
    try {
      const terminal = await window.electronAPI.createIntegratedTerminal({
        conversationId: currentSessionId,
        conversationTitle,
        cwd: sessionPath ?? undefined,
      })
      const tab = createAgentTerminalTab(terminal.id)
      openSidePanelTab({
        sessionId: currentSessionId,
        tab,
        terminalSnapshot: terminal,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法打开终端')
    }
  }, [agentSessions, currentSessionId, openSidePanelTab, sessionPath])
  const handleCreateTerminalRequest = React.useCallback(() => {
    void handleCreateTerminal()
  }, [handleCreateTerminal])

  const handleOpenTab = React.useCallback((tab: AgentSidePanelAddTab) => {
    if (!currentSessionId) return
    if (tab === 'terminal') {
      void handleCreateTerminal()
      return
    }
    openSidePanelTab({ sessionId: currentSessionId, tab })
  }, [currentSessionId, handleCreateTerminal, openSidePanelTab])

  const handleCloseTab = React.useCallback((tab: AgentSidePanelTab) => {
    if (!currentSessionId) return
    const terminalSessionId = getAgentTerminalSessionId(tab)
    if (terminalSessionId) {
      void window.electronAPI.closeIntegratedTerminal(terminalSessionId).catch(() => {
        // Shell 自己 exit 时主进程已经销毁 session，关闭 Tab 仍应继续。
      })
    }
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
      onCreateTerminal={handleCreateTerminalRequest}
      onCloseTab={handleCloseTab}
      onReorderTabs={handleReorderTabs}
      onClosePanel={() => closeSidePanel(currentSessionId)}
      width={width}
    />
  )
}
