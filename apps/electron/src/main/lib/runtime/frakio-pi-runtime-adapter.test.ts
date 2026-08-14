import { describe, expect, test } from 'bun:test'
import { compactionSystemMessage, contextCompactionConfigMessage, usageSystemMessage } from './frakio-pi-runtime-adapter'

describe('Proma Pi 压缩事件转换', () => {
  test('Given Pi 开始压缩 When 收到 compaction.started Then 转换为 compacting system 消息', () => {
    const message = compactionSystemMessage('session-1', 'context.compaction.started', {
      trigger: 'threshold',
      tokensBefore: 168_000,
    })
    expect(message).toMatchObject({
      type: 'system',
      subtype: 'compacting',
      session_id: 'session-1',
      compactTrigger: 'auto',
      compactPreTokens: 168_000,
    })
  })

  test('Given Pi 手动压缩开始 When 收到 compaction.started Then trigger 为 manual', () => {
    const message = compactionSystemMessage('session-1', 'context.compaction.started', {
      trigger: 'manual',
    })
    expect(message).toMatchObject({
      subtype: 'compacting',
      compactTrigger: 'manual',
    })
  })

  test('Given Pi 压缩成功 When 收到 compaction.completed Then 转换为 compact_boundary 并携带元数据', () => {
    const message = compactionSystemMessage('session-1', 'context.compaction.completed', {
      trigger: 'threshold',
      tokensBefore: 168_000,
      tokensAfterEstimate: 24_000,
    })
    expect(message).toMatchObject({
      type: 'system',
      subtype: 'compact_boundary',
      compactTrigger: 'auto',
      compactPreTokens: 168_000,
      compactionEstimatedTokensAfter: 24_000,
      compact_metadata: {
        trigger: 'auto',
        pre_tokens: 168_000,
        post_tokens: 24_000,
      },
    })
  })

  test('Given Pi 压缩失败 When 收到 compaction.failed Then 转换为 status 并保留错误详情', () => {
    const message = compactionSystemMessage('session-1', 'context.compaction.failed', {
      trigger: 'manual',
      error: '模型调用超时',
    })
    expect(message).toMatchObject({
      type: 'system',
      subtype: 'status',
      compact_result: 'failed',
      compact_error: '模型调用超时',
    })
  })

  test('Given Pi 压缩失败且无错误信息 When 转换 Then 使用兜底文案', () => {
    const message = compactionSystemMessage('session-1', 'context.compaction.failed', {})
    expect(message).toMatchObject({
      compact_result: 'failed',
      compact_error: '上下文压缩失败',
    })
  })
})

describe('Proma Pi usage 事件转换', () => {
  test('Given Pi 上报 usage 与上下文窗口 When 转换 Then 透传 context_window', () => {
    const message = usageSystemMessage('session-1', {
      inputTokens: 12_000,
      outputTokens: 3_000,
      contextWindow: 200_000,
    })
    expect(message).toMatchObject({
      type: 'assistant',
      session_id: 'session-1',
      message: {
        content: [],
        usage: {
          input_tokens: 12_000,
          output_tokens: 3_000,
          context_window: 200_000,
        },
      },
    })
  })

  test('Given Pi 上报无上下文窗口 When 转换 Then usage 不含 context_window', () => {
    const message = usageSystemMessage('session-1', {
      inputTokens: 100,
      outputTokens: 50,
    })
    const usage = (message as { message: { usage: Record<string, unknown> } }).message.usage
    expect(usage.input_tokens).toBe(100)
    expect(usage.output_tokens).toBe(50)
    expect(usage.context_window).toBeUndefined()
  })

  test('Given Pi 上报缓存字段 When 转换 Then 透传 cache_read/cache_creation', () => {
    const message = usageSystemMessage('session-1', {
      inputTokens: 12_000,
      outputTokens: 3_000,
      cacheReadTokens: 88_000,
      cacheWriteTokens: 2_000,
      contextWindow: 200_000,
    })
    expect(message).toMatchObject({
      type: 'assistant',
      session_id: 'session-1',
      message: {
        content: [],
        usage: {
          input_tokens: 12_000,
          output_tokens: 3_000,
          cache_read_input_tokens: 88_000,
          cache_creation_input_tokens: 2_000,
          context_window: 200_000,
        },
      },
    })
  })
})

describe('Proma Pi context_compaction_config 消息', () => {
  test('Given 压缩策略齐全 When 转换 Then 生成可持久化的 config system 消息', () => {
    const message = contextCompactionConfigMessage({
      enabled: true,
      threshold: 160_000,
      contextWindow: 200_000,
    }, 'session-1')
    expect(message).toMatchObject({
      type: 'system',
      subtype: 'context_compaction_config',
      session_id: 'session-1',
      autoCompactEnabled: true,
      autoCompactThreshold: 160_000,
      effectiveContextWindow: 200_000,
    })
  })

  test('Given 压缩未启用 When 转换 Then 返回 undefined', () => {
    expect(contextCompactionConfigMessage({
      enabled: false,
      threshold: 160_000,
      contextWindow: 200_000,
    }, 'session-1')).toBeUndefined()
  })

  test('Given 缺少阈值或窗口 When 转换 Then 返回 undefined', () => {
    expect(contextCompactionConfigMessage({ enabled: true, threshold: 160_000 }, 'session-1')).toBeUndefined()
    expect(contextCompactionConfigMessage({ enabled: true, contextWindow: 200_000 }, 'session-1')).toBeUndefined()
  })
})
