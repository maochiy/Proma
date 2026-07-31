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

/**
 * 修复 CCB OpenAI 流适配器产生的非法 assistant 内容块。
 *
 * DeepSeek v4 的正文 chunk 可能继续携带 `reasoning_content: ""`。旧版 CCB
 * 会因此重开空 thinking block，并把同一 chunk 的 text_delta 写入该块，
 * 最终形成 `{ type: "thinking", thinking: "", text: "正文" }`。
 */
export function normalizeCcbAssistantMessage(message: SDKMessage): SDKMessage {
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
