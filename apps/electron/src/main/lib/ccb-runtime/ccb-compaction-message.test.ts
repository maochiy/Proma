import { describe, expect, test } from 'bun:test'
import type { SDKMessage, SDKSystemMessage } from '@proma/shared'
import {
  createContextCompactionConfigMessage,
  normalizeCcbCompactionMessage,
} from './ccb-compaction-message'

describe('CCB 上下文压缩消息映射', () => {
  test('Given 自动压缩边界 When 映射 Then 保留触发来源和压缩前后 token', () => {
    const message = normalizeCcbCompactionMessage({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'auto',
        pre_tokens: 168_000,
        post_tokens: 24_000,
        summary: '已整理当前任务上下文。',
      },
    } as SDKMessage, false) as SDKSystemMessage

    expect(message.compactTrigger).toBe('auto')
    expect(message.compactPreTokens).toBe(168_000)
    expect(message.compactionEstimatedTokensAfter).toBe(24_000)
    expect(message.summary).toBe('已整理当前任务上下文。')
  })

  test('Given 手动压缩状态 When CCB 开始压缩 Then 标记为 manual', () => {
    const message = normalizeCcbCompactionMessage({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
    } as SDKMessage, true) as SDKSystemMessage

    expect(message.compactTrigger).toBe('manual')
  })

  test('Given 手动压缩结果 When 映射 Then 不允许 result usage 覆盖压缩后 token', () => {
    const message = normalizeCcbCompactionMessage({
      type: 'result',
      subtype: 'success',
      usage: {
        input_tokens: 168_000,
        output_tokens: 2_000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    } as SDKMessage, true) as SDKMessage & {
      isSyntheticCompactionResult?: boolean
    }

    expect(message.isSyntheticCompactionResult).toBe(true)
  })

  test('Given CCB 动态阈值 When 转换配置事件 Then Renderer 可直接消费', () => {
    const message = createContextCompactionConfigMessage({
      autoCompactEnabled: true,
      autoCompactThreshold: 167_000,
      effectiveContextWindow: 180_000,
    }, 'session-1') as SDKSystemMessage

    expect(message.subtype).toBe('context_compaction_config')
    expect(message.autoCompactEnabled).toBe(true)
    expect(message.autoCompactThreshold).toBe(167_000)
    expect(message.effectiveContextWindow).toBe(180_000)
  })

  test('Given 不完整配置 When 转换 Then 丢弃非法事件', () => {
    expect(createContextCompactionConfigMessage({
      autoCompactEnabled: true,
    }, 'session-1')).toBeUndefined()
  })
})
