import { describe, expect, test } from 'bun:test'
import { resolveAgentSessionModelBinding } from './agent-model-configuration'

describe('CCB 唯一模型配置会话同步', () => {
  test('Given 原模型仍可用 When 启用新配置 Then 保留同名模型并切换渠道', () => {
    expect(resolveAgentSessionModelBinding(
      { channelId: 'old-channel', modelId: 'claude-sonnet' },
      'new-channel',
      ['claude-opus', 'claude-sonnet'],
      'claude-opus',
    )).toEqual({
      channelId: 'new-channel',
      modelId: 'claude-sonnet',
    })
  })

  test('Given 原模型已删除 When 编辑启用配置 Then 回退到配置默认模型', () => {
    expect(resolveAgentSessionModelBinding(
      { channelId: 'channel', modelId: 'removed-model' },
      'channel',
      ['claude-opus', 'claude-sonnet'],
      'claude-sonnet',
    )).toEqual({
      channelId: 'channel',
      modelId: 'claude-sonnet',
    })
  })

  test('Given CCB 使用原生默认模型 When 未配置模型清单 Then 清除旧模型绑定', () => {
    expect(resolveAgentSessionModelBinding(
      { channelId: 'proma-channel', modelId: 'old-model' },
      '__ccb_native__',
      [],
    )).toEqual({
      channelId: '__ccb_native__',
    })
  })
})
