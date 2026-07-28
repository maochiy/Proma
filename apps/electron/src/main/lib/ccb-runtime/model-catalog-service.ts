import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentRuntimeModelCatalog,
  AgentRuntimeModelCatalogDraftInput,
  AgentRuntimeProviderConfiguration,
  Channel,
  CodexOAuthCredentials,
} from '@proma/shared'
import { CCB_NATIVE_CHANNEL_ID, parseCodexCredentials } from '@proma/shared'
import { getPromaUserAgent, normalizeAnthropicBaseUrlForSdk } from '@proma/core'
import pkg from '../../../../package.json' with { type: 'json' }
import {
  decryptApiKey,
  getChannelById,
  listChannels,
  resolveCodexOAuthCredentials,
} from '../channel-manager'
import { getAgentWorkspace } from '../agent-workspace-manager'
import { getEffectiveProxyUrl } from '../proxy-settings-service'
import { ccbDesktopRuntimeClient } from './runtime-client'
import {
  buildCcbProviderConfiguration,
  buildCcbNativeProviderConfiguration,
  buildCcbProviderEnvironment,
} from './provider-environment'
import { assertCcbRuntimeModelCatalog } from './protocol-validation'
import type { CcbRuntimeModelCatalog } from './protocol'
import { sanitizeCcbSessionEnvironment } from './runtime-security'
import { getCcbUserConfigDir } from './user-config'

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
  cwd: string,
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
      cwd,
    }))
    .digest('hex')
}

function hashCcbModelConfiguration(cwd: string): string {
  const configDir = getCcbUserConfigDir()
  const candidates = [
    join(configDir, 'settings.json'),
    join(configDir, 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ]
  const hash = createHash('sha256')
  for (const filePath of candidates) {
    hash.update(filePath)
    try {
      hash.update(readFileSync(filePath))
    } catch {
      hash.update('<missing>')
    }
  }
  return hash.digest('hex')
}

function buildNativeModelCatalogRequestContext(
  cwd: string,
): ModelCatalogRequestContext {
  const channel: Channel = {
    id: CCB_NATIVE_CHANNEL_ID,
    name: 'Claude Code Best',
    provider: 'anthropic',
    baseUrl: DEFAULT_ANTHROPIC_URL,
    apiKey: '',
    models: [],
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
  return {
    channel,
    environment: {},
    providerConfiguration: buildCcbNativeProviderConfiguration(),
    fingerprint: hashCcbModelConfiguration(cwd),
  }
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
  cwd: string,
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
      cwd,
      defaultModel,
    ),
  }
}

async function loadAgentRuntimeModelCatalog(
  context: ModelCatalogRequestContext,
  cwd: string,
  requestSessionId: string,
  resultChannelId: string,
): Promise<AgentRuntimeModelCatalog> {
  const result = await ccbDesktopRuntimeClient.request<CcbRuntimeModelCatalog>(
    {
      type: 'session.resolveModelCatalog',
      cwd,
      environment: {
        variables: context.environment,
        configDir: getCcbUserConfigDir(),
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
  workspaceId?: string,
): Promise<AgentRuntimeModelCatalog> {
  const workspace = workspaceId ? getAgentWorkspace(workspaceId) : undefined
  const cwd = workspace?.canonicalPath ?? workspace?.path ?? process.cwd()
  if (channelId === CCB_NATIVE_CHANNEL_ID) {
    const nativeContext = buildNativeModelCatalogRequestContext(cwd)
    const nativeCacheKey = `native:${cwd}`
    const nativeCached = catalogCache.get(nativeCacheKey)
    const nativePromise =
      nativeCached?.fingerprint === nativeContext.fingerprint
        ? nativeCached.promise
        : loadAgentRuntimeModelCatalog(
            nativeContext,
            cwd,
            `__native-model-catalog__:${cwd}`,
            CCB_NATIVE_CHANNEL_ID,
          ).catch(error => {
            const current = catalogCache.get(nativeCacheKey)
            if (current?.promise === nativePromise) catalogCache.delete(nativeCacheKey)
            throw error
          })
    if (nativeCached?.fingerprint !== nativeContext.fingerprint) {
      catalogCache.set(nativeCacheKey, {
        fingerprint: nativeContext.fingerprint,
        promise: nativePromise,
      })
    }

    const nativeCatalog = await nativePromise
    if (nativeCatalog.models.length > 0) return nativeCatalog
  }

  // Proma 可以保存多个 Provider 预设，但一次只允许启用一个。明确选择
  // Proma Channel 时必须让该配置直接交给 CCB，不能再被原生配置抢占。
  const channel = channelId === CCB_NATIVE_CHANNEL_ID
    ? listChannels().find(candidate => candidate.enabled)
    : getChannelById(channelId)
  if (!channel || !channel.enabled) {
    throw new Error('CCB 未配置原生模型，且 Proma Agent 渠道不存在或已禁用')
  }
  const context = await buildModelCatalogRequestContext(
    channel,
    cwd,
    defaultModel,
  )
  const cacheKey = `fallback:${channelId}:${cwd}`
  const cached = catalogCache.get(cacheKey)
  if (cached?.fingerprint === context.fingerprint) return cached.promise

  const promise = loadAgentRuntimeModelCatalog(
    context,
    cwd,
    `__model-catalog__:${channel.id}`,
    channel.id,
  ).catch(
    error => {
      const current = catalogCache.get(cacheKey)
      if (current?.promise === promise) catalogCache.delete(cacheKey)
      throw error
    },
  )
  catalogCache.set(cacheKey, {
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
    process.cwd(),
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
    process.cwd(),
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
    for (const key of catalogCache.keys()) {
      if (
        key.startsWith(`fallback:${channelId}:`)
        || channelId === CCB_NATIVE_CHANNEL_ID
      ) {
        catalogCache.delete(key)
      }
    }
    return
  }
  catalogCache.clear()
  draftCatalogCache = undefined
}
