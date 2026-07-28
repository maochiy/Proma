import type { SDKMessage } from '@proma/shared'

export interface PendingTurnResult {
  pendingResult?: SDKMessage
}

/**
 * CCB 的 result SDKMessage 必须等待 turn.completed 再交给上层。
 *
 * 返回 true 表示消息已被暂存，调用方不应立即推送。
 */
export function deferTurnResultMessage(
  turn: PendingTurnResult | undefined,
  message: SDKMessage,
): boolean {
  if (message.type !== 'result' || !turn) return false
  turn.pendingResult = message
  return true
}

/** 选择 turn.completed 携带的结果；缺失时回退到先前暂存的 SDKMessage。 */
export function resolveCompletedTurnResult(
  turn: PendingTurnResult | undefined,
  completedResult?: SDKMessage,
): SDKMessage | undefined {
  return completedResult ?? turn?.pendingResult
}

/**
 * 释放指定 Turn 后再通知消费方。
 *
 * 完成通知会立即唤醒异步迭代器，因此 active 标记必须先删除，避免下一轮发送
 * 在旧 run 的 finally 执行前被误判为并发 Turn。
 */
export function releaseTurnBeforeNotify<T>(
  activeTurns: Map<string, T>,
  sessionId: string,
  turn: T,
  notify: () => void,
): void {
  if (activeTurns.get(sessionId) === turn) {
    activeTurns.delete(sessionId)
  }
  notify()
}
