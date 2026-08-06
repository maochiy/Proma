import type { SDKContentBlock, SDKMessage } from '@proma/shared'
import { normalizeCcbAssistantMessage } from './ccb-assistant-message-normalization'

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
  if (rawBlock.type === 'tool_use') {
    const id = typeof rawBlock.id === 'string' ? rawBlock.id : ''
    const name = typeof rawBlock.name === 'string' ? rawBlock.name : ''
    if (!id || !name) return undefined

    let input: Record<string, unknown> = {}
    let inputJson: string | undefined
    if (typeof rawBlock.input === 'string') {
      inputJson = rawBlock.input
      try {
        const parsed = JSON.parse(rawBlock.input) as unknown
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          input = parsed as Record<string, unknown>
        }
      } catch {
        // 流式 JSON 尚未完整
      }
    } else if (typeof rawBlock.input === 'object' && rawBlock.input !== null) {
      input = rawBlock.input as Record<string, unknown>
    }

    return {
      index,
      content: {
        type: 'tool_use',
        id,
        name,
        input,
        ...(inputJson !== undefined ? { _inputJson: inputJson } : {}),
      } as SDKContentBlock,
    }
  }

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
    && 'thinking' in block.content
    && block.content.thinking === ''
    && delta.type === 'text_delta'
    && typeof delta.text === 'string'
    && delta.text.length > 0
  ) {
    return {
      ...block,
      content: {
        type: 'text',
        text: delta.text,
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

  if (
    block.content.type === 'tool_use'
    && delta.type === 'input_json_delta'
    && typeof delta.partial_json === 'string'
  ) {
    const current = block.content as {
      input?: unknown
      _inputJson?: unknown
      id: string
      name: string
      type: 'tool_use'
    }
    const previousJson = typeof current._inputJson === 'string'
      ? current._inputJson
      : typeof current.input === 'string'
        ? current.input
        : ''
    const nextJson = previousJson + delta.partial_json
    let parsedInput: Record<string, unknown> = (
      typeof current.input === 'object' && current.input !== null && !Array.isArray(current.input)
        ? current.input as Record<string, unknown>
        : {}
    )
    try {
      const parsed = JSON.parse(nextJson) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        parsedInput = parsed as Record<string, unknown>
      }
    } catch {
      // 流式 JSON 尚未完整，保留已解析部分
    }
    return {
      ...block,
      content: {
        type: 'tool_use',
        id: current.id,
        name: current.name,
        input: parsedInput,
        _inputJson: nextJson,
      } as SDKContentBlock,
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
  if (block.type === 'tool_use') {
    const tool = block as { id?: unknown; name?: unknown }
    return typeof tool.id === 'string'
      && tool.id.length > 0
      && typeof tool.name === 'string'
      && tool.name.length > 0
  }
  return false
}

/** 落盘 / 推给上层前清理流式内部字段 */
function sanitizeContentBlock(block: SDKContentBlock): SDKContentBlock {
  if (block.type !== 'tool_use') return block
  const record = { ...(block as Record<string, unknown>) }
  delete record._inputJson
  if (typeof record.input !== 'object' || record.input === null || Array.isArray(record.input)) {
    record.input = {}
  }
  return record as SDKContentBlock
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
      content: [sanitizeContentBlock(block.content)],
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

  if (streamedBlock.type === 'tool_use' && finalBlock.type === 'tool_use') {
    const left = streamedBlock as { id?: unknown }
    const right = finalBlock as { id?: unknown }
    return typeof left.id === 'string'
      && typeof right.id === 'string'
      && left.id.length > 0
      && left.id === right.id
  }

  return false
}

function blocksHaveCompatibleKind(
  streamedBlock: SDKContentBlock,
  finalBlock: SDKContentBlock,
): boolean {
  if (streamedBlock.type !== finalBlock.type) return false
  return streamedBlock.type === 'thinking'
    || streamedBlock.type === 'text'
    || streamedBlock.type === 'tool_use'
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
  const normalizedMessage = normalizeCcbAssistantMessage(message)
  const messageRecord = normalizedMessage as Record<string, unknown>
  if (normalizedMessage.type !== 'assistant' || messageRecord._partial === true) {
    return { state: previous, message: normalizedMessage }
  }

  const messageId = getAssistantMessageId(normalizedMessage)
  const finalBlocks = getAssistantBlocks(normalizedMessage)
  if (
    !messageId
    || messageId !== previous.messageId
    || finalBlocks.length === 0
    || previous.blocks.size === 0
  ) {
    return { state: previous, message: normalizedMessage }
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
  if (matchedIndexes.length === 0) {
    return { state: previous, message: normalizedMessage }
  }

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
      ...normalizedMessage,
      ...(matchedIndexes.length === 1
        ? { _partialBlockIndex: matchedIndexes[0] }
        : { _partialBlockIndexes: matchedIndexes }),
    } as unknown as SDKMessage,
  }
}

/**
 * 将 Turn 结束（尤其用户中断）时仍停留在 partial 状态的流式内容块，
 * 固化为一条可持久化的最终 assistant 消息。
 *
 * CCB 中断路径不会再补发完整 assistant 消息，编排器只会把收到的
 * 非 partial 消息落盘；若不在此固化，暂停瞬间尚未完成的过程正文/思考
 * 会直接从 JSONL 缺失，前端重建后正文整体丢失。
 */
export function finalizeCcbPartialAssistantMessage(
  previous: CcbPartialAssistantState,
): CcbPartialAssistantUpdate {
  const visibleBlocks = [...previous.blocks.values()]
    .filter((block) => hasVisibleContent(block.content))
    .sort((left, right) => left.index - right.index)

  if (!previous.messageId || visibleBlocks.length === 0) {
    return { state: previous }
  }

  const message: SDKMessage = {
    type: 'assistant',
    message: {
      id: previous.messageId,
      type: 'message',
      role: 'assistant',
      content: visibleBlocks.map((block) => sanitizeContentBlock(block.content)),
      ...(previous.model ? { model: previous.model } : {}),
      stop_reason: null,
      stop_sequence: null,
    },
    parent_tool_use_id: previous.parentToolUseId ?? null,
    ...(previous.sessionId ? { session_id: previous.sessionId } : {}),
    uuid: `ccb-finalized:${previous.messageId}`,
    ...(previous.createdAt ? { _createdAt: previous.createdAt } : {}),
  } as unknown as SDKMessage

  return {
    state: {
      ...previous,
      blocks: new Map(),
      completedBlockIndexes: new Set(),
    },
    message: normalizeCcbAssistantMessage(message),
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
    // deepseek 等 Provider 常把「过程正文」和后续 tool_use 拆成多条 assistant 消息。
    // 若下一条 message_start 直接重置 blocks，上一条尚未收到 final 的流式正文会从
    // adapter 状态里蒸发；用户暂停后编排器只能落盘 tool_use，UI 重建就丢了过程正文。
    // 因此在开启新消息前，先把仍可见的 partial 块固化为可落盘的最终消息。
    const finalizedPrevious = finalizeCcbPartialAssistantMessage(previous)
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
      ...(finalizedPrevious.message ? { message: finalizedPrevious.message } : {}),
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
