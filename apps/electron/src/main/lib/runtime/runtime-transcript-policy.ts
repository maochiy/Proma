import type { RuntimeId } from '@proma/shared'

/**
 * 旧版会话没有 runtimeId，只能按历史 CCB 会话处理。
 * 当前 Pi / Hermes / Codex / Claude 会话都应直接使用 Proma 本地 JSONL 投影，
 * 不能再请求 CCB Transcript。
 */
export function shouldSyncLegacyCcbTranscript(runtimeId: RuntimeId | undefined): boolean {
  return runtimeId === undefined
}
