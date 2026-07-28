import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CcbNativeConfiguredModel,
  CcbNativeModelConfiguration,
  CcbNativeModelConfigurationUpdate,
  CcbNativeModelType,
  ThinkingEffortLevel,
} from '@proma/shared'
import { readJsonFileSafe, writeJsonFileAtomic } from '../safe-file'
import { getCcbUserConfigDir } from './user-config'

interface ProviderEnvironmentDefinition {
  secretKeys: readonly string[]
  defaultSecretKey: string
  baseUrlKey: string
  modelKey: string
}

type CcbSettingsRecord = Record<string, unknown>

const EFFORT_LEVELS: readonly ThinkingEffortLevel[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

const PROVIDER_ENVIRONMENT: Record<CcbNativeModelType, ProviderEnvironmentDefinition> = {
  anthropic: {
    secretKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
    defaultSecretKey: 'ANTHROPIC_API_KEY',
    baseUrlKey: 'ANTHROPIC_BASE_URL',
    modelKey: 'ANTHROPIC_MODEL',
  },
  openai: {
    secretKeys: ['OPENAI_API_KEY'],
    defaultSecretKey: 'OPENAI_API_KEY',
    baseUrlKey: 'OPENAI_BASE_URL',
    modelKey: 'OPENAI_MODEL',
  },
  gemini: {
    secretKeys: ['GEMINI_API_KEY'],
    defaultSecretKey: 'GEMINI_API_KEY',
    baseUrlKey: 'GEMINI_BASE_URL',
    modelKey: 'GEMINI_MODEL',
  },
  grok: {
    secretKeys: ['GROK_API_KEY', 'XAI_API_KEY'],
    defaultSecretKey: 'GROK_API_KEY',
    baseUrlKey: 'GROK_BASE_URL',
    modelKey: 'GROK_MODEL',
  },
}

const ALL_PROVIDER_ENVIRONMENT_KEYS = new Set(
  Object.values(PROVIDER_ENVIRONMENT).flatMap(definition => [
    ...definition.secretKeys,
    definition.baseUrlKey,
    definition.modelKey,
  ]),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveSettingsPath(configDir = getCcbUserConfigDir()): string {
  return join(configDir, 'settings.json')
}

function readSettings(configDir?: string): CcbSettingsRecord {
  return readJsonFileSafe<CcbSettingsRecord>(resolveSettingsPath(configDir)) ?? {}
}

function readEnvironment(settings: CcbSettingsRecord): Record<string, string> {
  if (!isRecord(settings.env)) return {}
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(settings.env)) {
    if (typeof value === 'string') environment[key] = value
    else if (typeof value === 'number' || typeof value === 'boolean') {
      environment[key] = String(value)
    }
  }
  return environment
}

function resolveModelType(value: unknown): CcbNativeModelType {
  return value === 'openai' || value === 'gemini' || value === 'grok'
    ? value
    : 'anthropic'
}

function parseEffortLevels(value: unknown): ThinkingEffortLevel[] | undefined {
  if (!Array.isArray(value)) return undefined
  const levels = value.filter(
    (level): level is ThinkingEffortLevel =>
      typeof level === 'string'
      && EFFORT_LEVELS.includes(level as ThinkingEffortLevel),
  )
  return [...new Set(levels)]
}

function parseConfiguredModel(value: unknown): CcbNativeConfiguredModel | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    return undefined
  }
  const contextWindow =
    typeof value.contextWindow === 'number'
    && Number.isInteger(value.contextWindow)
    && value.contextWindow > 0
      ? value.contextWindow
      : undefined
  const effortLevels = parseEffortLevels(value.effortLevels)
  return {
    id: value.id.trim(),
    ...(typeof value.name === 'string' && value.name.trim()
      ? { name: value.name.trim() }
      : {}),
    ...(typeof value.description === 'string' && value.description.trim()
      ? { description: value.description.trim() }
      : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(effortLevels !== undefined ? { effortLevels } : {}),
  }
}

function readConfiguredModels(settings: CcbSettingsRecord): CcbNativeConfiguredModel[] {
  if (!Array.isArray(settings.models)) return []
  return settings.models
    .map(parseConfiguredModel)
    .filter((model): model is CcbNativeConfiguredModel => model !== undefined)
}

function findSecretEnvironmentKey(
  modelType: CcbNativeModelType,
  environment: Record<string, string>,
): string | undefined {
  return PROVIDER_ENVIRONMENT[modelType].secretKeys.find(
    key => Boolean(environment[key]),
  )
}

function validateBaseUrl(baseUrl: string | undefined): string | undefined {
  const normalized = baseUrl?.trim()
  if (!normalized) return undefined
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('Base URL 格式无效')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL 仅支持 HTTP 或 HTTPS')
  }
  return normalized.replace(/\/+$/, '')
}

