import { describe, expect, test } from 'bun:test'
import type { SDKSystemMessage } from '../types/agent'
import { isPersistableSDKSystemMessage } from './agent-system-message'

describe('SDK system 消息持久化', () => {
  test('Given CCB 上下文压缩配置 When 判断持久化 Then 会话重开后仍可恢复面板', () => {
    expect(isPersistableSDKSystemMessage({
      type: 'system',
      subtype: 'context_compaction_config',
      autoCompactEnabled: true,
      autoCompactThreshold: 167_000,
      effectiveContextWindow: 180_000,
    } as SDKSystemMessage)).toBe(true)
  })
})
