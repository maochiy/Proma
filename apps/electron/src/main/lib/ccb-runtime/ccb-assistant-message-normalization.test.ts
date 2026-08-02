import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import {
  normalizeCcbAssistantMessage,
  normalizeCcbMessage,
} from './ccb-assistant-message-normalization'

describe('CCB SDK 消息归一化', () => {
  test('Given CCB 子智能体发送提示词是字符串 When 归一化 Then 转换为标准用户正文块', () => {
    const message = {
      type: 'user',
      parent_tool_use_id: null,
      uuid: 'ccb-prompt',
      message: {
        role: 'user',
        content: '请完整检查当前项目',
      },
    } as unknown as SDKMessage

    expect(normalizeCcbMessage(message)).toMatchObject({
      type: 'user',
      uuid: 'ccb-prompt',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '请完整检查当前项目' }],
      },
    })
  })

  test('Given 空 thinking 块错误携带正文 When 归一化 Then 转换为标准 text 块', () => {
    const message = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'msg-deepseek',
        content: [{
          type: 'thinking',
          thinking: '',
          signature: '',
          text: '正文继续输出',
        }],
      },
    } as SDKMessage

    expect(normalizeCcbAssistantMessage(message)).toMatchObject({
      message: {
        content: [{ type: 'text', text: '正文继续输出' }],
      },
    })
  })

  test('Given 标准 thinking 块 When 归一化 Then 保持原消息引用', () => {
    const message = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'thinking', thinking: '正常思考过程' }],
      },
    } as SDKMessage

    expect(normalizeCcbAssistantMessage(message)).toBe(message)
  })
})
