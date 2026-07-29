import type { SDKMessage } from '@proma/shared'

export interface RestoredAgentContextUsage {
  inputTokens: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  contextWindow?: number
  contextUsageIsEstimated: boolean
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function readUsage(value: unknown): Omit<RestoredAgentContextUsage, 'contextUsageIsEstimated'> | undefined {
  const usage = asRecord(value)
  if (!usage) return undefined
  const directInput = numberValue(usage.input_tokens)
  if (directInput == null) return undefined
  const cacheReadTokens = numberValue(usage.cache_read_input_tokens) ?? 0
  const cacheCreationTokens = numberValue(usage.cache_creation_input_tokens) ?? 0
  return {
    inputTokens: directInput + cacheReadTokens + cacheCreationTokens,
    outputTokens: numberValue(usage.output_tokens),
    cacheReadTokens,
    cacheCreationTokens,
  }
}

function readContextWindow(value: unknown): number | undefined {
  const usageByModel = asRecord(value)
  if (!usageByModel) return undefined
  let contextWindow: number | undefined
  for (const modelUsage of Object.values(usageByModel)) {
    const candidate = numberValue(asRecord(modelUsage)?.contextWindow)
    if (candidate == null) continue
    contextWindow = Math.max(contextWindow ?? 0, candidate)
  }
  return contextWindow
}

/**
 * 从 Proma 本地 SDKMessage 投影恢复最近一次上下文用量。
 *
 * 这只用于圆环冷启动水合，不参与 CCB 的模型上下文恢复。真正的执行上下文仍由
 * runtimeSessionId 对应的 CCB Transcript 通过 session.resume 加载。
 */
export function derivePersistedAgentContextUsage(
  messages: SDKMessage[],
): RestoredAgentContextUsage | undefined {
  let restored: RestoredAgentContextUsage | undefined
  let contextWindow: number | undefined
  let hasAssistantUsageInTurn = false
  let compactResultPending = false

  for (const message of messages) {
    const record = asRecord(message)
    if (!record) continue

    if (record.type === 'user' && record.parent_tool_use_id == null) {
      hasAssistantUsageInTurn = false
      continue
    }

    if (record.type === 'assistant' && record.parent_tool_use_id == null) {
      const usage = readUsage(asRecord(record.message)?.usage)
      if (!usage || usage.inputTokens <= 0) continue
      restored = {
        ...usage,
        contextWindow,
        contextUsageIsEstimated: false,
      }
      hasAssistantUsageInTurn = true
      compactResultPending = false
      continue
    }

    if (record.type === 'system' && record.subtype === 'compact_boundary') {
      const metadata = asRecord(record.compact_metadata)
      const postTokens =
        numberValue(record.compactionEstimatedTokensAfter)
        ?? numberValue(metadata?.post_tokens)
      if (postTokens != null && postTokens > 0) {
        restored = {
          inputTokens: postTokens,
          contextWindow,
          contextUsageIsEstimated: true,
        }
      }
      compactResultPending = true
      hasAssistantUsageInTurn = false
      continue
    }

    if (record.type !== 'result') continue

    const reportedWindow = readContextWindow(record.modelUsage)
    if (reportedWindow != null) {
      contextWindow = Math.max(contextWindow ?? 0, reportedWindow)
      if (restored) restored = { ...restored, contextWindow }
    }

    const isCompactionResult =
      compactResultPending || record.isSyntheticCompactionResult === true
    compactResultPending = false
    if (isCompactionResult || hasAssistantUsageInTurn) {
      hasAssistantUsageInTurn = false
      continue
    }

    const usage = readUsage(record.usage)
    if (usage && usage.inputTokens > 0) {
      restored = {
        ...usage,
        contextWindow,
        contextUsageIsEstimated: false,
      }
    }
    hasAssistantUsageInTurn = false
  }

  return restored
}
