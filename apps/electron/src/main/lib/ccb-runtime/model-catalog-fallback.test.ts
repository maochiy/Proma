import { describe, expect, test } from 'bun:test'
import type { AgentRuntimeProviderConfiguration } from '@proma/shared'
import {
  buildFallbackModelCatalog,
  getModelCatalogWatchdogMs,
  isFallbackModelCatalog,
  resolveFallbackModel,
} from './model-catalog-fallback'

const configuration: AgentRuntimeProviderConfiguration = {
  modelType: 'anthropic',
  defaultModel: 'claude-sonnet-4-6',
  models: [
    {
      id: 'claude-sonnet-4-6',
      name: 'Sonnet 4.6',
      effortLevels: ['low', 'high'],
    },
    {
      id: 'custom-model',
      contextWindow: 128_000,
    },
  ],
}

describe('CCB 模型目录兜底', () => {
  test('Given Runtime 目录未返回 When 构建兜底目录 Then 使用本地配置且能力保持保守', () => {
    const catalog = buildFallbackModelCatalog('channel-1', configuration)

    expect(catalog.defaultModel).toBe('claude-sonnet-4-6')
    expect(catalog.models[0]).toMatchObject({
      value: 'claude-sonnet-4-6',
      displayName: 'Sonnet 4.6',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high'],
      supportsAdaptiveThinking: false,
      supportsFastMode: false,
      supportsAutoMode: false,
    })
    expect(catalog.contextPolicy.autoCompactEnabled).toBe(false)
    expect(isFallbackModelCatalog(catalog)).toBe(true)
  })

  test('Given 请求模型带 1m 后缀 When 本地兜底解析 Then 能匹配原始模型并推断窗口', () => {
    expect(resolveFallbackModel(configuration, 'claude-sonnet-4-6[1m]'))
      .toEqual({
        value: 'claude-sonnet-4-6',
        contextWindow: 1_000_000,
      })
  })

  test('Given watchdog 环境配置异常或过大 When 读取 Then 使用默认值或安全上限', () => {
    expect(getModelCatalogWatchdogMs({})).toBe(90_000)
    expect(getModelCatalogWatchdogMs({
      PROMA_CCB_MODEL_CATALOG_WATCHDOG_MS: '9999999',
    })).toBe(300_000)
  })
})
