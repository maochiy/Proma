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

describe('模型配置至少保留一个启用模型', () => {
  test('Given 只剩一个启用模型 When 尝试停用或删除 Then 应阻止操作并由界面提示', () => {
    expect(isLastEnabledChannelModel([
      model('claude-opus', true),
      model('claude-sonnet', false),
    ], 'claude-opus')).toBe(true)
  })

  test('Given 存在多个启用模型 When 停用其中一个 Then 允许操作', () => {
    expect(isLastEnabledChannelModel([
      model('claude-opus', true),
      model('claude-sonnet', true),
    ], 'claude-opus')).toBe(false)
  })
})

describe('Proma 至少保留一个启用的模型配置', () => {
  test('Given 只有一个启用配置 When 尝试禁用 Then 应阻止操作并提示用户', () => {
    expect(isLastEnabledChannelConfiguration([
      channel('primary', true),
      channel('backup', false),
    ], 'primary')).toBe(true)
  })

  test('Given 存在另一个启用配置 When 禁用当前配置 Then 允许操作', () => {
    expect(isLastEnabledChannelConfiguration([
      channel('primary', true),
      channel('backup', true),
    ], 'primary')).toBe(false)
  })
})
