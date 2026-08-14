/**
 * 用户反馈提交服务。
 *
 * 主进程负责读取本地会话、脱敏、截断并提交到独立反馈服务，
 * 避免渲染进程直接访问本地会话文件。
 */

import { app } from 'electron'
import type {
  FeedbackSessionType,
  FeedbackSubmitInput,
  FeedbackSubmitResult,
} from '@proma/shared'
import {
  getConversationMessages,
  listConversations,
} from './conversation-manager'
import {
  getAgentSessionSDKMessages,
  listAgentSessions,
} from './agent-session-manager'
import {
  buildFeedbackTranscript,
  resolveFeedbackSession,
  type ResolvedFeedbackSession,
} from './feedback-utils'

const DEFAULT_FEEDBACK_ENDPOINT =
  'https://consult-mumbling-provolone.ngrok-free.dev/api/feedback'
const REQUEST_TIMEOUT_MS = 20_000

interface FeedbackServiceResponse {
  success?: boolean
  feedbackId?: string
  createdAt?: string
  error?: string
}

interface ValidatedFeedbackInput {
  title: string
  content: string
  sessionId: string
  sessionType?: FeedbackSessionType
  includeTranscript: boolean
  locale?: string
}

function resolveFeedbackEndpoint(): string {
  const configured = process.env.PROMA_FEEDBACK_ENDPOINT?.trim()
  const endpoint = configured || DEFAULT_FEEDBACK_ENDPOINT
  const url = new URL(endpoint)
  const isLocalDevelopment =
    url.protocol === 'http:'
    && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (url.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error('反馈服务地址必须使用 HTTPS')
  }
  return url.toString()
}

function validateInput(input: FeedbackSubmitInput): ValidatedFeedbackInput {
  const title = input.title.trim()
  const content = input.content.trim()
  const sessionId = input.sessionId?.trim() || ''
  if (!title) throw new Error('反馈标题不能为空')
  if (title.length > 120) throw new Error('反馈标题不能超过 120 个字符')
  if (!content) throw new Error('反馈内容不能为空')
  if (content.length > 20_000) throw new Error('反馈内容不能超过 20000 个字符')
  if (!sessionId) throw new Error('会话 ID 不能为空')
  return {
    title,
    content,
    sessionId,
    sessionType: input.sessionType,
    includeTranscript: input.includeTranscript,
    locale: input.locale?.trim() || undefined,
  }
}

function readTranscript(
  session: ResolvedFeedbackSession,
): ReturnType<typeof buildFeedbackTranscript> {
  const messages = session.type === 'chat'
    ? getConversationMessages(session.id)
    : getAgentSessionSDKMessages(session.id)
  return buildFeedbackTranscript(messages)
}

export async function submitFeedback(
  rawInput: FeedbackSubmitInput,
): Promise<FeedbackSubmitResult> {
  const input = validateInput(rawInput)
  const session = resolveFeedbackSession(
    input.sessionId,
    input.sessionType,
    listConversations(),
    listAgentSessions(),
  )
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(resolveFeedbackEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `Proma/${app.getVersion()}`,
      },
      body: JSON.stringify({
        title: input.title,
        content: input.content,
        sessionId: session.id,
        sessionType: session.type,
        appVersion: app.getVersion(),
        platform: `${process.platform}-${process.arch}`,
        locale: input.locale,
        transcript: input.includeTranscript ? readTranscript(session) : undefined,
      }),
      signal: controller.signal,
    })

    const result = await response.json() as FeedbackServiceResponse
    if (!response.ok || !result.success || !result.feedbackId || !result.createdAt) {
      throw new Error(result.error || `反馈服务返回异常（${response.status}）`)
    }
    return {
      success: true,
      feedbackId: result.feedbackId,
      createdAt: result.createdAt,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('反馈提交超时，请确认反馈服务或 ngrok 正常运行')
    }
    if (error instanceof Error) throw error
    throw new Error('反馈提交失败')
  } finally {
    clearTimeout(timeout)
  }
}
