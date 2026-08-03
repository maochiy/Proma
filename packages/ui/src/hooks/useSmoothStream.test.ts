import { describe, expect, test } from 'bun:test'
import { shouldScheduleSmoothStreamFrame } from './useSmoothStream.ts'

describe('shouldScheduleSmoothStreamFrame', () => {
  test('Given 流仍在进行但字符队列为空 When 判断是否调度下一帧 Then 不应继续空转', () => {
    expect(shouldScheduleSmoothStreamFrame(0, false)).toBe(false)
  })

  test('Given 新字符已进入队列且当前没有待执行帧 When 判断是否调度 Then 应唤醒渲染循环', () => {
    expect(shouldScheduleSmoothStreamFrame(1, false)).toBe(true)
  })

  test('Given 已存在待执行帧 When 新字符继续进入队列 Then 不应重复调度', () => {
    expect(shouldScheduleSmoothStreamFrame(1, true)).toBe(false)
  })
})
