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
    path: `/projects/${slug}`,
    canonicalPath: `/projects/${slug}`,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('Agent 输入区项目选择', () => {
  const projectA = createWorkspace('project-a', 'Proma', 'proma')
  const projectB = createWorkspace('project-b', 'Claude Code', 'claude-code')

  test('Given 已添加的本机项目 When 构建选择列表 Then 全部作为已有项目展示', () => {
    const result = splitAgentProjectPickerItems([projectA, projectB])

    expect(result.defaultWorkspace).toBeNull()
    expect(result.projects).toEqual([projectA, projectB])
  })

  test('Given 当前没有选中项目 When 显示入口 Then 使用默认工作区文案', () => {
    expect(resolveAgentProjectPickerLabel([projectA], null)).toBe('默认工作区')
  })

  test('Given 已选择用户项目 When 显示入口 Then 展示项目名称', () => {
    expect(resolveAgentProjectPickerLabel([projectA], projectA.id))
      .toBe('Proma')
  })
})
