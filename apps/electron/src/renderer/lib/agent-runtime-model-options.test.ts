import { describe, expect, test } from 'bun:test'
import type { AgentRuntimeModelCatalog, Channel, ChannelModel } from '@proma/shared'
import { CCB_NATIVE_CHANNEL_ID } from '@proma/shared'
import {
  buildAgentAppModelOptions,
  resolveAppAgentChannelId,
} from './agent-runtime-model-options'

function model(id: string, enabled: boolean, name = id): ChannelModel {
  return { id, name, enabled }
}

function channel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'openswitch',
    name: 'OpenSwitch',
    provider: 'openai',
    apiKey: '',
    baseUrl: 'https://example.com',
    models: [model('gpt-a', true), model('gpt-b', false), model('gpt-c', true)],
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function catalog(modelIds: string[]): AgentRuntimeModelCatalog {
  return {
    channelId: 'openswitch',
    models: modelIds.map(id => ({
      value: id,
      displayName: `${id}-runtime`,
      description: '',
      contextWindow: 200_000,
      supportsEffort: false,
      supportedEffortLevels: [],
      supportsAdaptiveThinking: false,
      supportsFastMode: false,
      supportsAutoMode: false,
    })),
    contextPolicy: {
      autoCompactEnabled: true,
      models: [],
    },
  }
}

describe('App 会话模型下拉', () => {
  test('Given 渠道未启用 When 构建下拉 Then 不展示任何模型', () => {
    const options = buildAgentAppModelOptions({
      channelId: 'openswitch',
      channels: [channel({ enabled: false })],
      catalog: catalog(['gpt-a', 'gpt-b', 'gpt-c', 'cli-only']),
    })
    expect(options).toEqual([])
  })

  test('Given 渠道已启用 When 构建下拉 Then 只展示渠道内已启用模型，忽略 CLI/未启用项', () => {
    const options = buildAgentAppModelOptions({
      channelId: 'openswitch',
      channels: [channel()],
      catalog: catalog(['gpt-a', 'gpt-b', 'gpt-c', 'cli-only']),
    })
    expect(options.map(item => item.modelId)).toEqual(['gpt-a', 'gpt-c'])
    expect(options.every(item => item.channelName === 'OpenSwitch')).toBe(true)
  })

  test('Given 当前渠道是 CLI 共用配置 When 构建下拉 Then 不参与 App 展示', () => {
    expect(resolveAppAgentChannelId(CCB_NATIVE_CHANNEL_ID)).toBeNull()
    expect(buildAgentAppModelOptions({
      channelId: CCB_NATIVE_CHANNEL_ID,
      channels: [channel()],
      catalog: catalog(['claude-sonnet-4-6']),
    })).toEqual([])
  })
})
