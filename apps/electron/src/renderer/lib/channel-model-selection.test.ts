import { describe, expect, test } from 'bun:test'
import type { Channel, ChannelModel } from '@proma/shared'
import {
  isLastEnabledChannelConfiguration,
  isLastEnabledChannelModel,
} from './channel-model-selection'

function model(id: string, enabled: boolean): ChannelModel {
  return {
    id,
    name: id,
    enabled,
  }
}

function channel(id: string, enabled: boolean): Channel {
  return {
    id,
    name: id,
    provider: 'anthropic',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    models: [model(`${id}-model`, true)],
    enabled,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('模型启用状态判定', () => {
  test('Given 只剩一个启用模型 When 判定是否为最后一个启用项 Then 返回 true', () => {
    expect(isLastEnabledChannelModel([
      model('claude-opus', true),
      model('claude-sonnet', false),
    ], 'claude-opus')).toBe(true)
  })

  test('Given 存在多个启用模型 When 判定其中一个 Then 不是最后一个启用项', () => {
    expect(isLastEnabledChannelModel([
      model('claude-opus', true),
      model('claude-sonnet', true),
    ], 'claude-opus')).toBe(false)
  })
})

describe('模型配置启用状态判定', () => {
  test('Given 只有一个启用配置 When 判定是否为最后一个启用配置 Then 返回 true', () => {
    expect(isLastEnabledChannelConfiguration([
      channel('primary', true),
      channel('backup', false),
    ], 'primary')).toBe(true)
  })

  test('Given 存在另一个启用配置 When 判定当前配置 Then 不是最后一个启用配置', () => {
    expect(isLastEnabledChannelConfiguration([
      channel('primary', true),
      channel('backup', true),
    ], 'primary')).toBe(false)
  })
})
