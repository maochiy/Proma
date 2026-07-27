import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type {
  AgentRuntimeModelCatalog,
  AgentRuntimeProviderConfiguration,
  Channel,
  CodexOAuthCredentials,
} from '@proma/shared'
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
): Promise<ModelCatalogRequestContext> {
  const { apiKey, codexCredentials } = await resolveCredentials(channel)
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
    `__model-catalog__:${context.channel.id}`,
    30_000,
  )
  assertCcbRuntimeModelCatalog(result)
  const runtime = ccbDesktopRuntimeClient.getRuntimeInfo()
  return {
    channelId: context.channel.id,
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

  const promise = loadAgentRuntimeModelCatalog(context).catch(
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

export function clearAgentRuntimeModelCatalogCache(channelId?: string): void {
  if (channelId) {
    catalogCache.delete(channelId)
    return
  }
  catalogCache.clear()
}
