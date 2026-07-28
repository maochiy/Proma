/** 标题生成 Prompt */
export const TITLE_PROMPT = '根据用户的第一条消息，生成一个简短的对话标题（10字以内）。只输出标题，不要有任何其他内容、标点符号或引号。如果消息内容过短或无明确主题，直接使用原始消息作为标题。\n\n用户消息：'

/** 短消息阈值：低于此长度直接使用原文作为标题 */
export const SHORT_MESSAGE_THRESHOLD = 4

/** 最大标题长度 */
export const MAX_TITLE_LENGTH = 20

const TITLE_PUNCTUATION = /^["'“”‘’「《]+|["'“”‘’」》]+$/g
const MARKDOWN_PREFIX = /^(?:[#>*\-\d.)]\s*)+/
const WHITESPACE = /\s+/g
const INLINE_WHITESPACE = /[^\S\r\n]+/g
const RUNTIME_CONTEXT_BLOCKS =
  /<(?:workspace_state|working_directory)>[\s\S]*?<\/(?:workspace_state|working_directory)>/gi
const CURRENT_TIME_PREFIX = /^\s*\*\*当前时间:[^\n]*\*\*\s*/i

/** 判断字符串是否仍包含 Proma 仅供 Runtime 使用的动态上下文。 */
export function hasRuntimePromptContext(userMessage: string): boolean {
  return (
    CURRENT_TIME_PREFIX.test(userMessage)
    || /<(?:workspace_state|working_directory)>/i.test(userMessage)
  )
}

/** 移除 Proma 注入给 CCB 的动态上下文，只保留用户真正输入的任务。 */
export function stripRuntimePromptContext(userMessage: string): string {
  return userMessage
    .replace(CURRENT_TIME_PREFIX, '')
    .replace(RUNTIME_CONTEXT_BLOCKS, '\n')
    .split(/\r?\n/)
    .map(line => line.replace(INLINE_WHITESPACE, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** 清理模型返回的标题。 */
export function sanitizeGeneratedTitle(title: string): string | null {
  const cleaned = title.trim().replace(TITLE_PUNCTUATION, '').trim()
  return cleaned.slice(0, MAX_TITLE_LENGTH) || null
}

/**
 * 无法调用标题模型时，基于首条用户消息生成一个稳定兜底标题。
 *
 * Agent 标题不旁路调用其它 Provider，避免桌面投影与 CCB 执行配置分叉。
 */
export function createFallbackTitle(userMessage: string): string | null {
  const cleanUserMessage = stripRuntimePromptContext(userMessage)
  const firstLine = cleanUserMessage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?? cleanUserMessage

  const cleaned = firstLine
    .replace(MARKDOWN_PREFIX, '')
    .replace(WHITESPACE, ' ')
    .trim()

  return cleaned.slice(0, MAX_TITLE_LENGTH) || null
}

/**
 * 将 CCB Transcript 的标题投影为桌面会话标题。
 *
 * 与自动标题不同，这里允许更长文本，目的是保留 CCB CLI 原会话的可辨识度，
 * 同时避免把时间、workspace_state、working_directory 等内部上下文显示在侧边栏。
 */
export function createRuntimeSessionProjectionTitle(
  runtimeTitle: string,
): string | null {
  const cleaned = stripRuntimePromptContext(runtimeTitle)
    .replace(MARKDOWN_PREFIX, '')
    .replace(WHITESPACE, ' ')
    .trim()

  return cleaned.slice(0, 80) || null
}
