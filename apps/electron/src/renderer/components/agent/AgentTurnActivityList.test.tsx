import { describe, expect, test } from 'bun:test'
import type { SDKThinkingBlock } from '@proma/shared'
import { getAgentActivityItemKey } from './AgentTurnActivityList'

describe('getAgentActivityItemKey', () => {
  test('Given thinking 活动 When running 从 true 变 false Then key 保持稳定不 remount', () => {
    const block = { type: 'thinking', thinking: '分析中' } as SDKThinkingBlock
    const runningKey = getAgentActivityItemKey({
      block,
      index: 2,
      foldable: true,
      running: true,
    })
    const stoppedKey = getAgentActivityItemKey({
      block,
      index: 2,
      foldable: true,
      running: false,
    })
    expect(runningKey).toBe(stoppedKey)
    expect(runningKey).toBe('thinking:2')
  })

  test('Given 合成 thinking 占位 When 取 key Then 固定为 thinking:surface', () => {
    const block = { type: 'thinking', thinking: '' } as SDKThinkingBlock
    expect(getAgentActivityItemKey({
      block,
      index: -1,
      foldable: true,
      running: true,
    })).toBe('thinking:surface')
  })
})
