import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type {
  AgentRuntimeModelCatalog,
  AgentRuntimeModelCatalogDraftInput,
  AgentRuntimeProviderConfiguration,
  Channel,
  CodexOAuthCredentials,
} from '@proma/shared'
import { parseCodexCredentials } from '@proma/shared'
import { getPromaUserAgent, normalizeAnthropicBaseUrlForSdk } from '@proma/core'
import pkg from '../../../../package.json' with { type: 'json' }
import {
  decryptApiKey,
  getChannelById,
  resolveCodexOAuthCredentials,
} from '../channel-manager'
import { getConfigDir } from '../config-paths'
import { getEffectiveProxyUrl } from '../proxy-settings-service'
import { ccbDesktopRuntimeClient } from './runtime-client'
import {
  buildCcbProviderConfiguration,
  buildCcbProviderEnvironment,
} from './provider-environment'
import { assertCcbRuntimeModelCatalog } from './protocol-validation'
import type { CcbRuntimeModelCatalog } from './protocol'
import { sanitizeCcbSessionEnvironment } from './runtime-security'

interface CachedModelCatalog {
  fingerprint: string
  promise: Promise<AgentRuntimeModelCatalog>
}

interface ModelCatalogRequestContext {
  channel: Channel
  environment: Record<string, string>
  providerConfiguration: AgentRuntimeProviderConfiguration
  fingerprint: string
}

const catalogCache = new Map<string, CachedModelCatalog>()
let draftCatalogCache: CachedModelCatalog | undefined
const DEFAULT_ANTHROPIC_URL = 'https://api.anthropic.com'

function normalizeCatalogBaseUrl(channel: Channel): string | undefined {
  if (!channel.baseUrl) return undefined
  if (
    channel.provider === 'google'
    || [
      'openai',
      'openai-responses',
      'opencode-go-openai',
      'zhipu',
      'doubao',
      'qwen',
      'custom',
      'openai-codex',
    ].includes(channel.provider)
  ) {
    return channel.baseUrl
  }
  return channel.baseUrl === DEFAULT_ANTHROPIC_URL
    ? undefined
    : normalizeAnthropicBaseUrlForSdk(channel.baseUrl)
}

function hashCatalogConfiguration(
  channel: Channel,
  environment: Record<string, string>,
  defaultModel?: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      channelId: channel.id,
      updatedAt: channel.updatedAt,
      provider: channel.provider,
      baseUrl: channel.baseUrl,
      defaultModel,
      models: channel.models,
      environment,
    }))
    .digest('hex')
}

async function resolveCredentials(
  channel: Channel,
): Promise<{ apiKey: string; codexCredentials?: CodexOAuthCredentials }> {
  if (channel.provider === 'openai-codex') {
    const codexCredentials = await resolveCodexOAuthCredentials(channel.id)
    return {
      apiKey: codexCredentials.access,
      codexCredentials,
    }
  }
  return { apiKey: decryptApiKey(channel.id) }
}

async function buildModelCatalogRequestContext(
  channel: Channel,
  defaultModel?: string,
  options: {
    credentials?: { apiKey: string; codexCredentials?: CodexOAuthCredentials }
    includeDisabledModels?: boolean
  } = {},
): Promise<ModelCatalogRequestContext> {
  const { apiKey, codexCredentials } =
    options.credentials ?? await resolveCredentials(channel)
  const proxyUrl = await getEffectiveProxyUrl()
  const providerEnvironment = buildCcbProviderEnvironment({
    provider: channel.provider,
    apiKey,
    baseUrl: normalizeCatalogBaseUrl(channel),
    modelId: defaultModel,
    userAgent: getPromaUserAgent(pkg.version),
    codexCredentials,
  })
  const environment = sanitizeCcbSessionEnvironment({
    ...providerEnvironment,
    ...(proxyUrl
      ? {
          HTTP_PROXY: proxyUrl,
          HTTPS_PROXY: proxyUrl,
          http_proxy: proxyUrl,
          https_proxy: proxyUrl,
        }
      : {}),
  })
  const providerConfiguration = buildCcbProviderConfiguration(
    channel,
    defaultModel,
    { includeDisabledModels: options.includeDisabledModels },
  )
  return {
    channel,
    environment,
    providerConfiguration,
    fingerprint: hashCatalogConfiguration(
      channel,
      environment,
      defaultModel,
    ),
  }
}

