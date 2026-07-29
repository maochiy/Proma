/**
 * New API 登录与渠道同步服务
 *
 * 账号密码登录只在本次请求中使用，成功后立即创建 New API 模型令牌，
 * Proma 本地最终只保留 safeStorage 加密后的渠道 API Key。
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { CCB_NATIVE_CHANNEL_ID } from '@proma/shared'
import type { Channel, ChannelModel } from '@proma/shared'
import {
  NEW_API_OPENAI_BASE_URL,
  NEW_API_SERVER_ADDRESS,
  DEFAULT_USER_AVATAR,
  DEFAULT_USER_NAME,
} from '../../types'
import type {
  NewApiApiKeyLoginInput,
  NewApiAuthState,
  NewApiLoginMethod,
  NewApiLoginResult,
  NewApiPasswordLoginInput,
  UserProfile,
} from '../../types'
import { getNewApiAuthPath } from './config-paths'
import {
  createChannel,
  decryptApiKey,
  deleteChannel,
  getChannelById,
  updateChannel,
} from './channel-manager'
import { getSettings, updateSettings } from './settings-service'
import { getUserProfile, updateUserProfile } from './user-profile-service'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import {
  createProfileFromApiKey,
  createProfileFromRemoteUser,
  NewApiClient,
  NewApiRequestError,
} from './new-api-client'

const AUTH_CONFIG_VERSION = 1
const CCB_API_KEY_MARKER = 'ccb'

interface NewApiAuthConfig {
  version: number
  method: NewApiLoginMethod
  channelId: string
  profile: UserProfile
  defaultModelId?: string
  previousProfile?: UserProfile
  previousAgentChannelId?: string
  previousAgentChannelIds?: string[]
  previousAgentModelId?: string
  updatedAt: number
}

interface ProvisionChannelInput {
  method: NewApiLoginMethod
  apiKey: string
  profile: UserProfile
}

function readAuthConfig(): NewApiAuthConfig | null {
  const filePath = getNewApiAuthPath()
  if (!existsSync(filePath)) return null

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<NewApiAuthConfig>
    if (
      parsed.version !== AUTH_CONFIG_VERSION
      || (parsed.method !== 'password' && parsed.method !== 'api-key')
      || typeof parsed.channelId !== 'string'
      || !parsed.profile
      || typeof parsed.profile.userName !== 'string'
      || typeof parsed.profile.avatar !== 'string'
    ) {
      return null
    }
    return parsed as NewApiAuthConfig
  } catch (error) {
    console.error('[New API 登录] 读取登录状态失败:', error)
    return null
  }
}

function writeAuthConfig(config: NewApiAuthConfig): void {
  writeFileSync(getNewApiAuthPath(), JSON.stringify(config, null, 2), 'utf-8')
}

function clearAuthConfig(): void {
  const filePath = getNewApiAuthPath()
  if (existsSync(filePath)) unlinkSync(filePath)
}

function unauthenticatedState(warning?: string): NewApiAuthState {
  return {
    authenticated: false,
    ...(warning ? { warning } : {}),
  }
}

function authenticatedState(config: NewApiAuthConfig, warning?: string): NewApiAuthState {
  return {
    authenticated: true,
    method: config.method,
    profile: config.profile,
    channelId: config.channelId,
    ...(config.defaultModelId ? { defaultModelId: config.defaultModelId } : {}),
    ...(warning ? { warning } : {}),
  }
}

async function createClient(): Promise<NewApiClient> {
  const proxyUrl = await getEffectiveProxyUrl()
  return new NewApiClient({
    fetch: getFetchFn(proxyUrl),
    serverAddress: NEW_API_SERVER_ADDRESS,
  })
}

function toChannelModels(models: Awaited<ReturnType<NewApiClient['fetchModels']>>): ChannelModel[] {
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    enabled: true,
    source: 'fetched',
  }))
}

function resolveDefaultModelId(models: ChannelModel[]): string | undefined {
  const currentModelId = getSettings().agentModelId
  if (currentModelId && models.some((model) => model.id === currentModelId && model.enabled)) {
    return currentModelId
  }
  return models.find((model) => model.enabled)?.id
}

function upsertManagedChannel(
  apiKey: string,
  models: ChannelModel[],
  previousChannelId?: string,
): Channel {
  const existing = previousChannelId ? getChannelById(previousChannelId) : undefined
  const input = {
    name: 'OpenSwitch',
    provider: 'openai' as const,
    baseUrl: NEW_API_OPENAI_BASE_URL,
    apiKey,
    models,
    enabled: true,
  }

  if (existing) {
    return updateChannel(existing.id, input)
  }
  return createChannel(input)
}

async function provisionChannel(input: ProvisionChannelInput): Promise<NewApiLoginResult> {
  const client = await createClient()
  const remoteModels = await client.fetchModels(input.apiKey)
  if (remoteModels.length === 0) {
    throw new Error('登录成功，但当前 API Key 没有可用模型，请在 New API 中检查令牌权限')
  }

  const previous = readAuthConfig()
  const currentSettings = getSettings()
  const previousProfile = previous?.previousProfile ?? getUserProfile()
  const models = toChannelModels(remoteModels)
  const channel = upsertManagedChannel(input.apiKey, models, previous?.channelId)
  const defaultModelId = resolveDefaultModelId(models)
  const profile = updateUserProfile(input.profile)

  updateSettings({
    agentChannelId: channel.id,
    agentChannelIds: [channel.id],
    agentModelId: defaultModelId,
  })

  const config: NewApiAuthConfig = {
    version: AUTH_CONFIG_VERSION,
    method: input.method,
    channelId: channel.id,
    profile,
    ...(defaultModelId ? { defaultModelId } : {}),
    previousProfile,
    ...(previous?.previousAgentChannelId ?? currentSettings.agentChannelId
      ? { previousAgentChannelId: previous?.previousAgentChannelId ?? currentSettings.agentChannelId }
      : {}),
    ...(previous?.previousAgentChannelIds ?? currentSettings.agentChannelIds
      ? { previousAgentChannelIds: previous?.previousAgentChannelIds ?? currentSettings.agentChannelIds }
      : {}),
    ...(previous?.previousAgentModelId ?? currentSettings.agentModelId
      ? { previousAgentModelId: previous?.previousAgentModelId ?? currentSettings.agentModelId }
      : {}),
    updatedAt: Date.now(),
  }
  writeAuthConfig(config)

  console.log(
    `[New API 登录] 登录成功，方式=${input.method}，渠道=${channel.id}，模型数=${models.length}`,
  )
  return {
    auth: authenticatedState(config),
  }
}

/**
 * 启动时检查本地登录状态并在线验证 API Key。
 *
 * 网络错误不会强制退出登录，避免临时断网时把用户锁在登录页；
 * 401/403 等明确凭据错误会回到未登录状态。
 */