function normalizeConfiguredModels(
  models: CcbNativeConfiguredModel[],
): CcbNativeConfiguredModel[] {
  if (models.length === 0) throw new Error('请至少配置一个模型')

  const ids = new Set<string>()
  return models.map((model, index) => {
    const id = model.id.trim()
    if (!id) throw new Error(`第 ${index + 1} 个模型缺少模型 ID`)
    if (ids.has(id)) throw new Error(`模型 ID 重复: ${id}`)
    ids.add(id)

    const contextWindow = model.contextWindow
    if (
      contextWindow !== undefined
      && (!Number.isInteger(contextWindow) || contextWindow <= 0)
    ) {
      throw new Error(`模型 ${id} 的 Context Window 必须是正整数`)
    }
    const invalidEffort = model.effortLevels?.find(
      level => !EFFORT_LEVELS.includes(level),
    )
    if (invalidEffort) {
      throw new Error(`模型 ${id} 的思考等级无效: ${invalidEffort}`)
    }

    return {
      id,
      ...(model.name?.trim() ? { name: model.name.trim() } : {}),
      ...(model.description?.trim()
        ? { description: model.description.trim() }
        : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(model.effortLevels !== undefined
        ? { effortLevels: [...new Set(model.effortLevels)] }
        : {}),
    }
  })
}

/**
 * 读取 CCB CLI 与 Desktop 共用的全局模型配置。
 *
 * 常规读取只返回 hasApiKey，密钥明文必须通过显式接口单独获取。
 */
export function getCcbNativeModelConfiguration(
  configDir?: string,
): CcbNativeModelConfiguration {
  const settings = readSettings(configDir)
  const modelType = resolveModelType(settings.modelType)
  const environment = readEnvironment(settings)
  const definition = PROVIDER_ENVIRONMENT[modelType]
  const defaultModel =
    typeof settings.model === 'string' && settings.model.trim()
      ? settings.model.trim()
      : undefined
  return {
    modelType,
    ...(defaultModel ? { defaultModel } : {}),
    ...(environment[definition.baseUrlKey]
      ? { baseUrl: environment[definition.baseUrlKey] }
      : {}),
    hasApiKey: Boolean(findSecretEnvironmentKey(modelType, environment)),
    models: readConfiguredModels(settings),
  }
}

/** 用户进入 CCB 配置编辑页后，显式读取当前 Provider 的密钥。 */
export function getCcbNativeModelSecret(configDir?: string): string {
  const settings = readSettings(configDir)
  const modelType = resolveModelType(settings.modelType)
  const environment = readEnvironment(settings)
  const key = findSecretEnvironmentKey(modelType, environment)
  return key ? environment[key] ?? '' : ''
}

/**
 * 原子更新 CCB 全局 Provider 与模型目录，并保留 Plugins、Hooks、权限等无关配置。
 */
export function updateCcbNativeModelConfiguration(
  input: CcbNativeModelConfigurationUpdate,
  configDir = getCcbUserConfigDir(),
): CcbNativeModelConfiguration {
  const settings = readSettings(configDir)
  const previousModelType = resolveModelType(settings.modelType)
  const previousEnvironment = readEnvironment(settings)
  const previousSecretKey = findSecretEnvironmentKey(
    previousModelType,
    previousEnvironment,
  )
  const models = normalizeConfiguredModels(input.models)
  const defaultModel = input.defaultModel?.trim() || models[0]?.id
  if (!defaultModel || !models.some(model => model.id === defaultModel)) {
    throw new Error('默认模型必须存在于模型列表中')
  }
  const baseUrl = validateBaseUrl(input.baseUrl)

  const nextEnvironment: Record<string, string> = {}
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (!ALL_PROVIDER_ENVIRONMENT_KEYS.has(key)) {
      nextEnvironment[key] = value
    }
  }

  const definition = PROVIDER_ENVIRONMENT[input.modelType]
  if (baseUrl) nextEnvironment[definition.baseUrlKey] = baseUrl

  if (input.apiKey !== undefined) {
    const secret = input.apiKey.trim()
    if (secret) {
      const secretKey =
        previousModelType === input.modelType && previousSecretKey
          ? previousSecretKey
          : definition.defaultSecretKey
      nextEnvironment[secretKey] = secret
    }
  } else if (previousModelType === input.modelType && previousSecretKey) {
    const existingSecret = previousEnvironment[previousSecretKey]
    if (existingSecret) nextEnvironment[previousSecretKey] = existingSecret
  }

  const nextSettings: CcbSettingsRecord = {
    ...settings,
    modelType: input.modelType,
    model: defaultModel,
    models,
    env: nextEnvironment,
  }
  mkdirSync(configDir, { recursive: true })
  writeJsonFileAtomic(resolveSettingsPath(configDir), nextSettings)
  console.log(
    `[CCB 模型配置] 已更新: provider=${input.modelType}, models=${models.length}`,
  )
  return getCcbNativeModelConfiguration(configDir)
}
