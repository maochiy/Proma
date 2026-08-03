const PARALLEL_TOOL_CALL_CANCELLATION =
  /^<tool_use_error>Cancelled: parallel tool call .+ errored<\/tool_use_error>$/s

/**
 * SDK 的并行工具批次采用 fail-fast。兄弟工具先失败时，当前工具会收到级联取消结果，
 * 它不是当前工具自身的执行错误，UI 应以中性“已取消”状态展示。
 */
export function isParallelToolCallCancellation(
  result: string | undefined,
  isError: boolean,
): boolean {
  return isError
    && typeof result === 'string'
    && PARALLEL_TOOL_CALL_CANCELLATION.test(result.trim())
}
