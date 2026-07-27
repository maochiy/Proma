import { describe, expect, test } from 'bun:test'
import { canSwitchAgentProject } from './agent-project-switch'

describe('Agent 输入区项目切换', () => {
  test('Given 新建的空白任务 When 判断项目切换 Then 允许直接选择项目', () => {
    expect(canSwitchAgentProject({
      messagesLoaded: true,
      persistedMessageCount: 0,
      liveMessageCount: 0,
      streaming: false,
      backgroundWaiting: false,
    })).toBe(true)
  })

  test('Given 已产生消息或 Runtime 上下文的任务 When 判断项目切换 Then 必须走完整迁移流程', () => {
    expect(canSwitchAgentProject({
      messagesLoaded: true,
      persistedMessageCount: 1,
      liveMessageCount: 0,
      runtimeSessionId: 'runtime-session',
      streaming: false,
      backgroundWaiting: false,
    })).toBe(false)
  })

  test('Given 消息仍在加载或任务仍运行 When 判断项目切换 Then 禁止切换', () => {
    expect(canSwitchAgentProject({
      messagesLoaded: false,
      persistedMessageCount: 0,
      liveMessageCount: 0,
      streaming: true,
      backgroundWaiting: false,
    })).toBe(false)
  })
})
