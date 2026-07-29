import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import { derivePersistedAgentContextUsage } from './agent-context-usage'

describe('历史会话上下文圆环水合', () => {
  test('Given 普通 assistant usage When 重开会话 Then 恢复最近上下文占用', () => {
    const restored = derivePersistedAgentContextUsage([
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          usage: {
            input_tokens: 12_000,
            output_tokens: 800,
            cache_read_input_tokens: 30_000,
            cache_creation_input_tokens: 2_000,
          },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        modelUsage: {
          model: { contextWindow: 200_000 },
        },
      },
    ] as SDKMessage[])

    expect(restored).toEqual({
      inputTokens: 44_000,
      outputTokens: 800,
      cacheReadTokens: 30_000,
      cacheCreationTokens: 2_000,
      contextWindow: 200_000,
      contextUsageIsEstimated: false,
    })
  })

  test('Given 手动压缩边界和压缩 result When 重开会话 Then 保留 post_tokens', () => {
    const restored = derivePersistedAgentContextUsage([
      {
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: {
          trigger: 'manual',
          pre_tokens: 168_000,
          post_tokens: 24_000,
        },
      },
      {
        type: 'result',
        subtype: 'success',
        usage: {
          input_tokens: 168_000,
          output_tokens: 2_000,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        modelUsage: {
          model: { contextWindow: 200_000 },
        },
      },
    ] as SDKMessage[])

    expect(restored).toEqual({
      inputTokens: 24_000,
      contextWindow: 200_000,
      contextUsageIsEstimated: true,
    })
  })
})
