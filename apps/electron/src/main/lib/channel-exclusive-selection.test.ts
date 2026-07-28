import { describe, expect, test } from 'bun:test'
import type { Channel } from '@proma/shared'
import { applyExclusiveChannelSelection } from './channel-exclusive-selection'

function createChannel(id: string, enabled: boolean): Channel {
  return {
    id,
    name: id,
    provider: 'openai',
    baseUrl: 'https://example.com/v1',
    apiKey: '',
    models: [],
    enabled,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('模型配置互斥启用', () => {
  test('Given 多个已启用配置 When 选择一个 Then 仅保留该配置启用', () => {
    const channels = [
      createChannel('first', true),
      createChannel('second', true),
      createChannel('third', false),
    ]

    const result = applyExclusiveChannelSelection(channels, 'second', 10)

    expect(result.map(channel => ({
      id: channel.id,
      enabled: channel.enabled,
    }))).toEqual([
      { id: 'first', enabled: false },
      { id: 'second', enabled: true },
      { id: 'third', enabled: false },
    ])
    expect(result[0]?.updatedAt).toBe(10)
    expect(result[1]).toBe(channels[1])
  })
})
