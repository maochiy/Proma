/**
 * 反馈会话数据整理工具。
 *
 * 反馈只携带最近一部分会话记录，并在客户端先做一轮脱敏和大小限制。
 * 服务端仍会执行第二轮脱敏，形成纵深防护。
 */

import type { FeedbackSessionType } from '@proma/shared'

const MAX_TRANSCRIPT_MESSAGES = 50
const MAX_STRING_LENGTH = 4_000
const MAX_MESSAGE_JSON_LENGTH = 24_000
const MAX_TRANSCRIPT_JSON_LENGTH = 320_000
const MAX_OBJECT_ENTRIES = 80
const MAX_ARRAY_ITEMS = 80
const MAX_DEPTH = 12

const SENSITIVE_KEY_PATTERN =
  /(authorization|api[-_]?key|token|secret|password|cookie|private[-_]?key)/i

const STRING_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(?:sk|github_pat|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_-]{12,}\b/g, '[已隐藏的密钥]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, 'Bearer [已隐藏]'],
  [
    /\b([A-Z][A-Z0-9_]*(?:(?:API_)?KEY|TOKEN|SECRET|PASSWORD))\s*=\s*[^\s]+/g,
    '$1=[已隐藏]',
  ],
  [/\/Users\/[^/\s]+/g, '/Users/[用户]'],
  [/C:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[用户]'],
]

export interface FeedbackTranscript {
  messages: unknown[]
  totalMessages: number
  includedMessages: number
  truncated: boolean
}

interface FeedbackSessionReference {
  id: string
}

export interface ResolvedFeedbackSession {
  id: string
  type: FeedbackSessionType
}

/**
 * 根据用户输入的会话 ID 定位本地 Chat 或 Agent 会话。
 *
 * 右键菜单会传入已知类型并严格校验该类型；手动输入时则从两类本地索引中推断。
 */
export function resolveFeedbackSession(
  rawSessionId: string,
  preferredType: FeedbackSessionType | undefined,
  conversations: FeedbackSessionReference[],
  agentSessions: FeedbackSessionReference[],
): ResolvedFeedbackSession {
  const sessionId = rawSessionId.trim()
  if (!sessionId) throw new Error('会话 ID 不能为空')

  const chatExists = conversations.some((conversation) => conversation.id === sessionId)
  const agentExists = agentSessions.some((session) => session.id === sessionId)

  if (preferredType === 'chat') {
    if (!chatExists) throw new Error('未找到对应的本地会话，请检查会话 ID')
    return { id: sessionId, type: 'chat' }
  }
  if (preferredType === 'agent') {
    if (!agentExists) throw new Error('未找到对应的本地会话，请检查会话 ID')
    return { id: sessionId, type: 'agent' }
  }

  if (chatExists && agentExists) {
    throw new Error('会话 ID 同时匹配 Chat 和 Agent 会话，请从对应会话的右键菜单提交反馈')
  }
  if (chatExists) return { id: sessionId, type: 'chat' }
  if (agentExists) return { id: sessionId, type: 'agent' }
  throw new Error('未找到对应的本地会话，请检查会话 ID')
}

function redactString(value: string): string {
  const limited = value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}\n[内容过长，已截断]`
    : value
  return STRING_REPLACEMENTS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    limited,
  )
}

export function sanitizeFeedbackValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[内容层级过深，已截断]'
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeFeedbackValue(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) items.push('[数组内容过多，已截断]')
    return items
  }
  if (!value || typeof value !== 'object') return value

  const entries = Object.entries(value as Record<string, unknown>)
  const result: Record<string, unknown> = {}
  for (const [key, childValue] of entries.slice(0, MAX_OBJECT_ENTRIES)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[已隐藏]'
      : sanitizeFeedbackValue(childValue, depth + 1)
  }
  if (entries.length > MAX_OBJECT_ENTRIES) {
    result._promaTruncated = '对象字段过多，已截断'
  }
  return result
}

function limitMessageSize(message: unknown): unknown {
  const serialized = JSON.stringify(message)
  if (serialized.length <= MAX_MESSAGE_JSON_LENGTH) return message

  const type = message && typeof message === 'object'
    ? (message as Record<string, unknown>).type
    : undefined
  return {
    type: typeof type === 'string' ? type : 'unknown',
    preview: redactString(serialized.slice(0, MAX_MESSAGE_JSON_LENGTH)),
    truncated: true,
  }
}

export function buildFeedbackTranscript(messages: unknown[]): FeedbackTranscript {
  const recentMessages = messages.slice(-MAX_TRANSCRIPT_MESSAGES)
  const included: unknown[] = []
  let serializedLength = 0

  for (const message of recentMessages) {
    const sanitized = limitMessageSize(sanitizeFeedbackValue(message))
    const length = JSON.stringify(sanitized).length
    if (serializedLength + length > MAX_TRANSCRIPT_JSON_LENGTH) break
    serializedLength += length
    included.push(sanitized)
  }

  return {
    messages: included,
    totalMessages: messages.length,
    includedMessages: included.length,
    truncated:
      messages.length > recentMessages.length
      || included.length < recentMessages.length,
  }
}