async function loadAgentRuntimeModelCatalog(
  context: ModelCatalogRequestContext,
  requestSessionId: string,
  resultChannelId: string,
): Promise<AgentRuntimeModelCatalog> {
  const result = await ccbDesktopRuntimeClient.request<CcbRuntimeModelCatalog>(
    {
      type: 'session.resolveModelCatalog',
      environment: {
        variables: context.environment,
        configDir: join(getConfigDir(), 'runtime', 'ccb'),
      },
      providerConfiguration: context.providerConfiguration,
    },
    requestSessionId,
    30_000,
  )
  assertCcbRuntimeModelCatalog(result)
  const runtime = ccbDesktopRuntimeClient.getRuntimeInfo()
  return {
    channelId: resultChannelId,
    defaultModel: result.defaultModel,
    models: result.models,
    runtimeVersion: runtime?.runtimeVersion,
    runtimeArtifactCommit: runtime?.gitCommit,
  }
}

/**
 * 读取指定 Channel 由 CCB 内核解析后的模型目录。
 *
 * 缓存只保存在 Main 内存中；Channel 更新、凭证刷新或代理变化会产生新的 fingerprint。
 */
export async function resolveAgentRuntimeModelCatalog(
  channelId: string,
  defaultModel?: string,
): Promise<AgentRuntimeModelCatalog> {
  const channel = getChannelById(channelId)
  if (!channel || !channel.enabled) {
    throw new Error('Agent 渠道不存在或已禁用')
  }

  const context = await buildModelCatalogRequestContext(channel, defaultModel)
  const cached = catalogCache.get(channelId)
  if (cached?.fingerprint === context.fingerprint) return cached.promise

  const promise = loadAgentRuntimeModelCatalog(
    context,
    `__model-catalog__:${channel.id}`,
    channel.id,
  ).catch(
    error => {
      const current = catalogCache.get(channelId)
      if (current?.promise === promise) catalogCache.delete(channelId)
      throw error
    },
  )
  catalogCache.set(channelId, {
    fingerprint: context.fingerprint,
    promise,
  })
  return promise
}

/**
 * 读取尚未保存的 Channel 草稿在 CCB 中解析出的模型能力。
 *
 * 草稿会把启用和未启用模型一起交给 CCB，因此“已启用模型”和“可用模型”
 * 都能展示同一内核实际使用的 Context Window、Effort、Adaptive/Fast/Auto 能力。
 */
export async function resolveDraftAgentRuntimeModelCatalog(
  input: AgentRuntimeModelCatalogDraftInput,
): Promise<AgentRuntimeModelCatalog> {
  if (input.models.length === 0) {
    throw new Error('请先添加至少一个模型')
  }

  const codexCredentials =
    input.provider === 'openai-codex'
      ? parseCodexCredentials(input.apiKey)
      : undefined
  if (input.provider === 'openai-codex' && !codexCredentials) {
    throw new Error('ChatGPT 订阅渠道缺少完整 OAuth 凭据')
  }

  const channel: Channel = {
    id: '__draft__',
    name: '临时模型配置',
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiKey: '',
    models: input.models,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
  const context = await buildModelCatalogRequestContext(
    channel,
    input.defaultModel,
    {
      credentials: {
        apiKey: codexCredentials?.access ?? input.apiKey,
        ...(codexCredentials ? { codexCredentials } : {}),
      },
      includeDisabledModels: true,
    },
  )
  if (draftCatalogCache?.fingerprint === context.fingerprint) {
    return draftCatalogCache.promise
  }

  const promise = loadAgentRuntimeModelCatalog(
    context,
    '__model-catalog-draft__',
    '__draft__',
  ).catch(error => {
    if (draftCatalogCache?.promise === promise) draftCatalogCache = undefined
    throw error
  })
  draftCatalogCache = {
    fingerprint: context.fingerprint,
    promise,
  }
  return promise
}

export function clearAgentRuntimeModelCatalogCache(channelId?: string): void {
  if (channelId) {
    catalogCache.delete(channelId)
    return
  }
  catalogCache.clear()
  draftCatalogCache = undefined
}
