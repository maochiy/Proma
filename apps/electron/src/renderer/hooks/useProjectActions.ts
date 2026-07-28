/**
 * useProjectActions — 项目切换与添加的共享逻辑
 *
 * UI 层把 AgentWorkspace 展示为“项目”。底层类型和 IPC 仍沿用 workspace
 * 命名，这里只把对展示组件暴露的动作语义收敛到 project。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import type { AgentWorkspace } from '@proma/shared'

interface UseProjectActionsResult {
  workspaces: AgentWorkspace[]
  currentWorkspaceId: string | null
  /** 切换到指定项目；已是当前项目时无副作用。默认切回对话视图，resetView:false 可保持当前视图（如停留在 Agent 技能） */
  selectProject: (workspaceId: string, opts?: { resetView?: boolean }) => void
  /** 打开系统目录选择器，添加已有项目并切换；取消或失败返回 null */
  addProject: () => Promise<AgentWorkspace | null>
  /** 清空当前项目选择，并同步持久化设置。 */
  clearProject: () => void
}

export function useProjectActions(): UseProjectActionsResult {
  const [workspaces, setWorkspaces] = useAtom(agentWorkspacesAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentAgentWorkspaceIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const addInFlightRef = React.useRef(false)

  const selectProject = React.useCallback(
    (workspaceId: string, opts?: { resetView?: boolean }): void => {
      if (workspaceId === currentWorkspaceId) return
      setCurrentWorkspaceId(workspaceId)
      if (opts?.resetView !== false) setActiveView('conversations')
      window.electronAPI.updateSettings({ agentWorkspaceId: workspaceId }).catch(console.error)
    },
    [currentWorkspaceId, setCurrentWorkspaceId, setActiveView],
  )

  const addProject = React.useCallback(
    async (): Promise<AgentWorkspace | null> => {
      if (addInFlightRef.current) return null
      addInFlightRef.current = true

      try {
        const workspace = await window.electronAPI.createAgentWorkspace()
        if (!workspace) return null
        setWorkspaces((prev) => [
          workspace,
          ...prev.filter((item) => item.id !== workspace.id),
        ])
        setCurrentWorkspaceId(workspace.id)
        setActiveView('conversations')
        window.electronAPI.updateSettings({ agentWorkspaceId: workspace.id }).catch(console.error)
        return workspace
      } catch (error) {
        const msg = error instanceof Error ? error.message : '添加项目失败'
        toast.error(msg)
        return null
      } finally {
        addInFlightRef.current = false
      }
    },
    [setWorkspaces, setCurrentWorkspaceId, setActiveView],
  )

  const clearProject = React.useCallback((): void => {
    setCurrentWorkspaceId(null)
    window.electronAPI.updateSettings({ agentWorkspaceId: undefined }).catch(console.error)
  }, [setCurrentWorkspaceId])

  return {
    workspaces,
    currentWorkspaceId,
    selectProject,
    addProject,
    clearProject,
  }
}
