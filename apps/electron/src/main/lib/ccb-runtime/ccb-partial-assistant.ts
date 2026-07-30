import type { SDKContentBlock, SDKMessage } from '@proma/shared'

interface PartialAssistantBlock {
  index: number
  content: SDKContentBlock
}

export interface CcbPartialAssistantState {
  messageId?: string
  model?: string
  sessionId?: string
  parentToolUseId?: string | null
  createdAt?: number
  blocks: Map<number, PartialAssistantBlock>
  completedBlockIndexes: Set<number>
}

interface StreamEventMessage {
  type: 'stream_event'
  event?: Record<string, unknown>
  session_id?: string
  parent_tool_use_id?: string | null
}

export interface CcbPartialAssistantUpdate {
  state: CcbPartialAssistantState
  message?: SDKMessage
}

export function createCcbPartialAssistantState(): CcbPartialAssistantState {
  return {
    blocks: new Map(),
    completedBlockIndexes: new Set(),
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function readIndex(event: Record<string, unknown>): number | undefined {
  return typeof event.index === 'number' && Number.isInteger(event.index)
    ? event.index
    : undefined
}

function createBlock(
  index: number,
  rawBlock: Record<string, unknown>,
): PartialAssistantBlock | undefined {
  if (rawBlock.type === 'thinking') {
    return {
      index,
      content: {
        type: 'thinking',
        thinking: typeof rawBlock.thinking === 'string' ? rawBlock.thinking : '',
        ...(typeof rawBlock.signature === 'string'
          ? { signature: rawBlock.signature }
          : {}),
      },
    }
  }

  if (rawBlock.type === 'text') {
    return {
      index,
      content: {
        type: 'text',
        text: typeof rawBlock.text === 'string' ? rawBlock.text : '',
      },
    }
  }

  return undefined
}

function appendBlockDelta(
  block: PartialAssistantBlock,
  delta: Record<string, unknown>,
): PartialAssistantBlock {
  if (
    block.content.type === 'thinking'
    && delta.type === 'thinking_delta'
    && typeof delta.thinking === 'string'
  ) {
    return {
      ...block,
      content: {
        ...block.content,
        thinking: block.content.thinking + delta.thinking,
      },
    }
  }

  if (
    block.content.type === 'text'
    && delta.type === 'text_delta'
    && typeof delta.text === 'string'
  ) {
    return {
      ...block,
      content: {
        ...block.content,
        text: block.content.text + delta.text,
      },
    }
  }

  if (
    block.content.type === 'thinking'
    && delta.type === 'signature_delta'
    && typeof delta.signature === 'string'
  ) {
    return {
      ...block,
      content: {
        ...block.content,
        signature: delta.signature,
      },
    }
  }

  return block
}

function createBlockFromDelta(
  index: number,
  delta: Record<string, unknown>,
): PartialAssistantBlock | undefined {
  if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
    return {
      index,
      content: {
        type: 'thinking',
        thinking: delta.thinking,
      },
    }
  }

  if (delta.type === 'text_delta' && typeof delta.text === 'string') {
    return {
      index,
      content: {
        type: 'text',
        text: delta.text,
      },
    }
  }

  return undefined
}

function hasVisibleContent(block: SDKContentBlock): boolean {
  if (
    block.type === 'thinking'
    && 'thinking' in block
    && typeof block.thinking === 'string'
  ) {
    return block.thinking.length > 0
  }
  if (
    block.type === 'text'
    && 'text' in block
    && typeof block.text === 'string'
  ) {
    return block.text.length > 0
  }
  return false
}

function createPartialMessage(
  state: CcbPartialAssistantState,
  block: PartialAssistantBlock,
): SDKMessage | undefined {
  if (!state.messageId || !hasVisibleContent(block.content)) return undefined

  return {
    type: 'assistant',
    message: {
      id: state.messageId,
      type: 'message',
      role: 'assistant',
      content: [block.content],
      ...(state.model ? { model: state.model } : {}),
      stop_reason: null,
      stop_sequence: null,
    },
    parent_tool_use_id: state.parentToolUseId ?? null,
    ...(state.sessionId ? { session_id: state.sessionId } : {}),
    uuid: `ccb-partial:${state.messageId}:${block.index}`,
    _partial: true,
    _partialBlockIndex: block.index,
    ...(state.createdAt ? { _createdAt: state.createdAt } : {}),
  } as SDKMessage
}

function blocksMatch(
  streamedBlock: SDKContentBlock,
  finalBlock: SDKContentBlock,
): boolean {
  if (streamedBlock.type !== finalBlock.type) return false

  if (streamedBlock.type === 'thinking' && finalBlock.type === 'thinking') {
    return streamedBlock.thinking === finalBlock.thinking
  }

  if (streamedBlock.type === 'text' && finalBlock.type === 'text') {
    return streamedBlock.text === finalBlock.text
  }

  return false
}

function blocksHaveCompatibleKind(
  streamedBlock: SDKContentBlock,
  finalBlock: SDKContentBlock,
): boolean {
  return streamedBlock.type === finalBlock.type
    && (streamedBlock.type === 'thinking' || streamedBlock.type === 'text')
}

function getAssistantMessageId(message: SDKMessage): string | undefined {
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

function findMatchingBlockIndex(
  state: CcbPartialAssistantState,
  finalBlock: SDKContentBlock,
  consumedIndexes: Set<number>,
): number | undefined {
  const candidateIndexes = [...state.blocks.keys()]
    .filter(index => !consumedIndexes.has(index))
    .sort((left, right) => {
      const leftCompleted = state.completedBlockIndexes.has(left)
      const rightCompleted = state.completedBlockIndexes.has(right)
      if (leftCompleted !== rightCompleted) return leftCompleted ? -1 : 1
      return left - right
    })

  const exactIndexes = candidateIndexes.filter(index => {
    const candidate = state.blocks.get(index)
    return candidate ? blocksMatch(candidate.content, finalBlock) : false
  })
  if (exactIndexes.length > 0) return exactIndexes[0]

  const compatibleIndexes = candidateIndexes.filter(index => {
    const candidate = state.blocks.get(index)
    return candidate
      ? blocksHaveCompatibleKind(candidate.content, finalBlock)
      : false
  })
  return compatibleIndexes.length === 1 ? compatibleIndexes[0] : undefined
}

/**
 * 为 CCB Runtime 的最终 assistant 消息补充对应的流式内容块索引。
 * Renderer 可据此精确移除 partial 快照；内容匹配仅作为旧消息兼容兜底。
 */
export function annotateCcbFinalAssistantMessage(
  previous: CcbPartialAssistantState,
  message: SDKMessage,
): CcbPartialAssistantUpdate {
  const messageRecord = message as Record<string, unknown>
  if (message.type !== 'assistant' || messageRecord._partial === true) {
    return { state: previous, message }
  }

  const messageId = getAssistantMessageId(message)
  const finalBlocks = getAssistantBlocks(message)
  if (
    !messageId
    || messageId !== previous.messageId
    || finalBlocks.length === 0
    || previous.blocks.size === 0
  ) {
    return { state: previous, message }
  }

  const matchedIndexes: number[] = []
  const consumedIndexes = new Set<number>()
  for (const finalBlock of finalBlocks) {
    const matchedIndex = findMatchingBlockIndex(
      previous,
      finalBlock,
      consumedIndexes,
    )
    if (matchedIndex === undefined) continue
    matchedIndexes.push(matchedIndex)
    consumedIndexes.add(matchedIndex)
  }
  if (matchedIndexes.length === 0) return { state: previous, message }

  const blocks = new Map(previous.blocks)
  const completedBlockIndexes = new Set(previous.completedBlockIndexes)
  for (const matchedIndex of matchedIndexes) {
    blocks.delete(matchedIndex)
    completedBlockIndexes.delete(matchedIndex)
  }

  return {
    state: {
      ...previous,
      blocks,
      completedBlockIndexes,
    },
    message: {
      ...message,
      ...(matchedIndexes.length === 1
        ? { _partialBlockIndex: matchedIndexes[0] }
        : { _partialBlockIndexes: matchedIndexes }),
    } as unknown as SDKMessage,
  }
}

/**
 * 将 CCB Runtime 的原始 stream_event 累积为前端可直接渲染的 assistant 快照。
 * 每个 content block 使用稳定 UUID，后续 delta 会覆盖同一条实时消息。
 */
export function applyCcbPartialAssistantEvent(
  previous: CcbPartialAssistantState,
  message: SDKMessage,
): CcbPartialAssistantUpdate {
  if (message.type !== 'stream_event') return { state: previous }

  const streamMessage = message as StreamEventMessage
  const event = streamMessage.event
  if (!event || typeof event.type !== 'string') return { state: previous }

  if (event.type === 'message_start') {
    const startedMessage = readRecord(event.message)
    return {
      state: {
        messageId: typeof startedMessage?.id === 'string'
          ? startedMessage.id
          : undefined,
        model: typeof startedMessage?.model === 'string'
          ? startedMessage.model
          : undefined,
        sessionId: streamMessage.session_id,
        parentToolUseId: streamMessage.parent_tool_use_id,
        createdAt: Date.now(),
        blocks: new Map(),
        completedBlockIndexes: new Set(),
      },
    }
  }

  if (event.type === 'message_stop') {
    // 最终 assistant 消息可能在 message_stop 之后才到达，保留内容块映射，
    // 等终态消息完成索引标注；下一次 message_start 会重置状态。
    return { state: previous }
  }

  const index = readIndex(event)
  if (index === undefined) return { state: previous }

  if (event.type === 'content_block_start') {
    const rawBlock = readRecord(event.content_block)
    if (!rawBlock) return { state: previous }
    const block = createBlock(index, rawBlock)
    if (!block) return { state: previous }

    const blocks = new Map(previous.blocks)
    blocks.set(index, block)
    const state = { ...previous, blocks }
    return {
      state,
      message: createPartialMessage(state, block),
    }
  }

  if (event.type === 'content_block_delta') {
    const delta = readRecord(event.delta)
    if (!delta) return { state: previous }

    const current = previous.blocks.get(index)
    const block = current
      ? appendBlockDelta(current, delta)
      : createBlockFromDelta(index, delta)
    if (!block || block === current) return { state: previous }

    const blocks = new Map(previous.blocks)
    blocks.set(index, block)
    const state = { ...previous, blocks }
    return {
      state,
      message: createPartialMessage(state, block),
    }
  }

  if (event.type === 'content_block_stop') {
    if (!previous.blocks.has(index)) return { state: previous }
    const completedBlockIndexes = new Set(previous.completedBlockIndexes)
    completedBlockIndexes.add(index)
    return { state: { ...previous, completedBlockIndexes } }
  }

  return { state: previous }
}
