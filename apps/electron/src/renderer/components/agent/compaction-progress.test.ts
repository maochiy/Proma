import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import { getContextCompactionProgress, isCompactionControlHistoryGroup } from './AgentMessages'

function systemMessage(fields: Record<string, unknown>): SDKMessage {
  return { type: 'system', ...fields } as unknown as SDKMessage
}

describe('context compaction progress overlay state', () => {
  test('hides compacting controls but keeps completed boundary in history', () => {
    expect(isCompactionControlHistoryGroup({
      type: 'user',
      message: { type: 'user', message: { content: [{ type: 'text', text: '/compact' }] } },
    } as never)).toBe(true)
    expect(isCompactionControlHistoryGroup({
      type: 'system',
      message: { type: 'system', subtype: 'compact_boundary' },
    } as never)).toBe(false)
    expect(isCompactionControlHistoryGroup({
      type: 'system',
      message: { type: 'system', subtype: 'context_compaction_config' },
    } as never)).toBe(true)
    expect(isCompactionControlHistoryGroup({
      type: 'user',
      message: { type: 'user', message: { content: [{ type: 'text', text: '继续处理当前任务' }] } },
    } as never)).toBe(false)
  })


  test('shows a running state before the SDK emits a compacting message', () => {
    expect(getContextCompactionProgress([], true, undefined)).toMatchObject({
      status: 'running',
      label: '正在压缩上下文',
    })
  })

  test('retains a no-op terminal state after live messages are cleared', () => {
    expect(getContextCompactionProgress([], false, {
      status: 'noop',
      message: '当前上下文较小，暂时无需压缩。',
    })).toMatchObject({
      status: 'noop',
      label: '当前上下文无需压缩',
    })
  })

  test('maps successful compaction to a terminal state', () => {
    expect(getContextCompactionProgress([
      systemMessage({ subtype: 'compact_boundary', summary: '已完成的工作已整理。' }),
    ], false, undefined)).toMatchObject({
      status: 'success',
      label: '上下文已压缩',
    })
  })

  test('shows automatic compaction source and token reduction', () => {
    expect(getContextCompactionProgress([], false, {
      status: 'success',
      trigger: 'auto',
      preTokens: 168_000,
      postTokens: 24_000,
    })).toMatchObject({
      status: 'success',
      label: '上下文已自动压缩',
      detail: '上下文约 168.0k → 24.0k tokens。',
    })
  })

  test('manual running state uses manual wording', () => {
    expect(getContextCompactionProgress([], false, {
      status: 'running',
      trigger: 'manual',
    })).toMatchObject({
      status: 'running',
      label: '正在压缩上下文',
    })
  })

  test('auto running state uses auto wording', () => {
    expect(getContextCompactionProgress([], false, {
      status: 'running',
      trigger: 'auto',
    })).toMatchObject({
      status: 'running',
      label: '正在自动压缩上下文',
    })
  })

  test('manual success state uses manual wording', () => {
    expect(getContextCompactionProgress([], false, {
      status: 'success',
      trigger: 'manual',
    })).toMatchObject({
      status: 'success',
      label: '上下文已压缩',
    })
  })

  test('persisted auto compact boundary uses auto wording', () => {
    expect(getContextCompactionProgress([
      systemMessage({ subtype: 'compact_boundary', compactTrigger: 'auto' }),
    ], false, undefined)).toMatchObject({
      status: 'success',
      label: '上下文已自动压缩',
    })
  })

  test('maps a no-op result to a clear terminal state', () => {
    expect(getContextCompactionProgress([
      systemMessage({
        subtype: 'status',
        compact_result: 'noop',
        message: '当前上下文较小，暂时无需压缩。',
      }),
    ], false, undefined)).toMatchObject({
      status: 'noop',
      label: '当前上下文无需压缩',
    })
  })

  test('keeps compaction failures visible with their error details', () => {
    expect(getContextCompactionProgress([
      systemMessage({
        subtype: 'status',
        compact_result: 'failed',
        compact_error: 'provider unavailable',
      }),
    ], false, undefined)).toMatchObject({
      status: 'failed',
      detail: 'provider unavailable',
    })
  })
})
