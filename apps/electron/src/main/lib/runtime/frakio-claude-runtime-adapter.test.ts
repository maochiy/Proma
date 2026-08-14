import { describe, expect, test } from 'bun:test'
import { claudeCompactionSettings } from './frakio-claude-runtime-adapter'

describe('Proma Claude Code 压缩配置投影', () => {
  test('Given 模型配置了压缩阈值 When 投影 Claude settings Then 注入 autoCompactWindow 为触发阈值', () => {
    const settings = claudeCompactionSettings({
      enabled: true,
      threshold: 160_000,
      contextWindow: 200_000,
    })
    expect(settings).toEqual({
      autoCompactEnabled: true,
      autoCompactWindow: 160_000,
    })
  })

  test('Given 模型未配置阈值 When 投影 Claude settings Then 回退到完整窗口并保留开关', () => {
    const settings = claudeCompactionSettings({ enabled: true, contextWindow: 200_000 })
    expect(settings).toEqual({
      autoCompactEnabled: true,
      autoCompactWindow: 200_000,
    })
  })

  test('Given 关闭自动压缩 When 投影 Claude settings Then 只关闭开关不设窗口', () => {
    const settings = claudeCompactionSettings({ enabled: false })
    expect(settings).toEqual({ autoCompactEnabled: false })
  })
})
