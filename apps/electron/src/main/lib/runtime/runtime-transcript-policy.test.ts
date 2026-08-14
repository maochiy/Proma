import { describe, expect, test } from 'bun:test'
import { shouldSyncLegacyCcbTranscript } from './runtime-transcript-policy'

describe('Runtime Transcript 投影策略', () => {
  test('Given 当前 Proma Runtime 会话 When 回合结束 Then 不请求旧 CCB Transcript', () => {
    for (const runtimeId of ['pi', 'hermes', 'codex', 'claude'] as const) {
      expect(shouldSyncLegacyCcbTranscript(runtimeId)).toBe(false)
    }
  })

  test('Given 没有 runtimeId 的历史会话 When 回合结束 Then 保留旧 CCB 兼容同步', () => {
    expect(shouldSyncLegacyCcbTranscript(undefined)).toBe(true)
  })
})
