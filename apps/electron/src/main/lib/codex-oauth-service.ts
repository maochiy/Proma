/**
 * ChatGPT (Codex) Device OAuth。
 *
 * Proma 负责完成 OAuth 并把凭据交给 Channel
 * 的 safeStorage 持久化，CCB Desktop Runtime 通过清洗后的 Worker 环境读取凭据。
 */

import { clipboard, dialog, shell } from 'electron'
import type { CodexOAuthCredentials } from '@proma/shared'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { getFetchFn } from './proxy-fetch'

const ISSUER = 'https://auth.openai.com'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000

interface DeviceCode {
  verificationUrl: string
  userCode: string
  deviceAuthId: string
  intervalSeconds: number
}

interface TokenResponse {
  id_token: string
  access_token: string
  refresh_token?: string
}

let activeLoginAbort: AbortController | undefined

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')
    return parseJsonRecord(Buffer.from(padded, 'base64').toString('utf-8'))
  } catch {
    return null
  }
}

function tokenExpiresAt(token: string): number {
  const exp = decodeJwtPayload(token)?.exp
  return typeof exp === 'number' ? exp * 1000 : Date.now() + 60 * 60 * 1000
}

function extractAccountId(...tokens: Array<string | undefined>): string | undefined {
  for (const token of tokens) {
    if (!token) continue
    const payload = decodeJwtPayload(token)
    const nested = payload?.['https://api.openai.com/auth']
    const claims = nested && typeof nested === 'object'
      ? nested as Record<string, unknown>
      : payload
    for (const key of ['chatgpt_account_id', 'chatgpt_account_user_id', 'account_id']) {
      const value = claims?.[key]
      if (typeof value === 'string' && value) return value
    }
  }
  return undefined
}

async function getOAuthFetch(): Promise<typeof globalThis.fetch> {
  return getFetchFn(await getEffectiveProxyUrl())
}

async function requestDeviceCode(fetchFn: typeof globalThis.fetch): Promise<DeviceCode> {
  const response = await fetchFn(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  })
  if (!response.ok) throw new Error(`ChatGPT 授权请求失败 (${response.status})`)

  const data = await response.json() as {
    device_auth_id?: unknown
    user_code?: unknown
    usercode?: unknown
    interval?: unknown
  }
  const deviceAuthId = typeof data.device_auth_id === 'string' ? data.device_auth_id : ''
  const userCode = typeof data.user_code === 'string'
    ? data.user_code
    : typeof data.usercode === 'string' ? data.usercode : ''
  if (!deviceAuthId || !userCode) throw new Error('ChatGPT 授权响应缺少设备码')
  const interval = typeof data.interval === 'number'
    ? data.interval
    : Number.parseInt(typeof data.interval === 'string' ? data.interval : '5', 10)
  return {
    verificationUrl: `${ISSUER}/codex/device`,
    userCode,
    deviceAuthId,
    intervalSeconds: Number.isFinite(interval) && interval > 0 ? interval : 5,
  }
}

async function pollAuthorizationCode(
  fetchFn: typeof globalThis.fetch,
  deviceCode: DeviceCode,
  signal: AbortSignal,
): Promise<{ authorizationCode: string; codeVerifier: string }> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
    if (signal.aborted) throw new Error('登录已取消')
    const response = await fetchFn(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: deviceCode.deviceAuthId,
        user_code: deviceCode.userCode,
      }),
      signal,
    })
    if (response.ok) {
      const data = await response.json() as {
        authorization_code?: unknown
        code_verifier?: unknown
      }
      if (typeof data.authorization_code === 'string' && typeof data.code_verifier === 'string') {
        return {
          authorizationCode: data.authorization_code,
          codeVerifier: data.code_verifier,
        }
      }
      throw new Error('ChatGPT 授权响应缺少 authorization code')
    }
    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`ChatGPT 设备授权失败 (${response.status})`)
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, deviceCode.intervalSeconds * 1000)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('登录已取消'))
      }, { once: true })
    })
  }
  throw new Error('ChatGPT 登录等待超时')
}

async function exchangeToken(
  fetchFn: typeof globalThis.fetch,
  body: URLSearchParams,
): Promise<TokenResponse> {
  const response = await fetchFn(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`ChatGPT Token 请求失败 (${response.status})${detail ? `: ${detail}` : ''}`)
  }
  return response.json() as Promise<TokenResponse>
}

function toCredentials(tokens: TokenResponse, fallbackRefresh?: string): CodexOAuthCredentials {
  const refresh = tokens.refresh_token ?? fallbackRefresh
  if (!tokens.access_token || !refresh) throw new Error('ChatGPT Token 响应缺少 access/refresh token')
  const accountId = extractAccountId(tokens.id_token, tokens.access_token)
  return {
    access: tokens.access_token,
    refresh,
    expires: tokenExpiresAt(tokens.access_token),
    ...(accountId ? { accountId } : {}),
  }
}

export async function loginCodexOAuth(): Promise<CodexOAuthCredentials> {
  activeLoginAbort?.abort()
  const abort = new AbortController()
  activeLoginAbort = abort

  try {
    const fetchFn = await getOAuthFetch()
    const deviceCode = await requestDeviceCode(fetchFn)
    clipboard.writeText(deviceCode.userCode)
    await shell.openExternal(deviceCode.verificationUrl)
    void dialog.showMessageBox({
      type: 'info',
      title: 'ChatGPT 授权',
      message: `授权码：${deviceCode.userCode}`,
      detail: '授权码已复制到剪贴板。请在浏览器中粘贴并完成授权；完成后可关闭此提示。',
      buttons: ['知道了'],
      noLink: true,
    })

    const code = await pollAuthorizationCode(fetchFn, deviceCode, abort.signal)
    const tokens = await exchangeToken(fetchFn, new URLSearchParams({
      grant_type: 'authorization_code',
      code: code.authorizationCode,
      redirect_uri: `${ISSUER}/deviceauth/callback`,
      client_id: CLIENT_ID,
      code_verifier: code.codeVerifier,
    }))
    return toCredentials(tokens)
  } finally {
    if (activeLoginAbort === abort) activeLoginAbort = undefined
  }
}

export function cancelCodexOAuthLogin(): void {
  activeLoginAbort?.abort()
  activeLoginAbort = undefined
}

export async function refreshCodexOAuth(refreshToken: string): Promise<CodexOAuthCredentials> {
  const fetchFn = await getOAuthFetch()
  const tokens = await exchangeToken(fetchFn, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
  }))
  return toCredentials(tokens, refreshToken)
}
