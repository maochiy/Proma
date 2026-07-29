import { describe, expect, test } from 'bun:test'
import {
  getEffectivePermissionMode,
  getPlanModeChangeFromToolName,
  normalizeApprovalMode,
  updatePlanModeSessionSet,
} from './agent-plan-mode'

describe('Agent 计划阶段状态', () => {
  test('Given EnterPlanMode 工具 When 解析计划状态 Then 标记进入计划阶段', () => {
    expect(getPlanModeChangeFromToolName('EnterPlanMode')).toEqual({
      active: true,
      source: 'tool',
    })
  })

  test('Given ExitPlanMode 工具 When 解析计划状态 Then 不直接标记离开计划阶段', () => {
    expect(getPlanModeChangeFromToolName('ExitPlanMode')).toBeNull()
  })

  test('Given 普通工具 When 解析计划状态 Then 不产生状态变化', () => {
    expect(getPlanModeChangeFromToolName('Read')).toBeNull()
  })

  test('Given 会话进入计划阶段 When 更新集合 Then 只新增目标会话', () => {
    const prev = new Set(['session-a'])
    const next = updatePlanModeSessionSet(prev, 'session-b', true)

    expect([...next].sort()).toEqual(['session-a', 'session-b'])
    expect(next).not.toBe(prev)
  })

  test('Given 会话离开计划阶段 When 更新集合 Then 只移除目标会话', () => {
    const prev = new Set(['session-a', 'session-b'])
    const next = updatePlanModeSessionSet(prev, 'session-b', false)

    expect([...next]).toEqual(['session-a'])
    expect(next).not.toBe(prev)
  })

  test('Given 状态没有变化 When 更新集合 Then 复用原集合', () => {
    const prev = new Set(['session-a'])

    expect(updatePlanModeSessionSet(prev, 'session-a', true)).toBe(prev)
    expect(updatePlanModeSessionSet(prev, 'session-b', false)).toBe(prev)
  })

  test('Given 独立计划模式已启用 When 构造 CCB 参数 Then 使用 plan', () => {
    expect(getEffectivePermissionMode('bypassPermissions', true)).toBe('plan')
  })

  test('Given 独立计划模式关闭 When 构造 CCB 参数 Then 恢复原审批模式', () => {
    expect(getEffectivePermissionMode('bypassPermissions', false)).toBe('bypassPermissions')
    expect(getEffectivePermissionMode('default', false)).toBe('default')
  })

  test('Given 历史审批字段为 plan When 显示审批模式 Then 回退到请求批准', () => {
    expect(normalizeApprovalMode('plan')).toBe('default')
  })
})
