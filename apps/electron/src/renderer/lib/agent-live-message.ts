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

/**
 * 按 IPC 到达顺序合并一批实时消息。
 *
 * 渲染层会在短时间窗口内合帧，批量更新不能直接使用最后一条消息覆盖，
 * 必须逐条应用 upsert 规则，才能同时保留不同消息并正确处理 partial/final。
 */
export function mergeAgentLiveMessages(
  current: SDKMessage[],
  incoming: SDKMessage[],
): SDKMessage[] {
  return incoming.reduce(
    (messages, message) => upsertAgentLiveMessage(messages, message),
    current,
  )
}


/**
 * 合并持久化消息与 liveMessages。
 * 关键约束：暂停后残留的上一轮 live 内容，不能被拼到新用户消息之后。
 */
export function mergePersistedAndLiveMessages(
  persisted: SDKMessage[],
  live: SDKMessage[],
  options?: {
    identityOf?: (message: SDKMessage) => string
  },
): SDKMessage[] {
  if (live.length === 0) return persisted
  if (persisted.length === 0) return live

  const identityOf = options?.identityOf ?? ((message: SDKMessage) => {
    const record = message as Record<string, unknown>
    if (typeof record.uuid === 'string' && record.uuid.length > 0) {
      return `${message.type}:uuid:${record.uuid}`
    }
    if (message.type === 'assistant') {
      const inner = record.message as { id?: unknown } | undefined
      if (inner && typeof inner.id === 'string' && inner.id.length > 0) {
        return `assistant:model:${inner.id}`
      }
    }
    const createdAt = typeof record._createdAt === 'number' ? record._createdAt : 'na'
    return `${message.type}:${createdAt}:${JSON.stringify(record.message ?? record.subtype ?? '')}`
  })
  const createdAtOf = (message: SDKMessage): number | undefined => {
    const value = (message as Record<string, unknown>)._createdAt
    return typeof value === 'number' ? value : undefined
  }

  const seen = new Set<string>()
  const uniquePersisted: SDKMessage[] = []
  for (const message of persisted) {
    const identity = identityOf(message)
    if (seen.has(identity)) continue
    seen.add(identity)
    uniquePersisted.push(message)
  }

  const liveOnly: SDKMessage[] = []
  for (const message of live) {
    const identity = identityOf(message)
    if (seen.has(identity)) continue
    if (
      message.type === 'result'
      && (message as { subtype?: string }).subtype === 'interrupted'
      && uniquePersisted.some((item) =>
        item.type === 'result'
        && (item as { subtype?: string }).subtype === 'interrupted',
      )
    ) {
      continue
    }
    seen.add(identity)
    liveOnly.push(message)
  }

  if (liveOnly.length === 0) return uniquePersisted

  const merged: SDKMessage[] = []
  let persistedIndex = 0
  let liveIndex = 0
  while (persistedIndex < uniquePersisted.length && liveIndex < liveOnly.length) {
    const persistedMessage = uniquePersisted[persistedIndex]!
    const liveMessage = liveOnly[liveIndex]!
    const persistedAt = createdAtOf(persistedMessage)
    const liveAt = createdAtOf(liveMessage)
    if (liveAt != null && (persistedAt == null || liveAt < persistedAt)) {
      merged.push(liveMessage)
      liveIndex += 1
    } else {
      merged.push(persistedMessage)
      persistedIndex += 1
    }
  }
  if (persistedIndex < uniquePersisted.length) {
    merged.push(...uniquePersisted.slice(persistedIndex))
  }
  if (liveIndex < liveOnly.length) {
    merged.push(...liveOnly.slice(liveIndex))
  }
  return merged
}


function extractAssistantNarrativeFingerprints(message: SDKMessage): string[] {
  if (message.type !== 'assistant') return []
  const messageId = getAssistantModelMessageId(message) ?? ''
  const fingerprints: string[] = []
  for (const block of getAssistantBlocks(message)) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      fingerprints.push(`${messageId}::text:${block.text}`)
    }
    if (
      block.type === 'thinking'
      && typeof (block as { thinking?: unknown }).thinking === 'string'
      && (block as { thinking: string }).thinking.trim()
    ) {
      fingerprints.push(`${messageId}::thinking:${(block as { thinking: string }).thinking}`)
    }
  }
  return fingerprints
}

/**
 * 用户暂停后：live 是否仍有 JSONL 未覆盖的过程正文/思考。
 * 有则应保留 live，避免「有任意 assistant 就清 live」导致正文蒸发。
 */
export function hasUnpersistedLiveAssistantNarrative(
  liveMessages: SDKMessage[],
  persistedMessages: SDKMessage[],
): boolean {
  const persisted = new Set<string>()
  for (const message of persistedMessages) {
    for (const fp of extractAssistantNarrativeFingerprints(message)) {
      persisted.add(fp)
    }
  }
  for (const message of liveMessages) {
    for (const fp of extractAssistantNarrativeFingerprints(message)) {
      if (!persisted.has(fp)) return true
    }
  }
  return false
}
