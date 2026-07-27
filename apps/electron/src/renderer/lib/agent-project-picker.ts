import type { AgentWorkspace } from '@proma/shared'

interface AgentProjectPickerItems {
  defaultWorkspace: AgentWorkspace | null
  projects: AgentWorkspace[]
}

/**
 * 将内部默认工作区与用户创建的项目分开。
 *
 * 默认工作区是没有显式项目时的兜底运行目录，不应混在项目列表中冒充用户项目。
 */
export function splitAgentProjectPickerItems(
  workspaces: AgentWorkspace[],
): AgentProjectPickerItems {
  const defaultWorkspace = workspaces.find((workspace) => workspace.slug === 'default') ?? null
  const projects = workspaces.filter((workspace) => workspace.id !== defaultWorkspace?.id)

  return { defaultWorkspace, projects }
}

/** 输入区项目入口的展示名称。 */
export function resolveAgentProjectPickerLabel(
  workspaces: AgentWorkspace[],
  workspaceId: string | null,
): string {
  const workspace = workspaces.find((item) => item.id === workspaceId)
  if (!workspace || workspace.slug === 'default') return '默认工作区'
  return workspace.name
}