export async function checkNewApiAuth(): Promise<NewApiAuthState> {
  const config = readAuthConfig()
  if (!config) return unauthenticatedState()

  const channel = getChannelById(config.channelId)
  if (!channel) {
    clearAuthConfig()
    return unauthenticatedState('登录渠道已被删除，请重新登录')
  }

  let apiKey: string
  try {
    apiKey = decryptApiKey(channel.id)
  } catch {
    return unauthenticatedState('登录凭据无法解密，请重新登录')
  }

  try {
    const client = await createClient()
    const remoteModels = await client.fetchModels(apiKey)
    if (remoteModels.length === 0) {
      return authenticatedState(config, '当前 API Key 暂无可用模型')
    }

    const models = toChannelModels(remoteModels)
    const updatedChannel = updateChannel(channel.id, {
      models,
    })
    const updatedConfig: NewApiAuthConfig = {
      ...config,
      channelId: updatedChannel.id,
      updatedAt: Date.now(),
    }
    writeAuthConfig(updatedConfig)
    return authenticatedState(updatedConfig)
  } catch (error) {
    if (
      error instanceof NewApiRequestError
      && (error.statusCode === 401 || error.statusCode === 403)
    ) {
      return unauthenticatedState('API Key 已失效或无权访问，请重新登录')
    }
    const message = error instanceof Error ? error.message : '无法连接 New API'
    console.warn('[New API 登录] 在线校验失败，继续使用本地登录状态:', message)
    return authenticatedState(config, message)
  }
}

/** 使用账号密码登录，并创建专属的 Proma API Key。 */
export async function loginNewApiWithPassword(
  input: NewApiPasswordLoginInput,
): Promise<NewApiLoginResult> {
  const username = input.username.trim()
  if (!username || !input.password) {
    throw new Error('请输入账号和密码')
  }

  const client = await createClient()
  const session = await client.loginWithPassword(username, input.password)
  const tokenName = 'ccb · Proma Desktop'
  const resolvedKey = await client.getOrCreateApiKey(session, tokenName, CCB_API_KEY_MARKER)
  try {
    return await provisionChannel({
      method: 'password',
      apiKey: resolvedKey.apiKey,
      profile: createProfileFromRemoteUser(session.user),
    })
  } catch (error) {
    if (resolvedKey.created && resolvedKey.tokenId != null) {
      await client.deleteApiKey(session, resolvedKey.tokenId).catch((cleanupError) => {
        console.warn('[New API 登录] 回收创建失败的远端令牌失败:', cleanupError)
      })
    }
    throw error
  }
}

/** 使用已有 API Key 登录。模型 Token 不暴露所属用户，因此以令牌名称作为显示名称。 */
export async function loginNewApiWithApiKey(
  input: NewApiApiKeyLoginInput,
): Promise<NewApiLoginResult> {
  const apiKey = input.apiKey.trim()
  if (!apiKey) throw new Error('请输入 API Key')

  const client = await createClient()
  const tokenUsage = await client.getTokenUsage(apiKey).catch((): { name?: string } => ({}))
  return provisionChannel({
    method: 'api-key',
    apiKey,
    profile: createProfileFromApiKey(tokenUsage.name),
  })
}

/** 退出登录，同时移除自动生成的模型渠道和本地用户展示信息。 */
export function logoutNewApi(): NewApiAuthState {
  const config = readAuthConfig()
  if (config?.channelId && getChannelById(config.channelId)) {
    deleteChannel(config.channelId)
  }
  clearAuthConfig()
  updateSettings({
    agentChannelId: config?.previousAgentChannelId ?? CCB_NATIVE_CHANNEL_ID,
    agentChannelIds: config?.previousAgentChannelIds ?? [],
    agentModelId: config?.previousAgentModelId,
  })
  updateUserProfile(config?.previousProfile ?? {
    userName: DEFAULT_USER_NAME,
    avatar: DEFAULT_USER_AVATAR,
  })
  console.log('[New API 登录] 已退出登录')
  return unauthenticatedState()
}
