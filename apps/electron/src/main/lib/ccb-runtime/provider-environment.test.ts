import { describe, expect, test } from 'bun:test'
import {
  buildCcbNativeProviderConfiguration,
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
          description: '适合复杂编码任务',
          contextWindow: 262144,
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
          description: '适合复杂编码任务',
          contextWindow: 262144,
          effortLevels: ['low', 'high'],
        },
      ],
    })
  })

  test('Given CCB 原生模型不在 Proma Channel When 构建 fallback Then 保留 CCB 当前模型', () => {
    const configuration = buildCcbProviderConfiguration({
      id: 'channel-1',
      name: 'DeepSeek Fallback',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: '',
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
      models: [
        {
          id: 'deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          enabled: true,
        },
      ],
    }, 'gpt-5.6-sol')

    expect(configuration.defaultModel).toBe('gpt-5.6-sol')
    expect(configuration.models.map(model => model.id)).toEqual([
      'gpt-5.6-sol',
      'deepseek-v4-flash',
    ])
  })

  test('Given CCB 原生凭证已配置 When 构建 Proma fallback 环境 Then 不屏蔽 CCB settings provider 变量', () => {
    const environment = buildCcbProviderEnvironment({
      provider: 'deepseek',
      apiKey: '',
      baseUrl: 'https://api.deepseek.com/anthropic',
      modelId: 'gpt-5.6-sol',
      userAgent: 'Proma/test',
    })

    expect(environment.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBeUndefined()
  })

  test('Given CCB 原生配置 When 构建 Provider 配置 Then 不注入 Proma 模型或默认值', () => {
    expect(buildCcbNativeProviderConfiguration()).toEqual({
      modelType: 'anthropic',
      models: [],
    })
  })

  test('Given 模型配置草稿 When 请求 CCB 能力 Then 同时解析尚未启用的可用模型', () => {
    const configuration = buildCcbProviderConfiguration({
      id: '__draft__',
      name: '临时模型配置',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: '',
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      models: [
        {
          id: 'claude-opus-4-6',
          name: 'Claude Opus 4.6',
          enabled: true,
        },
        {
          id: 'claude-sonnet-4-6',
          name: 'Claude Sonnet 4.6',
          enabled: false,
        },
      ],
    }, 'claude-opus-4-6', { includeDisabledModels: true })

    expect(configuration.models.map(model => model.id)).toEqual([
      'claude-opus-4-6',
      'claude-sonnet-4-6',
    ])
  })

  test('Given Provider 类型 When 映射 CCB modelType Then 使用 CCB 原生 Provider 分类', () => {
    expect(resolveCcbModelType('google')).toBe('gemini')
    expect(resolveCcbModelType('openai-codex')).toBe('openai')
    expect(resolveCcbModelType('deepseek')).toBe('anthropic')
  })
})
