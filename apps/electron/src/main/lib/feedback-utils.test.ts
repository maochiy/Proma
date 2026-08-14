/**
 * 反馈会话整理 BDD 测试。
 */

import { describe, expect, test } from 'bun:test'
import {
  buildFeedbackTranscript,
  resolveFeedbackSession,
  sanitizeFeedbackValue,
} from './feedback-utils'

describe('反馈会话 ID 解析', () => {
  const conversations = [{ id: 'chat-session' }]
  const agentSessions = [{ id: 'agent-session' }]

  test('Given 用户手动输入 Agent 会话 ID When 解析会话 Then 自动识别为 Agent 会话', () => {
    expect(resolveFeedbackSession(
      ' agent-session ',
      undefined,
      conversations,
      agentSessions,
    )).toEqual({
      id: 'agent-session',
      type: 'agent',
    })
  })

  test('Given 从 Chat 右键菜单打开反馈 When ID 不属于 Chat Then 拒绝读取其他类型会话', () => {
    expect(() => resolveFeedbackSession(
      'agent-session',
      'chat',
      conversations,
      agentSessions,
    )).toThrow('未找到对应的本地会话，请检查会话 ID')
  })

  test('Given 用户输入不存在的会话 ID When 解析会话 Then 返回明确错误', () => {
    expect(() => resolveFeedbackSession(
      'missing-session',
      undefined,
      conversations,
      agentSessions,
    )).toThrow('未找到对应的本地会话，请检查会话 ID')
  })
})

describe('反馈会话数据脱敏', () => {
  test('Given 会话包含密钥和本地用户路径 When 整理反馈 Then 隐藏敏感信息', () => {
    const result = sanitizeFeedbackValue({
      authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
      content: 'API_KEY=secret-value 文件位于 /Users/alice/project',
      nested: {
        token: 'github_pat_abcdefghijklmnopqrstuvwxyz',
      },
    })

    expect(result).toEqual({
      authorization: '[已隐藏]',
      content: 'API_KEY=[已隐藏] 文件位于 /Users/[用户]/project',
      nested: {
        token: '[已隐藏]',
      },
    })
  })

  test('Given 超过上限的历史消息 When 构建反馈记录 Then 只附带最近消息并标记截断', () => {
    const messages = Array.from({ length: 60 }, (_, index) => ({
      type: 'user',
      content: `消息 ${index}`,
    }))

    const result = buildFeedbackTranscript(messages)

    expect(result.totalMessages).toBe(60)
    expect(result.includedMessages).toBe(50)
    expect(result.truncated).toBe(true)
    expect(result.messages[0]).toEqual({
      type: 'user',
      content: '消息 10',
    })
  })
})
