import { describe, expect, test } from 'bun:test'
import type { AgentRuntimeModelInfo } from '@proma/shared'
import {
  findAgentRuntimeModel,
  normalizeAgentThinkingEffortLevel,
  resolveAgentRuntimeThinkingSelection,
  resolveAgentThinkingEffortCapability,
} from './agent-thinking-effort'

function runtimeModel(
  overrides: Partial<AgentRuntimeModelInfo> = {},
): AgentRuntimeModelInfo {
  return {
    value: 'runtime-model',
    displayName: 'Runtime Model',
    description: 'CCB Runtime model',
    contextWindow: 200_000,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
    defaultEffortLevel: 'medium',
    supportsAdaptiveThinking: false,
    supportsFastMode: false,
    supportsAutoMode: false,
    ...overrides,
  }
}

describe('Agent 模型思考等级能力', () => {
  test('Given Runtime 声明支持 When 解析能力 Then 使用 Runtime 等级与默认值', () => {
    expect(resolveAgentThinkingEffortCapability(runtimeModel())).toEqual({
      levels: ['low', 'medium', 'high'],
      defaultLevel: 'medium',
    })
  })

  test('Given Runtime 声明不支持 When 解析能力 Then 隐藏控件', () => {
    expect(resolveAgentThinkingEffortCapability(runtimeModel({
      supportsEffort: false,
      supportedEffortLevels: [],
      defaultEffortLevel: undefined,
    }))).toBeNull()
  })

  test('Given Runtime 返回显式子集 When 解析能力 Then 顺序和值完全一致', () => {
    expect(resolveAgentThinkingEffortCapability(runtimeModel({
      supportedEffortLevels: ['high', 'max'],
      defaultEffortLevel: 'max',
    }))).toEqual({
      levels: ['high', 'max'],
      defaultLevel: 'max',
    })
  })

  test('Given Runtime 默认值有效 When 当前值缺失 Then 使用 Runtime 默认值', () => {
    const capability = resolveAgentThinkingEffortCapability(runtimeModel({
      supportedEffortLevels: ['low', 'high'],
      defaultEffortLevel: 'high',
    }))
    expect(normalizeAgentThinkingEffortLevel(capability, undefined)).toBe('high')
  })

  test('Given 未知模型由 Runtime 声明支持 When 解析能力 Then 不依赖模型名', () => {
    expect(resolveAgentThinkingEffortCapability(runtimeModel({
      value: 'future-private-reasoner',
      supportedEffortLevels: ['xhigh'],
      defaultEffortLevel: 'xhigh',
    }))).toEqual({
      levels: ['xhigh'],
      defaultLevel: 'xhigh',
    })
  })

  test('Given Runtime 目录不可用 When 解析能力 Then 不猜测并隐藏控件', () => {
    expect(resolveAgentThinkingEffortCapability(undefined)).toBeNull()
  })

  test('Given CCB 规范化 1M 模型 ID When 查找模型 Then 回退匹配规范化 ID', () => {
    const model = runtimeModel({
      value: 'claude-sonnet-4-6',
      contextWindow: 1_000_000,
    })

    expect(findAgentRuntimeModel([model], 'claude-sonnet-4-6[1m]')).toBe(model)
  })

  test('Given Runtime 不支持 Adaptive Thinking When 构建本轮配置 Then 不透传全局 Thinking', () => {
    const model = runtimeModel({
      supportsAdaptiveThinking: false,
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high'],
      defaultEffortLevel: 'high',
    })

    expect(resolveAgentRuntimeThinkingSelection(
      model,
      { type: 'adaptive' },
      'low',
    )).toEqual({
      thinkingConfig: undefined,
      effortLevel: 'low',
    })
  })

  test('Given Runtime 支持 Adaptive Thinking When 构建本轮配置 Then 透传 Thinking 与归一化 Effort', () => {
    const model = runtimeModel({
      supportsAdaptiveThinking: true,
      supportsEffort: true,
      supportedEffortLevels: ['medium', 'high'],
      defaultEffortLevel: 'medium',
    })

    expect(resolveAgentRuntimeThinkingSelection(
      model,
      { type: 'adaptive' },
      'max',
    )).toEqual({
      thinkingConfig: { type: 'adaptive' },
      effortLevel: 'medium',
    })
  })
})
