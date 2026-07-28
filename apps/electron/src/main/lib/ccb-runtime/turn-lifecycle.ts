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
