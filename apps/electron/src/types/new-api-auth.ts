/**
 * New API 登录相关类型
 *
 * Proma 固定连接到自部署的 New API 服务。账号密码仅用于换取 API Key，
 * 不会在本地持久化；最终模型调用统一走 OpenAI 兼容协议。
 */

import type { UserProfile } from './user-profile'

/** New API 服务地址 */
export const NEW_API_SERVER_ADDRESS = 'https://ais.xiudarepair.com'

/** OpenAI 兼容协议 Base URL */
export const NEW_API_OPENAI_BASE_URL = `${NEW_API_SERVER_ADDRESS}/v1`

/** 登录方式 */
export type NewApiLoginMethod = 'password' | 'api-key'

/** New API 登录状态 */
export interface NewApiAuthState {
  /** 是否已登录 */
  authenticated: boolean
  /** 登录方式 */
  method?: NewApiLoginMethod
  /** 当前展示的用户档案 */
  profile?: UserProfile
  /** 自动生成的渠道 ID */
  channelId?: string
  /** 自动选中的默认模型 */
  defaultModelId?: string
  /** 网络不可用但本地凭据仍保留时的非阻塞提示 */
  warning?: string
}

/** 账号密码登录输入 */
export interface NewApiPasswordLoginInput {
  username: string
  password: string
}

/** API Key 登录输入 */
export interface NewApiApiKeyLoginInput {
  apiKey: string
}

/** 登录成功结果 */
export interface NewApiLoginResult {
  auth: NewApiAuthState
}

/** New API 登录 IPC 通道 */
export const NEW_API_AUTH_IPC_CHANNELS = {
  CHECK: 'new-api-auth:check',
  LOGIN_PASSWORD: 'new-api-auth:login-password',
  LOGIN_API_KEY: 'new-api-auth:login-api-key',
  LOGOUT: 'new-api-auth:logout',
} as const
