import {
  extractZhipuCodingTeamApiToken,
  type AgentRuntimeProviderConfiguration,
  type Channel,
  type CodexOAuthCredentials,
  type ProviderType,
} from '@proma/shared'

const ANTHROPIC_PROVIDERS: ReadonlySet<ProviderType> = new Set([
  'anthropic',
  'anthropic-compatible',
  'deepseek',
  'kimi-api',
  'kimi-coding',
  'zhipu-coding',
  'zhipu-coding-team',
  'ark-coding-plan',
  'minimax',
  'qwen-anthropic',
  'qwen-token-plan',
  'xiaomi',
  'xiaomi-token-plan',
])

const OPENAI_PROVIDERS: ReadonlySet<ProviderType> = new Set([
  'openai',
  'openai-responses',
  'opencode-go-openai',
  'zhipu',
  'doubao',
  'qwen',
  'custom',
])

export function resolveCcbModelType(
  provider: ProviderType,
): AgentRuntimeProviderConfiguration['modelType'] {
  if (provider === 'google') return 'gemini'
  if (provider === 'openai-codex' || OPENAI_PROVIDERS.has(provider)) {
    return 'openai'
  }
  if (ANTHROPIC_PROVIDERS.has(provider)) return 'anthropic'
  throw new Error(`CCB Desktop Runtime 暂不支持 Provider: ${provider}`)
}

/**
 * 将 Proma Channel 转换为 CCB 原生配置模型目录。
 *
 * Channel 只决定用户启用哪些模型以及可选的显式 effort 子集；
 * context window、默认 effort、adaptive/fast/auto 等能力全部由 CCB 内核解析。
 */
export function buildCcbProviderConfiguration(
  channel: Channel,
  defaultModel?: string,
  options: { includeDisabledModels?: boolean } = {},
): AgentRuntimeProviderConfiguration {
  const models: AgentRuntimeProviderConfiguration['models'] = channel.models
    .filter(model => options.includeDisabledModels || model.enabled)
    .map(model => ({
      id: model.id,
      name: model.name,
      ...(model.thinkingEffortLevels !== undefined
        ? { effortLevels: [...model.thinkingEffortLevels] }
        : {}),
    }))

  // Desktop 的真实模型目录来自 CCB。Proma Channel 仅作为没有 CCB 原生
  // 配置时的 Provider fallback，因此允许当前选择的 CCB 模型不在 Channel 列表中。
  if (defaultModel && !models.some(model => model.id === defaultModel)) {
    models.unshift({
      id: defaultModel,
      name: defaultModel,
    })
  }

  if (models.length === 0) {
    throw new Error(`渠道「${channel.name}」没有启用的模型`)
  }

  const resolvedDefaultModel = defaultModel ?? models[0]?.id

  return {
    modelType: resolveCcbModelType(channel.provider),
    ...(resolvedDefaultModel ? { defaultModel: resolvedDefaultModel } : {}),
    models,
  }
}

/** 仅使用 CCB settings 中的 Provider、模型和凭证，不注入 Proma fallback。 */
export function buildCcbNativeProviderConfiguration(): AgentRuntimeProviderConfiguration {
  return {
    modelType: 'anthropic',
    models: [],
  }
}

const ANTHROPIC_BEARER_PROVIDERS: ReadonlySet<ProviderType> = new Set([
  'kimi-coding',
  'zhipu-coding',
  'zhipu-coding-team',
  'xiaomi-token-plan',
  'qwen-token-plan',
  'minimax',
])

export interface BuildCcbProviderEnvironmentInput {
  provider: ProviderType
  apiKey: string
  baseUrl?: string
  modelId?: string
  userAgent: string
  codexCredentials?: CodexOAuthCredentials
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeOpenAIBaseUrl(value: string): string {
  return trimTrailingSlash(value)
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/responses$/i, '')
}

function normalizeGeminiBaseUrl(value: string): string {
  const normalized = trimTrailingSlash(value)
  return /\/v\d+(?:beta)?$/i.test(normalized)
    ? normalized
    : `${normalized}/v1beta`
}

export function buildCcbProviderEnvironment(
  input: BuildCcbProviderEnvironmentInput,
): Record<string, string> {
  // CCB 用户 settings 是 Desktop 的首选 Provider/凭证来源。这里不设置
  // CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST，避免 CCB 主动过滤 ~/.claude/settings.json
  // 中的 OPENAI_API_KEY、OPENAI_BASE_URL 等原生配置。
  const environment: Record<string, string> = {}

  if (input.provider === 'openai-codex') {
    const credentials = input.codexCredentials
    if (!credentials) {
      throw new Error('ChatGPT 订阅渠道缺少完整 OAuth 凭据')
    }
    environment.CLAUDE_CODE_USE_OPENAI = '1'
    environment.OPENAI_AUTH_MODE = 'chatgpt'
    environment.OPENAI_CHATGPT_ACCESS_TOKEN = credentials.access
    environment.OPENAI_CHATGPT_REFRESH_TOKEN = credentials.refresh
    environment.OPENAI_CHATGPT_EXPIRES_AT = String(credentials.expires)
    if (credentials.accountId) {
      environment.OPENAI_CHATGPT_ACCOUNT_ID = credentials.accountId
    }
    if (input.modelId) environment.OPENAI_MODEL = input.modelId
    return environment
  }

  if (input.provider === 'google') {
    environment.CLAUDE_CODE_USE_GEMINI = '1'
    environment.GEMINI_API_KEY = input.apiKey
    if (input.baseUrl) {
      environment.GEMINI_BASE_URL = normalizeGeminiBaseUrl(input.baseUrl)
    }
    if (input.modelId) environment.GEMINI_MODEL = input.modelId
    return environment
  }

  if (OPENAI_PROVIDERS.has(input.provider)) {
    environment.CLAUDE_CODE_USE_OPENAI = '1'
    environment.OPENAI_API_KEY = input.apiKey
    if (input.baseUrl) {
      environment.OPENAI_BASE_URL = normalizeOpenAIBaseUrl(input.baseUrl)
    }
    if (input.modelId) environment.OPENAI_MODEL = input.modelId
    return environment
  }

  if (!ANTHROPIC_PROVIDERS.has(input.provider)) {
    throw new Error(`CCB Desktop Runtime 暂不支持 Provider: ${input.provider}`)
  }

  if (ANTHROPIC_BEARER_PROVIDERS.has(input.provider)) {
    environment.ANTHROPIC_AUTH_TOKEN = input.provider === 'zhipu-coding-team'
      ? extractZhipuCodingTeamApiToken(input.apiKey)
      : input.apiKey
    if (input.provider !== 'minimax') {
      environment.ANTHROPIC_CUSTOM_HEADERS = `User-Agent: ${input.userAgent}`
    }
  } else {
    environment.ANTHROPIC_API_KEY = input.apiKey
  }
  if (input.baseUrl) environment.ANTHROPIC_BASE_URL = input.baseUrl
  if (input.modelId) environment.ANTHROPIC_MODEL = input.modelId
  return environment
}
