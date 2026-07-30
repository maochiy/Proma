import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import {
  getAssistantModelMessageId,
  upsertAgentLiveMessage,
} from './agent-live-message'

function assistant(
  uuid: string,
  messageId: string,
  block: Record<string, unknown>,
  partial = false,
): SDKMessage {
  return {
    type: 'assistant',
    uuid,
    _partial: partial,
    parent_tool_use_id: null,
    message: {
      id: messageId,
      content: [block],
    },
  } as SDKMessage
}

describe('Agent 实时消息合并', () => {
  test('Given 已有 thinking partial When 同 UUID 新快照到达 Then 原位替换为累计内容', () => {
    const before = [
      assistant('ccb-partial:msg-1:0', 'msg-1', {
        type: 'thinking',
        thinking: '第一段',
      }, true),
    ]

    const result = upsertAgentLiveMessage(
      before,
      assistant('ccb-partial:msg-1:0', 'msg-1', {
        type: 'thinking',
        thinking: '第一段，第二段',
      }, true),
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      message: {
        content: [{ type: 'thinking', thinking: '第一段，第二段' }],
      },
    })
  })

  test('Given thinking partial 已显示 When Runtime 最终 thinking 消息到达 Then 删除临时快照并保留最终 UUID', () => {
    const result = upsertAgentLiveMessage(
      [
        assistant('ccb-partial:msg-2:0', 'msg-2', {
          type: 'thinking',
          thinking: '累计思考',
        }, true),
      ],
      assistant('runtime-final-uuid', 'msg-2', {
        type: 'thinking',
        thinking: '累计思考',
      }),
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      uuid: 'runtime-final-uuid',
      _partial: false,
    })
  })

  test('Given 最终 thinking 已存在且 text partial 正在生成 When text 最终消息到达 Then 不删除 thinking', () => {
    const result = upsertAgentLiveMessage(
      [
        assistant('runtime-thinking', 'msg-3', {
          type: 'thinking',
          thinking: '思考完成',
        }),
        assistant('ccb-partial:msg-3:1', 'msg-3', {
          type: 'text',
          text: '回答中',
        }, true),
      ],
      assistant('runtime-text', 'msg-3', {
        type: 'text',
        text: '回答完成',
      }),
    )

    expect(result.map((message) =>
      (message as Record<string, unknown>).uuid
    )).toEqual(['runtime-thinking', 'runtime-text'])
  })

  test('Given 同一模型消息存在两个 thinking partial When 第一个 thinking 终态到达 Then 仅移除内容匹配的临时快照', () => {
    const result = upsertAgentLiveMessage(
      [
        assistant('ccb-partial:msg-4:0', 'msg-4', {
          type: 'thinking',
          thinking: '第一段思考',
        }, true),
        assistant('ccb-partial:msg-4:2', 'msg-4', {
          type: 'thinking',
          thinking: '第二段仍在生成',
        }, true),
      ],
      assistant('runtime-thinking-1', 'msg-4', {
        type: 'thinking',
        thinking: '第一段思考',
      }),
    )

    expect(result.map((message) =>
      (message as Record<string, unknown>).uuid
    )).toEqual(['ccb-partial:msg-4:2', 'runtime-thinking-1'])
  })

  test('Given 最终消息携带内容块索引 When 内容与 partial 有差异 Then 仍精确替换指定 partial', () => {
    const firstPartial = assistant('ccb-partial:msg-indexed:0', 'msg-indexed', {
      type: 'thinking',
      thinking: '第一段仍在生成',
    }, true)
    const secondPartial = assistant('ccb-partial:msg-indexed:2', 'msg-indexed', {
      type: 'thinking',
      thinking: '第二段仍在生成',
    }, true)
    ;(firstPartial as Record<string, unknown>)._partialBlockIndex = 0
    ;(secondPartial as Record<string, unknown>)._partialBlockIndex = 2
    const finalMessage = assistant('runtime-indexed', 'msg-indexed', {
      type: 'thinking',
      thinking: '第一段最终内容',
    })
    ;(finalMessage as Record<string, unknown>)._partialBlockIndex = 0

    const result = upsertAgentLiveMessage(
      [firstPartial, secondPartial],
      finalMessage,
    )

    expect(result.map((message) =>
      (message as Record<string, unknown>).uuid
    )).toEqual(['ccb-partial:msg-indexed:2', 'runtime-indexed'])
  })

  test('Given partial 和 final UUID 不同 When 模型 message ID 相同 Then 返回相同稳定身份', () => {
    const partial = assistant('ccb-partial:msg-stable:0', 'msg-stable', {
      type: 'thinking',
      thinking: '思考中',
    }, true)
    const finalMessage = assistant('runtime-stable', 'msg-stable', {
      type: 'thinking',
      thinking: '思考完成',
    })

    expect(getAssistantModelMessageId(partial)).toBe('msg-stable')
    expect(getAssistantModelMessageId(finalMessage)).toBe('msg-stable')
  })

  test('Given 非 partial 消息已存在 When 相同 UUID 再次到达 Then 保持原数组引用', () => {
    const before = [
      assistant('runtime-final', 'msg-5', {
        type: 'text',
        text: '最终回答',
      }),
    ]

    const result = upsertAgentLiveMessage(
      before,
      assistant('runtime-final', 'msg-5', {
        type: 'text',
        text: '最终回答',
      }),
    )

    expect(result).toBe(before)
  })
})
