import { describe, expect, test } from 'bun:test'
import { releaseTurnBeforeNotify } from './turn-lifecycle'

describe('CCB Turn 完成生命周期', () => {
  test('Given Turn 已完成 When 通知异步消息流结束 Then 必须先释放 active 以允许立即发送下一轮', () => {
    const activeTurns = new Map<string, object>()
    const completedTurn = {}
    activeTurns.set('session-1', completedTurn)

    let nextTurnAccepted = false
    releaseTurnBeforeNotify(
      activeTurns,
      'session-1',
      completedTurn,
      () => {
        if (!activeTurns.has('session-1')) {
          activeTurns.set('session-1', {})
          nextTurnAccepted = true
        }
      },
    )

    expect(nextTurnAccepted).toBe(true)
    expect(activeTurns.has('session-1')).toBe(true)
  })

  test('Given 旧 Turn 延迟完成 When 新 Turn 已占用同一会话 Then 不得删除新 Turn', () => {
    const oldTurn = {}
    const newTurn = {}
    const activeTurns = new Map<string, object>([['session-1', newTurn]])

    releaseTurnBeforeNotify(activeTurns, 'session-1', oldTurn, () => undefined)

    expect(activeTurns.get('session-1')).toBe(newTurn)
  })
})
