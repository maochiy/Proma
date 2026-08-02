import type { SDKContentBlock, SDKMessage } from '@proma/shared'

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function normalizeContentBlock(block: SDKContentBlock): SDKContentBlock {
  const record = block as Record<string, unknown>
  if (
    record.type !== 'thinking'
    || record.thinking !== ''
    || typeof record.text !== 'string'
    || record.text.length === 0
  ) {
    return block
  }

  return {
    type: 'text',
    text: record.text,
  }
}

function normalizeCcbUserMessage(message: SDKMessage): SDKMessage {
  if (message.type !== 'user') return message

  const messageRecord = message as Record<string, unknown>
  const innerMessage = readRecord(messageRecord.message)
  if (!innerMessage || typeof innerMessage.content !== 'string') return message

  return {
    ...messageRecord,
    message: {
      ...innerMessage,
      content: [{
        type: 'text',
        text: innerMessage.content,
      }],
    },
  } as SDKMessage
}

/**
 * 将 CCB Runtime wire message 归一化为 Proma Renderer 使用的 SDKMessage。
 *
 * - CCB Transcript 的 user content 是字符串，Proma 使用标准 text blocks。
 * - DeepSeek v4 的正文 chunk 可能形成携带正文的非法空 thinking block。
 */
export function normalizeCcbMessage(message: SDKMessage): SDKMessage {
  const normalizedUserMessage = normalizeCcbUserMessage(message)
  if (normalizedUserMessage !== message) return normalizedUserMessage
  if (message.type !== 'assistant') return message

  const messageRecord = message as Record<string, unknown>
  const innerMessage = readRecord(messageRecord.message)
  if (!innerMessage || !Array.isArray(innerMessage.content)) return message

  let changed = false
  const content = (innerMessage.content as SDKContentBlock[]).map((block) => {
    const normalized = normalizeContentBlock(block)
    if (normalized !== block) changed = true
    return normalized
  })
  if (!changed) return message

  return {
    ...messageRecord,
    message: {
      ...innerMessage,
      content,
    },
  } as SDKMessage
}

/**
 * 兼容旧调用方。该入口现在会同时归一化 CCB user 与 assistant 消息。
 */
export function normalizeCcbAssistantMessage(message: SDKMessage): SDKMessage {
  return normalizeCcbMessage(message)
}
