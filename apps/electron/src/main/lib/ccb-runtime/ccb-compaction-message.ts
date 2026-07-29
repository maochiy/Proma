import { randomUUID } from 'node:crypto'
import type { SDKMessage, SDKSystemMessage } from '@proma/shared'

interface CcbCompactMetadataRecord {
  trigger?: unknown
  pre_tokens?: unknown
  post_tokens?: unknown
  summary?: unknown
}

function isCompactTrigger(value: unknown): value is 'manual' | 'auto' {
  return value === 'manual' || value === 'auto'
}

/** 将 CCB compact_boundary 的原生元数据补齐到 Proma 现有 SDKMessage 兼容字段。 */
export function normalizeCcbCompactionMessage(
  message: SDKMessage,
  compactRequested: boolean,
): SDKMessage {
  if (message.type === 'result' && compactRequested) {
    return {
      ...message,
      // /compact 的 result.usage 是压缩调用本身的累计用量，不代表压缩后的
      // 当前上下文。Renderer 必须保留 compact_boundary 回传的 post_tokens。
      isSyntheticCompactionResult: true,
    }
  }
  if (message.type !== 'system') return message
  const systemMessage = message as SDKSystemMessage
  if (systemMessage.subtype === 'status' && systemMessage.status === 'compacting') {
    return {
      ...systemMessage,
      compactTrigger: compactRequested ? 'manual' : 'auto',
    }
  }
  if (systemMessage.subtype !== 'compact_boundary') return message

  const metadata = (systemMessage.compact_metadata ?? {}) as CcbCompactMetadataRecord
  const trigger = isCompactTrigger(metadata.trigger)
    ? metadata.trigger
    : compactRequested ? 'manual' : 'auto'
  return {
    ...systemMessage,
    compactTrigger: trigger,
    ...(typeof metadata.pre_tokens === 'number' && { compactPreTokens: metadata.pre_tokens }),
    ...(typeof metadata.post_tokens === 'number' && {
      compactionEstimatedTokensAfter: metadata.post_tokens,
    }),
    ...(typeof metadata.summary === 'string' && metadata.summary.length > 0 && {
      summary: metadata.summary,
    }),
  }
}

/** 将 CCB Runtime 的动态压缩阈值转换为 Renderer 可复用的 SDK system 消息。 */
export function createContextCompactionConfigMessage(
  data: Record<string, unknown> | undefined,
  sessionId: string,
): SDKMessage | undefined {
  if (!data) return undefined
  const enabled = data.autoCompactEnabled
  const threshold = data.autoCompactThreshold
  const effectiveWindow = data.effectiveContextWindow
  if (
    typeof enabled !== 'boolean'
    || typeof threshold !== 'number'
    || typeof effectiveWindow !== 'number'
  ) return undefined

  return {
    type: 'system',
    subtype: 'context_compaction_config',
    session_id: sessionId,
    uuid: randomUUID(),
    autoCompactEnabled: enabled,
    autoCompactThreshold: threshold,
    effectiveContextWindow: effectiveWindow,
  } as SDKSystemMessage
}
