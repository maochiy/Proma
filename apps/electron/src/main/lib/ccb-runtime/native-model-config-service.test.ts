import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getCcbNativeModelConfiguration,
  getCcbNativeModelSecret,
  updateCcbNativeModelConfiguration,
  updateCcbNativeModelConfigurationFromChannel,
} from './native-model-config-service'

const temporaryDirectories: string[] = []

function createConfigDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'proma-ccb-model-config-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('CCB 原生模型配置', () => {
  test('Given 现有 CCB 配置 When 读取 Then 返回模型但不返回密钥明文', () => {
    const directory = createConfigDirectory()
    writeFileSync(
      join(directory, 'settings.json'),
      JSON.stringify({
        modelType: 'openai',
        model: 'gpt-test',
        models: [
          {
            id: 'gpt-test',
            name: 'GPT Test',
            contextWindow: 200000,
            effortLevels: ['low', 'high', 'max'],
          },
        ],
        env: {
          OPENAI_API_KEY: 'secret-value',
          OPENAI_BASE_URL: 'https://example.com/v1',
          KEEP_ME: 'yes',
        },
      }),
    )

    expect(getCcbNativeModelConfiguration(directory)).toEqual({
      modelType: 'openai',
      defaultModel: 'gpt-test',
      baseUrl: 'https://example.com/v1',
      hasApiKey: true,
      models: [
        {
          id: 'gpt-test',
          name: 'GPT Test',
          contextWindow: 200000,
          effortLevels: ['low', 'high', 'max'],
        },
      ],
    })
    expect(getCcbNativeModelSecret(directory)).toBe('secret-value')
  })

  test('Given Plugins 与旧 Provider 环境变量 When 切换 Provider Then 保留无关配置并清理旧凭证', () => {
    const directory = createConfigDirectory()
    writeFileSync(
      join(directory, 'settings.json'),
      JSON.stringify({
        modelType: 'openai',
        model: 'old-model',
        models: [{ id: 'old-model' }],
        enabledPlugins: { demo: true },
        hooks: { PreToolUse: [] },
        env: {
          OPENAI_API_KEY: 'old-secret',
          OPENAI_BASE_URL: 'https://old.example.com',
          OPENAI_MODEL: 'legacy-model',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
      }),
    )

    const result = updateCcbNativeModelConfiguration(
      {
        modelType: 'gemini',
        defaultModel: 'gemini-test',
        baseUrl: 'https://gemini.example.com/',
        apiKey: 'new-secret',
        models: [
          {
            id: 'gemini-test',
            description: 'Gemini Test',
            effortLevels: [],
          },
        ],
      },
      directory,
    )

    expect(result).toEqual({
      modelType: 'gemini',
      defaultModel: 'gemini-test',
      baseUrl: 'https://gemini.example.com',
      hasApiKey: true,
      models: [
        {
          id: 'gemini-test',
          description: 'Gemini Test',
          effortLevels: [],
        },
      ],
    })

    const saved = JSON.parse(
      readFileSync(join(directory, 'settings.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(saved.enabledPlugins).toEqual({ demo: true })
    expect(saved.hooks).toEqual({ PreToolUse: [] })
    expect(saved.env).toEqual({
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      GEMINI_BASE_URL: 'https://gemini.example.com',
      GEMINI_API_KEY: 'new-secret',
    })
  })

  test('Given 无效模型目录 When 保存 Then 拒绝重复模型与不存在的默认模型', () => {
    const directory = createConfigDirectory()

    expect(() =>
      updateCcbNativeModelConfiguration(
        {
          modelType: 'anthropic',
          defaultModel: 'claude-test',
          models: [{ id: 'claude-test' }, { id: 'claude-test' }],
        },
        directory,
      ),
    ).toThrow('模型 ID 重复')

    expect(() =>
      updateCcbNativeModelConfiguration(
        {
          modelType: 'anthropic',
          defaultModel: 'missing',
          models: [{ id: 'claude-test' }],
        },
        directory,
      ),
    ).toThrow('默认模型必须存在于模型列表中')
  })

  test('Given Proma 当前启用配置 When 启用或编辑 Then 立即同步启用模型到 CCB', () => {
    const directory = createConfigDirectory()
    const result = updateCcbNativeModelConfigurationFromChannel(
      {
        id: 'channel-1',
        name: 'OpenAI',
        provider: 'openai',
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'encrypted',
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        models: [
          {
            id: 'model-old',
            name: 'Old',
            enabled: false,
          },
          {
            id: 'model-fast',
            name: 'Fast',
            enabled: true,
            contextWindow: 200_000,
          },
          {
            id: 'model-deep',
            name: 'Deep',
            description: '深度推理',
            enabled: true,
            thinkingEffortLevels: ['low', 'high', 'xhigh'],
          },
        ],
      },
      'current-secret',
      'model-deep',
      directory,
    )

    expect(result.defaultModel).toBe('model-deep')
    expect(result.models.map(model => model.id)).toEqual([
      'model-fast',
      'model-deep',
    ])
    expect(getCcbNativeModelSecret(directory)).toBe('current-secret')
  })

  test('Given Proma 配置有显式默认模型 When 同步且没有会话覆盖 Then CCB 使用该默认模型', () => {
    const directory = createConfigDirectory()
    const result = updateCcbNativeModelConfigurationFromChannel(
      {
        id: 'channel-default',
        name: 'Anthropic',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'encrypted',
        enabled: true,
        defaultModelId: 'model-deep',
        createdAt: 1,
        updatedAt: 2,
        models: [
          { id: 'model-fast', name: 'Fast', enabled: true },
          { id: 'model-deep', name: 'Deep', enabled: true },
        ],
      },
      'current-secret',
      undefined,
      directory,
    )

    expect(result.defaultModel).toBe('model-deep')
  })

  test('Given ChatGPT 订阅配置 When 同步 Then 不把 OAuth JSON 写成 OPENAI_API_KEY', () => {
    const directory = createConfigDirectory()
    writeFileSync(
      join(directory, 'settings.json'),
      JSON.stringify({
        modelType: 'openai',
        model: 'old-model',
        models: [{ id: 'old-model' }],
        env: {
          OPENAI_API_KEY: 'old-secret',
          KEEP_ME: 'yes',
        },
      }),
    )

    const result = updateCcbNativeModelConfigurationFromChannel(
      {
        id: 'codex-channel',
        name: 'ChatGPT 订阅',
        provider: 'openai-codex',
        baseUrl: '',
        apiKey: 'encrypted-oauth-json',
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        models: [
          {
            id: 'gpt-codex',
            name: 'GPT Codex',
            enabled: true,
          },
        ],
      },
      '{"access":"oauth-access-token"}',
      'gpt-codex',
      directory,
    )

    expect(result.defaultModel).toBe('gpt-codex')
    expect(result.hasApiKey).toBe(false)
    expect(getCcbNativeModelSecret(directory)).toBe('')
    const saved = JSON.parse(
      readFileSync(join(directory, 'settings.json'), 'utf-8'),
    ) as { env?: Record<string, string> }
    expect(saved.env).toEqual({ KEEP_ME: 'yes' })
  })
})
