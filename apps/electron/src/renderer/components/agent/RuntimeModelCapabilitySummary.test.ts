import { describe, expect, test } from 'bun:test'
import type { AgentRuntimeModelInfo } from '@proma/shared'
import {
  buildRuntimeCapabilityLabels,
  formatRuntimeContextWindow,
} from './RuntimeModelCapabilitySummary'

function runtimeModel(
  overrides: Partial<AgentRuntimeModelInfo> = {},
): AgentRuntimeModelInfo {
  return {
    value: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    description: 'CCB Runtime model',
    contextWindow: 1_000_000,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'],
    defaultEffortLevel: 'high',
    supportsAdaptiveThinking: true,
    supportsFastMode: true,
    supportsAutoMode: false,
    ...overrides,
  }
}

describe('CCB 模型能力展示', () => {
  test('Given CCB 返回 1M Context Window When 格式化 Then 显示紧凑单位', () => {
    expect(formatRuntimeContextWindow(1_000_000)).toBe('1M')
    expect(formatRuntimeContextWindow(200_000)).toBe('200K')
  })

  test('Given CCB 返回完整能力 When 构建标签 Then 不遗漏思考与运行模式', () => {
    expect(buildRuntimeCapabilityLabels(runtimeModel())).toEqual([
      '1M 上下文',
      '思考 轻度/标准/高级/深度',
      'Adaptive',
      'Fast',
    ])
  })

  test('Given CCB 未声明思考能力 When 构建标签 Then 不根据模型名猜测', () => {
    expect(buildRuntimeCapabilityLabels(runtimeModel({
      value: 'future-reasoner',
      supportsEffort: false,
      supportedEffortLevels: [],
      supportsAdaptiveThinking: false,
      supportsFastMode: false,
      supportsAutoMode: true,
    }))).toEqual([
      '1M 上下文',
      'Auto',
    ])
  })
})
