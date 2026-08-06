/**
 * OpenSwitch 联网搜索客户端
 *
 * 请求/鉴权格式与 OpenSwitch 模型接口一致（Bearer API Key），
 * 端点为 `${NEW_API_SERVER_ADDRESS}/v1/search`。
 *
 * 本文件是搜索接口协议的唯一适配层：响应做宽松解析并归一化为
 * Proma 内部的 WebSearchResponse，服务端字段调整时只需改这里。
 */

import { NEW_API_SERVER_ADDRESS } from '../../types'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_SEARCH_RESULTS = 5
const MAX_SEARCH_RESULTS = 10

// ===== 归一化后的响应类型（Chat / Agent 共用） =====

export interface WebSearchResult {
  title: string
  url: string
  content: string
  score?: number
  rawContent?: string | null
  favicon?: string | null
}

export interface WebSearchResponse {
  results: WebSearchResult[]
  answer?: string
  responseTime?: number
  requestId?: string
}

export interface OpenSwitchSearchOptions {
  query: string
  maxResults?: number
  searchDepth?: 'basic' | 'advanced'
  includeDomains?: string[]
  excludeDomains?: string[]
  signal?: AbortSignal
}

// ===== 宽松解析工具（与 new-api-client 同风格） =====

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function readString(object: JsonObject | undefined, ...keys: string[]): string | undefined {
  if (!object) return undefined
  for (const key of keys) {
    const value = object[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function readNumber(object: JsonObject | undefined, ...keys: string[]): number | undefined {
  if (!object) return undefined
  for (const key of keys) {
    const value = object[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function normalizeStringList(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => item.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

/** 将服务端原始响应归一化为内部结构，字段缺失时尽量容错 */
function normalizeSearchResponse(raw: unknown): WebSearchResponse {
  const root = asObject(raw) ?? {}
  // OpenSwitch 实际返回：{ success, data: { query, results: [{ text, url }] } }
  // 同时兼容扁平 { results: [...] } 与其他网关包装
  const data = asObject(root.data) ?? root
  const rawResults = Array.isArray(data.results)
    ? data.results
    : Array.isArray(root.results)
      ? root.results
      : []

  const results: WebSearchResult[] = []
  for (const item of rawResults) {
    const record = asObject(item)
    if (!record) continue
    const url = readString(record, 'url', 'link', 'href')
    if (!url) continue
    const content =
      readString(record, 'text', 'content', 'snippet', 'description', 'body') ?? ''
    const title =
      readString(record, 'title', 'name')
      ?? deriveTitleFromContent(content)
      ?? deriveTitleFromUrl(url)
    results.push({
      title,
      url,
      content,
      score: readNumber(record, 'score', 'relevance_score'),
      rawContent: readString(record, 'raw_content', 'rawContent') ?? null,
      favicon: readString(record, 'favicon', 'icon') ?? null,
    })
  }

  return {
    results,
    answer: readString(data, 'answer', 'summary') ?? readString(root, 'answer', 'summary'),
    responseTime: readNumber(data, 'response_time', 'responseTime')
      ?? readNumber(root, 'response_time', 'responseTime'),
    requestId: readString(root, 'request_id', 'requestId', 'id')
      ?? readString(data, 'request_id', 'requestId'),
  }
}

/** 从正文首行提炼标题（OpenSwitch 结果常无 title，只有 text） */
function deriveTitleFromContent(content: string): string | undefined {
  const firstLine = content.split(/\n+/)[0]?.trim()
  if (!firstLine) return undefined
  // 常见格式："Title — source · date" / "Title - source"
  const cleaned = firstLine
    .split(/\s+[—–-]\s+/)[0]
    ?.split(/\s+·\s+/)[0]
    ?.trim()
  if (!cleaned) return undefined
  return cleaned.length > 120 ? `${cleaned.slice(0, 120)}…` : cleaned
}

function deriveTitleFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`timeout:${timeoutMs}`)), timeoutMs)
  const upstreamSignal = init.signal

  const onAbort = (): void => controller.abort(upstreamSignal?.reason)
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort(upstreamSignal.reason)
    else upstreamSignal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    upstreamSignal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 调用 OpenSwitch 联网搜索接口
 *
 * 请求格式与模型 API 一致：Bearer Key + JSON body。
 */
export async function searchOpenSwitch(
  apiKey: string,
  options: OpenSwitchSearchOptions,
): Promise<WebSearchResponse> {
  const query = options.query.trim()
  if (!query) throw new Error('query 不能为空')

  const includeDomains = normalizeStringList(options.includeDomains)
  const excludeDomains = normalizeStringList(options.excludeDomains)

  const response = await fetchWithTimeout(`${NEW_API_SERVER_ADDRESS}/v1/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: clampInt(options.maxResults, DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS),
      search_depth: options.searchDepth ?? 'basic',
      include_answer: true,
      ...(includeDomains ? { include_domains: includeDomains } : {}),
      ...(excludeDomains ? { exclude_domains: excludeDomains } : {}),
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`OpenSwitch 搜索请求失败 (${response.status}): ${errorText || response.statusText}`)
  }

  const payload = await response.json()
  const root = asObject(payload)
  // 部分网关 HTTP 200 但业务失败
  if (root && root.success === false) {
    const message =
      readString(root, 'message', 'error', 'msg')
      ?? readString(asObject(root.error), 'message', 'msg')
      ?? '搜索失败'
    throw new Error(`OpenSwitch 搜索失败: ${message}`)
  }

  return normalizeSearchResponse(payload)
}
