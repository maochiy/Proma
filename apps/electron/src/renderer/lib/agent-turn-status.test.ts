import { describe, expect, test } from 'bun:test'
import { formatTurnDuration } from './agent-turn-status'

describe('formatTurnDuration', () => {
  test('Given 不足 1 秒的有效耗时 When 格式化 Then 至少显示 1 秒', () => {
    expect(formatTurnDuration(1)).toBe('1 秒')
    expect(formatTurnDuration(172)).toBe('1 秒')
    expect(formatTurnDuration(499)).toBe('1 秒')
    expect(formatTurnDuration(500)).toBe('1 秒')
    expect(formatTurnDuration(999)).toBe('1 秒')
  })

  test('Given 整秒耗时 When 格式化 Then 按秒显示', () => {
    expect(formatTurnDuration(1_000)).toBe('1 秒')
    expect(formatTurnDuration(1_499)).toBe('1 秒')
    expect(formatTurnDuration(1_500)).toBe('2 秒')
    expect(formatTurnDuration(32_000)).toBe('32 秒')
  })

  test('Given 超过 1 分钟 When 格式化 Then 显示分秒', () => {
    expect(formatTurnDuration(60_000)).toBe('1 分钟')
    expect(formatTurnDuration(61_000)).toBe('1 分 1 秒')
    expect(formatTurnDuration(125_000)).toBe('2 分 5 秒')
  })

  test('Given 0 耗时 When 格式化 Then 至少显示 1 秒；无效值显示 0 秒', () => {
    expect(formatTurnDuration(0)).toBe('1 秒')
    expect(formatTurnDuration(-10)).toBe('0 秒')
    expect(formatTurnDuration(Number.NaN)).toBe('0 秒')
  })
})
