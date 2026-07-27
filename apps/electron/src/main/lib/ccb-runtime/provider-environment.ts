import {
  extractZhipuCodingTeamApiToken,
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
  const environment: Record<string, string> = {
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
  }

  if (input.provider === 'openai-codex') {
    const credentials = input.codexCredentials
    if (!credentials) {
      throw new Error('ChatGPT 订阅渠道缺少完整 OAuth 凭据')
    }
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
