import type { SDKContentBlock, SDKMessage } from '@proma/shared'

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : undefined
}

export function getAssistantModelMessageId(message: SDKMessage): string | undefined {
  if (message.type !== 'assistant') return undefined
  const innerMessage = readRecord((message as Record<string, unknown>).message)
  return typeof innerMessage?.id === 'string' ? innerMessage.id : undefined
}

function getAssistantBlocks(message: SDKMessage): SDKContentBlock[] {
  if (message.type !== 'assistant') return []
  const innerMessage = readRecord((message as Record<string, unknown>).message)
  return Array.isArray(innerMessage?.content)
    ? innerMessage.content as SDKContentBlock[]
    : []
}

function blocksMatch(
  partialBlock: SDKContentBlock,
  finalBlock: SDKContentBlock,
): boolean {
  if (partialBlock.type !== finalBlock.type) return false

  if (partialBlock.type === 'thinking' && finalBlock.type === 'thinking') {
    return partialBlock.thinking === finalBlock.thinking
  }

  if (partialBlock.type === 'text' && finalBlock.type === 'text') {
    return partialBlock.text === finalBlock.text
  }

  return partialBlock.type === 'tool_use'
    && finalBlock.type === 'tool_use'
    && partialBlock.id === finalBlock.id
}

function blocksHaveCompatibleKind(
  partialBlock: SDKContentBlock,
  finalBlock: SDKContentBlock,
): boolean {
  if (partialBlock.type !== finalBlock.type) return false
  if (partialBlock.type !== 'tool_use' || finalBlock.type !== 'tool_use') {
    return partialBlock.type === 'thinking' || partialBlock.type === 'text'
  }
  return partialBlock.id === finalBlock.id
}

function removeSupersededPartialMessages(
  current: SDKMessage[],
  incoming: SDKMessage,
): SDKMessage[] {
  const incomingRecord = incoming as Record<string, unknown>
  if (incoming.type !== 'assistant' || incomingRecord._partial === true) {
    return current
  }

  const incomingMessageId = getAssistantModelMessageId(incoming)
  const incomingBlocks = getAssistantBlocks(incoming)
  if (!incomingMessageId || incomingBlocks.length === 0) return current

  const candidates = current.filter((candidate) => {
    const candidateRecord = candidate as Record<string, unknown>
    return candidateRecord._partial === true
      && getAssistantModelMessageId(candidate) === incomingMessageId
  })
  if (candidates.length === 0) return current

  const indexedBlocks = Array.isArray(incomingRecord._partialBlockIndexes)
    ? incomingRecord._partialBlockIndexes.filter(
      (index): index is number => typeof index === 'number' && Number.isInteger(index),
    )
    : typeof incomingRecord._partialBlockIndex === 'number'
      && Number.isInteger(incomingRecord._partialBlockIndex)
      ? [incomingRecord._partialBlockIndex]
      : []

  if (indexedBlocks.length > 0) {
    const indexedBlockSet = new Set(indexedBlocks)
    const filtered = current.filter((candidate) => {
      const candidateRecord = candidate as Record<string, unknown>
      return !(
        candidateRecord._partial === true
        && getAssistantModelMessageId(candidate) === incomingMessageId
        && typeof candidateRecord._partialBlockIndex === 'number'
        && indexedBlockSet.has(candidateRecord._partialBlockIndex)
      )
    })
    if (filtered.length !== current.length) return filtered
  }

  const superseded = new Set<SDKMessage>()
  for (const incomingBlock of incomingBlocks) {
    const compatible = candidates.filter((candidate) =>
      getAssistantBlocks(candidate).some((partialBlock) =>
        blocksHaveCompatibleKind(partialBlock, incomingBlock)
      )
    )
    const exact = compatible.filter((candidate) =>
      getAssistantBlocks(candidate).some((partialBlock) =>
        blocksMatch(partialBlock, incomingBlock)
      )
    )

    if (exact.length > 0) {
      for (const candidate of exact) superseded.add(candidate)
    } else if (compatible.length === 1) {
      superseded.add(compatible[0]!)
    }
  }

  return superseded.size > 0
    ? current.filter((candidate) => !superseded.has(candidate))
    : current
}

/**
 * 合并实时 SDK 消息：
 * - 同 UUID 的 partial 使用最新累计快照覆盖；
 * - CCB 最终 assistant 到达时，移除同一模型消息/内容块的临时快照；
 * - 已存在的非 partial 消息保持去重。
 */
export function upsertAgentLiveMessage(
  current: SDKMessage[],
  incoming: SDKMessage,
): SDKMessage[] {
  const base = removeSupersededPartialMessages(current, incoming)
  const incomingRecord = incoming as Record<string, unknown>
  const incomingUuid = incomingRecord.uuid

  if (typeof incomingUuid === 'string' && incomingUuid.length > 0) {
    const existingIndex = base.findIndex((message) =>
      (message as Record<string, unknown>).uuid === incomingUuid
    )
    if (existingIndex >= 0) {
      const existing = base[existingIndex] as Record<string, unknown>
      if (incomingRecord._partial === true || existing._partial === true) {
        const next = [...base]
        next[existingIndex] = incoming
        return next
      }
      return base
    }
  }

  return [...base, incoming]
}
