import { describe, expect, test } from 'bun:test'
import { isParallelToolCallCancellation } from './tool-result-status'

describe('并行工具结果状态', () => {
  test('Given 兄弟 Bash 先失败 When SDK 返回 parallel tool call Cancelled Then 识别为级联取消', () => {
    expect(isParallelToolCallCancellation(
      '<tool_use_error>Cancelled: parallel tool call Bash(adb devices -l …) errored</tool_use_error>',
      true,
    )).toBe(true)
  })

  test('Given 当前 Bash 自身返回非零 When 判断工具结果 Then 保留真实错误状态', () => {
    expect(isParallelToolCallCancellation('Exit code 1', true)).toBe(false)
    expect(isParallelToolCallCancellation(
      '<tool_use_error>Cancelled: parallel tool call Bash(adb devices -l …) errored</tool_use_error>',
      false,
    )).toBe(false)
  })
})
