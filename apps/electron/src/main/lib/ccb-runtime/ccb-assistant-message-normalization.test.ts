import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import { normalizeCcbAssistantMessage } from './ccb-assistant-message-normalization'

describe('CCB Assistant 消息归一化', () => {
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
