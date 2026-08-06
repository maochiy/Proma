import type { SDKMessage, SDKToolUseBlock } from '@proma/shared'

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function extractToolResultIds(message: SDKMessage): string[] {
  if (message.type !== 'user') return []
  const content = (message as {
    message?: { content?: Array<{ type?: unknown; tool_use_id?: unknown }> }
  }).message?.content
  if (!Array.isArray(content)) return []
  const ids: string[] = []
  for (const block of content) {
    if (
      block?.type === 'tool_result'
      && typeof block.tool_use_id === 'string'
      && block.tool_use_id.length > 0
    ) {
      ids.push(block.tool_use_id)
    }
  }
  return ids
}

function extractAssistantToolUseIds(message: SDKMessage): string[] {
  if (message.type !== 'assistant') return []
  const content = (message as {
    message?: { content?: Array<{ type?: unknown; id?: unknown }> }
  }).message?.content
  if (!Array.isArray(content)) return []
  const ids: string[] = []
  for (const block of content) {
    if (
      block?.type === 'tool_use'
      && typeof block.id === 'string'
      && block.id.length > 0
    ) {
      ids.push(block.id)
    }
  }
  return ids
}

function getToolResultContent(message: SDKMessage, toolUseId: string): string {
  if (message.type !== 'user') return ''
  const content = (message as {
    message?: { content?: Array<{ type?: unknown; tool_use_id?: unknown; content?: unknown }> }
  }).message?.content
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block?.type !== 'tool_result' || block.tool_use_id !== toolUseId) continue
    if (typeof block.content === 'string') return block.content
    if (Array.isArray(block.content)) {
      return block.content
        .map((item) => {
          const record = readRecord(item)
          return typeof record?.text === 'string' ? record.text : ''
        })
        .filter(Boolean)
        .join('\n')
    }
  }
  return ''
}

/**
 * 从 tool_result / tool_use_result 反推缺失的 tool_use 投影。
 * 仅用于持久化补齐与展示，不修改原始 wire 语义。
 */
export function inferToolUseFromResult(
  toolUseId: string,
  options: {
    structuredResult?: Record<string, unknown>
    contentText?: string
  } = {},
): SDKToolUseBlock {
  const structured = options.structuredResult
  const contentText = options.contentText ?? ''

  const file = readRecord(structured?.file)
  if (typeof file?.filePath === 'string') {
    const startLine = typeof file.startLine === 'number' ? file.startLine + 1 : undefined
    return {
      type: 'tool_use',
      id: toolUseId,
      name: 'Read',
      input: {
        file_path: file.filePath,
        ...(startLine !== undefined ? { offset: startLine } : {}),
        ...(typeof file.numLines === 'number' ? { limit: file.numLines } : {}),
      },
    }
  }

  if (typeof structured?.filePath === 'string') {
    return {
      type: 'tool_use',
      id: toolUseId,
      name: 'Edit',
      input: {
        file_path: structured.filePath,
        ...(typeof structured.oldString === 'string' ? { old_string: structured.oldString } : {}),
        ...(typeof structured.newString === 'string' ? { new_string: structured.newString } : {}),
      },
    }
  }

  if (
    typeof structured?.stdout === 'string'
    || typeof structured?.stderr === 'string'
  ) {
    return {
      type: 'tool_use',
      id: toolUseId,
      name: 'Bash',
      input: typeof structured.command === 'string' ? { command: structured.command } : {},
    }
  }

  if (typeof structured?.query === 'string' && Array.isArray(structured.results)) {
    return {
      type: 'tool_use',
      id: toolUseId,
      name: 'WebSearch',
      input: { query: structured.query },
    }
  }

  if (typeof structured?.url === 'string') {
    return {
      type: 'tool_use',
      id: toolUseId,
      name: 'WebFetch',
      input: { url: structured.url },
    }
  }

  if (Array.isArray(structured?.filenames)) {
    const mode = structured.mode
    return {
      type: 'tool_use',
      id: toolUseId,
      name: mode === 'content' || typeof structured.content === 'string' ? 'Grep' : 'Glob',
      input: {},
    }
  }

  // 纯文本结果启发式（CCB 常只回传 content 字符串）
  if (/^Found\s+\d+\s+files?\b/i.test(contentText)) {
    return { type: 'tool_use', id: toolUseId, name: 'Glob', input: {} }
  }
  if (/^total\s+\d+\b/m.test(contentText) || /^[d\-][rwx\-]{9}\b/m.test(contentText)) {
    return { type: 'tool_use', id: toolUseId, name: 'Bash', input: {} }
  }
  if (/^\d+\t/.test(contentText)) {
    return { type: 'tool_use', id: toolUseId, name: 'Read', input: {} }
  }
  if (
    contentText.includes('\n')
    && contentText
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .every((line) => line.includes('/') || line.includes('\\'))
  ) {
    return { type: 'tool_use', id: toolUseId, name: 'Glob', input: {} }
  }

  return {
    type: 'tool_use',
    id: toolUseId,
    name: 'Tool',
    input: {},
  }
}

function createSyntheticToolUseAssistant(
  toolUse: SDKToolUseBlock,
  source: SDKMessage,
): SDKMessage {
  const sourceRecord = source as Record<string, unknown>
  const parent = typeof sourceRecord.parent_tool_use_id === 'string'
    ? sourceRecord.parent_tool_use_id
    : null
  const sessionId = typeof sourceRecord.session_id === 'string'
    ? sourceRecord.session_id
    : undefined

  return {
    type: 'assistant',
    message: {
      id: `synthetic-tool-use:${toolUse.id}`,
      type: 'message',
      role: 'assistant',
      content: [toolUse],
      stop_reason: 'tool_use',
      stop_sequence: null,
    },
    parent_tool_use_id: parent,
    ...(sessionId ? { session_id: sessionId } : {}),
    uuid: `synthetic-tool-use:${toolUse.id}`,
    _createdAt: typeof sourceRecord._createdAt === 'number'
      ? sourceRecord._createdAt
      : Date.now(),
    _syntheticToolUse: true,
  } as unknown as SDKMessage
}

/**
 * 若 tool_result 先于 / 缺失对应 tool_use，则在结果前补一条可落盘的 assistant(tool_use)。
 * 修复 deepseek 等 CCB Provider 只回 tool_result、中断后活动轨迹塌缩成一行的问题。
 */
export function collectKnownToolUseIds(messages: SDKMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    for (const id of extractAssistantToolUseIds(message)) ids.add(id)
  }
  return ids
}

export function backfillMissingToolUsesForUserMessage(
  message: SDKMessage,
  knownToolUseIds: Set<string>,
): SDKMessage[] {
  if (message.type !== 'user') return []

  const missingIds = extractToolResultIds(message)
    .filter((id) => !knownToolUseIds.has(id))
  if (missingIds.length === 0) return []

  const raw = message as Record<string, unknown>
  const structured = readRecord(raw.toolUseResult ?? raw.tool_use_result)
  const synthesized: SDKMessage[] = []

  for (const toolUseId of missingIds) {
    knownToolUseIds.add(toolUseId)
    const contentText = getToolResultContent(message, toolUseId)
    const toolUse = inferToolUseFromResult(toolUseId, {
      structuredResult: structured,
      contentText,
    })
    synthesized.push(createSyntheticToolUseAssistant(toolUse, message))
  }

  return synthesized
}
