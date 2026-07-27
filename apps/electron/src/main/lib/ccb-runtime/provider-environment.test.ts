import { describe, expect, test } from 'bun:test'
import {
  buildCcbProviderConfiguration,
  buildCcbProviderEnvironment,
  resolveCcbModelType,
} from './provider-environment'

describe('CCB Provider 环境映射', () => {
  test('Given Anthropic Bearer 渠道 When 构建环境 Then 使用 Anthropic 认证变量', () => {
    const env = buildCcbProviderEnvironment({
      provider: 'kimi-coding',
      apiKey: 'kimi-token',
      baseUrl: 'https://api.kimi.com/coding/v1',
      modelId: 'kimi-k2',
      userAgent: 'Proma/test',
    })

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('kimi-token')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.kimi.com/coding/v1')
    expect(env.ANTHROPIC_MODEL).toBe('kimi-k2')
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })

  test('Given OpenAI 完整 endpoint When 构建环境 Then 规范化为 SDK base URL', () => {
    const env = buildCcbProviderEnvironment({
      provider: 'custom',
      apiKey: 'openai-token',
      baseUrl: 'https://gateway.example.com/v1/chat/completions',
      modelId: 'model-a',
      userAgent: 'Proma/test',
    })

    expect(env.OPENAI_API_KEY).toBe('openai-token')
    expect(env.OPENAI_BASE_URL).toBe('https://gateway.example.com/v1')
    expect(env.OPENAI_MODEL).toBe('model-a')
    expect(env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  })

  test('Given Gemini 渠道 When Base URL 无 API 版本 Then 自动补 v1beta', () => {
    const env = buildCcbProviderEnvironment({
      provider: 'google',
      apiKey: 'gemini-token',
      baseUrl: 'https://generativelanguage.googleapis.com',
      modelId: 'gemini-2.5-pro',
      userAgent: 'Proma/test',
    })

    expect(env.CLAUDE_CODE_USE_GEMINI).toBe('1')
    expect(env.GEMINI_BASE_URL).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(env.GEMINI_MODEL).toBe('gemini-2.5-pro')
  })

  test('Given ChatGPT OAuth 渠道 When 构建环境 Then 注入完整凭据而非 API Key', () => {
    const env = buildCcbProviderEnvironment({
      provider: 'openai-codex',
      apiKey: 'unused-access',
      modelId: 'gpt-5.3-codex',
      userAgent: 'Proma/test',
      codexCredentials: {
        access: 'access-token',
        refresh: 'refresh-token',
        expires: 123456,
        accountId: 'account-1',
      },
    })

    expect(env.OPENAI_AUTH_MODE).toBe('chatgpt')
    expect(env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(env.OPENAI_CHATGPT_ACCESS_TOKEN).toBe('access-token')
    expect(env.OPENAI_CHATGPT_REFRESH_TOKEN).toBe('refresh-token')
    expect(env.OPENAI_CHATGPT_EXPIRES_AT).toBe('123456')
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })

  test('Given Proma Channel When 构建 Provider 配置 Then 只传启用模型并由 CCB 解析能力', () => {
    const configuration = buildCcbProviderConfiguration({
      id: 'channel-1',
      name: 'OpenAI Gateway',
      provider: 'custom',
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'encrypted',
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
      models: [
        {
          id: 'reasoner-a',
          name: 'Reasoner A',
          enabled: true,
          thinkingEffortLevels: ['low', 'high'],
        },
        {
          id: 'disabled-model',
          name: 'Disabled',
          enabled: false,
        },
      ],
    }, 'reasoner-a')

    expect(configuration).toEqual({
      modelType: 'openai',
      defaultModel: 'reasoner-a',
      models: [
        {
          id: 'reasoner-a',
          name: 'Reasoner A',
          effortLevels: ['low', 'high'],
        },
      ],
    })
  })

  test('Given Provider 类型 When 映射 CCB modelType Then 使用 CCB 原生 Provider 分类', () => {
    expect(resolveCcbModelType('google')).toBe('gemini')
    expect(resolveCcbModelType('openai-codex')).toBe('openai')
    expect(resolveCcbModelType('deepseek')).toBe('anthropic')
  })
})
