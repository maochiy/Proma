import { describe, expect, test } from 'bun:test'
import { getModelLogoById, getProviderLogo } from './model-logo'

describe('模型 Logo 匹配', () => {
  test.each([
    'gpt-image-1',
    'gpt-3.5-turbo',
    'gpt-4o',
    'chatgpt-4o-latest',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5.1-codex-mini',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-future-preview',
  ])('Given GPT 模型 %s When 解析 Logo Then 统一显示 OpenAI 品牌图标', (modelId) => {
    expect(getModelLogoById(modelId)).toBe(getProviderLogo('openai'))
  })
})
