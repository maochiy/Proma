/**
 * CCB Session Worker 自动恢复策略。
 *
 * 空闲回收 / 进程退出后，应 resume 同一 runtimeSessionId 恢复会话，
 * 而不是清空上下文或冷启动。
 */

/** 判断 Turn 启动失败后是否应强制 resume 恢复，而不是清空会话上下文。 */
export function shouldRecoverSessionWorker(errorMessage: string): boolean {
  return (
    errorMessage.includes('Session 尚未打开')
    || errorMessage.includes('CCB Runtime 请求超时: turn.start')
    || errorMessage.includes('CCB Runtime 请求超时: session.compact')
  )
}
