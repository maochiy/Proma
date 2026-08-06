/**
 * 联网搜索 / 网页抓取服务（Chat 与 Agent 模式共用）
 *
 * - WebSearch：走 OpenSwitch `/v1/search` 接口，鉴权复用登录时创建的模型 API Key
 *   （safeStorage 加密存储于渠道配置），登录即用、无需额外配置。
 * - WebFetch：OpenSwitch 不提供网页提取，本服务在本地抓取页面并做简易正文提取。
 */

import { decryptApiKey } from './channel-manager'
import { getAuthenticatedChannelId } from './new-api-auth-service'
import {
  searchOpenSwitch,
  type WebSearchResponse,
  type WebSearchResult,
} from './openswitch-search-client'

export type { WebSearchResponse, WebSearchResult }

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_FETCH_CHARS = 20_000
const FETCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Proma/1.0'

export interface WebSearchOptions {
  query: string
  maxResults?: number
  searchDepth?: 'basic' | 'advanced'
  includeDomains?: string[]
  excludeDomains?: string[]
  signal?: AbortSignal
}

export interface WebFetchResult {
  url: string
  rawContent?: string | null
}

export interface WebFetchResponse {
  results: WebFetchResult[]
  failedResults?: Array<{ url: string; error?: string }>
}

export interface WebFetchOptions {
  url: string
  prompt?: string
  maxChars?: number
  signal?: AbortSignal
}

// ===== 凭据解析 =====

/**
 * 解析联网搜索所用的 API Key。
 *
 * 唯一来源：OpenSwitch 登录渠道（登录时创建的模型令牌）。
 * 未登录或 Key 无法解密时返回 undefined，搜索能力自动不可用。
 */
export function resolveWebSearchApiKey(): string | undefined {
  const channelId = getAuthenticatedChannelId()
  if (!channelId) return undefined
  try {
    const apiKey = decryptApiKey(channelId)
    return apiKey.trim() || undefined
  } catch (error) {
    console.warn('[联网搜索] 解密 OpenSwitch API Key 失败:', error)
    return undefined
  }
}

/** 联网搜索是否可用（已登录 OpenSwitch 且 Key 可解密） */
export function isWebSearchAvailable(): boolean {
  return !!resolveWebSearchApiKey()
}

// ===== WebSearch（OpenSwitch） =====

export async function searchWeb(options: WebSearchOptions): Promise<WebSearchResponse> {
  const apiKey = resolveWebSearchApiKey()
  if (!apiKey) throw new Error('联网搜索需要登录 OpenSwitch，请先在设置中登录')
  return searchOpenSwitch(apiKey, options)
}

// ===== WebFetch（本地抓取 + 正文提取） =====

function validateHttpUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) throw new Error('url 不能为空')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`无效 URL: ${rawUrl}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`仅支持 http/https URL: ${rawUrl}`)
  }
  return parsed.toString()
}

/** HTML 实体反转义（覆盖常见实体） */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

/**
 * 简易 HTML → 正文文本提取。
 *
 * 不引入重型解析依赖：剥离 script/style/注释，块级标签转换为换行，
 * 标题/列表/链接保留基本 Markdown 结构，供模型阅读足够。
 */
function htmlToText(html: string): string {
  let text = html
    // 移除无正文价值的区块
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // 链接保留为 Markdown 形式
    .replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const cleanLabel = label.replace(/<[^>]+>/g, '').trim()
      return cleanLabel ? `[${cleanLabel}](${href})` : ''
    })
    // 标题 / 列表 / 段落结构
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, content: string) => {
      const clean = content.replace(/<[^>]+>/g, '').trim()
      return clean ? `\n\n${'#'.repeat(Number(level))} ${clean}\n\n` : ''
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, content: string) => {
      const clean = content.replace(/<[^>]+>/g, '').trim()
      return clean ? `\n- ${clean}` : ''
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|table|tr|ul|ol|blockquote)>/gi, '\n\n')
    // 剥离剩余标签
    .replace(/<[^>]+>/g, '')

  return decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

export async function fetchWebPage(options: WebFetchOptions): Promise<WebFetchResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`timeout:${DEFAULT_TIMEOUT_MS}`)), DEFAULT_TIMEOUT_MS)
  const upstreamSignal = options.signal
  const onAbort = (): void => controller.abort(upstreamSignal?.reason)
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort(upstreamSignal.reason)
    else upstreamSignal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const url = validateHttpUrl(options.url)
    const response = await fetch(url, {
      headers: { 'User-Agent': FETCH_USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain,*/*' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`抓取失败 (${response.status}): ${response.statusText}`)
    }
    const contentType = response.headers.get('content-type') ?? ''
    const body = await response.text()
    const rawContent = contentType.includes('html') ? htmlToText(body) : body.trim()

    return { results: [{ url, rawContent }] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const fallbackUrl = options.url.trim() || '(empty)'
    return { results: [], failedResults: [{ url: fallbackUrl, error: message }] }
  } finally {
    clearTimeout(timeout)
    upstreamSignal?.removeEventListener('abort', onAbort)
  }
}

// ===== 结果格式化（模型可读文本） =====

export function formatSearchResults(data: WebSearchResponse): string {
  const parts: string[] = []

  if (data.answer) {
    parts.push(`**概要：** ${data.answer}`)
    parts.push('')
  }

  if (data.results.length > 0) {
    parts.push('**搜索结果：**')
    for (const [index, result] of data.results.entries()) {
      parts.push(`${index + 1}. [${result.title}](${result.url})`)
      parts.push(`   ${result.content.slice(0, 500)}`)
      if (typeof result.score === 'number') {
        parts.push(`   score: ${result.score.toFixed(3)}`)
      }
      parts.push('')
    }
  } else {
    parts.push('未找到相关结果。')
  }

  return parts.join('\n')
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

export function formatFetchResults(data: WebFetchResponse, options: Pick<WebFetchOptions, 'maxChars'> = {}): string {
  const maxChars = clampInt(options.maxChars, MAX_FETCH_CHARS, 1_000, 80_000)
  const parts: string[] = []

  for (const [index, result] of data.results.entries()) {
    const content = (result.rawContent ?? '').trim()
    parts.push(data.results.length > 1 ? `# ${index + 1}. ${result.url}` : `# ${result.url}`)
    parts.push('')
    if (content) {
      parts.push(
        content.length > maxChars
          ? `${content.slice(0, maxChars)}\n\n[内容过长，已截断至 ${maxChars} 字符]`
          : content,
      )
    } else {
      parts.push('未提取到正文内容。')
    }
    parts.push('')
  }

  if (data.failedResults && data.failedResults.length > 0) {
    parts.push('## 抓取失败')
    for (const failure of data.failedResults) {
      parts.push(`- ${failure.url}: ${failure.error ?? 'unknown error'}`)
    }
  }

  if (parts.length === 0) return '未提取到网页内容。'
  return parts.join('\n')
}
