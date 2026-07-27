import { describe, expect, test } from 'bun:test'
import type { AgentWorkspace } from '@proma/shared'
import {
  resolveAgentProjectPickerLabel,
  splitAgentProjectPickerItems,
} from './agent-project-picker'

function createWorkspace(
  id: string,
  name: string,
  slug: string,
): AgentWorkspace {
  return {
    id,
    name,
    slug,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('Agent 输入区项目选择', () => {
  const defaultWorkspace = createWorkspace('default-id', '默认工作区', 'default')
  const projectA = createWorkspace('project-a', 'Proma', 'proma')
  const projectB = createWorkspace('project-b', 'Claude Code', 'claude-code')

  test('Given 默认工作区和用户项目 When 构建选择列表 Then 默认工作区与项目分开展示', () => {
    const result = splitAgentProjectPickerItems([
      projectA,
      defaultWorkspace,
      projectB,
    ])

    expect(result.defaultWorkspace).toEqual(defaultWorkspace)
    expect(result.projects).toEqual([projectA, projectB])
  })

  test('Given 当前没有显式项目 When 显示入口 Then 使用默认工作区文案', () => {
    expect(resolveAgentProjectPickerLabel([defaultWorkspace, projectA], null))
      .toBe('默认工作区')
    expect(resolveAgentProjectPickerLabel([defaultWorkspace, projectA], defaultWorkspace.id))
      .toBe('默认工作区')
  })

  test('Given 已选择用户项目 When 显示入口 Then 展示项目名称', () => {
    expect(resolveAgentProjectPickerLabel([defaultWorkspace, projectA], projectA.id))
      .toBe('Proma')
  })
})
