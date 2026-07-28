import type { AgentWorkspace } from '@proma/shared'

interface AgentProjectPickerItems {
  defaultWorkspace: AgentWorkspace | null
  projects: AgentWorkspace[]
}

/**
 * 保留历史返回结构；v3 起列表中只有用户选择的本机已有项目。
 */
export function splitAgentProjectPickerItems(
  workspaces: AgentWorkspace[],
): AgentProjectPickerItems {
  return { defaultWorkspace: null, projects: workspaces }
}

/** 输入区项目入口的展示名称。 */
export function resolveAgentProjectPickerLabel(
  workspaces: AgentWorkspace[],
  workspaceId: string | null,
): string {
  const workspace = workspaces.find((item) => item.id === workspaceId)
  if (!workspace) return '默认工作区'
  return workspace.name
}
