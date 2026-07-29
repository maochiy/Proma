import { describe, expect, test } from 'bun:test'
import {
  getActiveAgentInteractionPanel,
  shouldReplaceAgentComposer,
} from './agent-interaction-panel'

describe('Agent 交互面板替换输入框', () => {
  test('权限审批出现时替换输入框', () => {
    expect(shouldReplaceAgentComposer({
      permission: 1,
      askUser: 0,
      exitPlan: 0,
    })).toBe(true)
  })

  test('AskUser 或计划审批出现时替换输入框', () => {
    expect(shouldReplaceAgentComposer({
      permission: 0,
      askUser: 1,
      exitPlan: 0,
    })).toBe(true)
    expect(shouldReplaceAgentComposer({
      permission: 0,
      askUser: 0,
      exitPlan: 1,
    })).toBe(true)
  })

  test('没有阻塞交互时继续显示输入框', () => {
    expect(shouldReplaceAgentComposer({
      permission: 0,
      askUser: 0,
      exitPlan: 0,
    })).toBe(false)
  })

  test('多个请求同时存在时一次只显示一个交互面板', () => {
    expect(getActiveAgentInteractionPanel({
      permission: 1,
      askUser: 1,
      exitPlan: 1,
    })).toBe('permission')
  })
})
