import { describe, expect, test } from 'bun:test'
import type { Channel, ChannelModel } from '@proma/shared'
import {
  resolveManagedChannelModelUpdate,
  resolveRestoredManagedChannelId,
} from './new-api-channel-provision'

function createChannel(models: ChannelModel[]): Channel {
  return {
    id: 'channel-1',
    name: 'OpenSwitch',
    provider: 'openai',
    baseUrl: 'https://example.com/v1',
    apiKey: 'encrypted',
    models,
    defaultModelId: models[0]?.id,
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('New API 登录模型配置持久化', () => {
  test('Given 同一 API Key 且用户已编辑模型 When 重启或重新登录 Then 不用远端目录覆盖本地配置', () => {
    const existing = createChannel([
      {
        id: 'grok-4.5',
        name: '我的 Grok',
        description: '用户自定义描述',
        contextWindow: 200_000,
        thinkingEffortLevels: ['low', 'high', 'max'],
        enabled: true,
      },
    ])

    expect(resolveManagedChannelModelUpdate(
      existing,
      [{ id: 'grok-4.5', name: 'grok-4.5', enabled: true, source: 'fetched' }],
      true,
    )).toBeUndefined()
  })

  test('Given 首次登录尚无本地模型 When 登录 Then 使用远端模型初始化', () => {
    const remoteModels: ChannelModel[] = [
      { id: 'model-a', name: 'Model A', enabled: true, source: 'fetched' },
      { id: 'model-b', name: 'Model B', enabled: true, source: 'fetched' },
    ]

    expect(resolveManagedChannelModelUpdate(
      undefined,
      remoteModels,
      false,
    )).toEqual({
      models: remoteModels,
      defaultModelId: 'model-a',
    })
  })

  test('Given 用户更换 API Key When 登录 Then 按新凭据重新初始化模型目录', () => {
    const existing = createChannel([
      { id: 'old-model', name: 'Old', enabled: true },
    ])

    expect(resolveManagedChannelModelUpdate(
      existing,
      [{ id: 'new-model', name: 'New', enabled: true, source: 'fetched' }],
      false,
    )).toEqual({
      models: [
        { id: 'new-model', name: 'New', enabled: true, source: 'fetched' },
      ],
      defaultModelId: 'new-model',
    })
  })

  test('Given 登录前存在启用配置 When 退出登录 Then 恢复原模型配置', () => {
    expect(resolveRestoredManagedChannelId(
      [{ id: 'original-channel' }, { id: 'managed-channel' }],
      'managed-channel',
      'original-channel',
      ['original-channel'],
    )).toBe('original-channel')
  })

  test('Given 首选配置已删除 When 退出登录 Then 从原配置列表恢复仍存在的配置', () => {
    expect(resolveRestoredManagedChannelId(
      [{ id: 'fallback-channel' }, { id: 'managed-channel' }],
      'managed-channel',
      'deleted-channel',
      ['managed-channel', 'fallback-channel'],
    )).toBe('fallback-channel')
  })
})
