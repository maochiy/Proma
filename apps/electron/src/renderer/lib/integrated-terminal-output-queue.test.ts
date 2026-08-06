import { describe, expect, test } from 'bun:test'
import { IntegratedTerminalOutputQueue } from './integrated-terminal-output-queue'

describe('集成终端输出队列', () => {
  test('Given 清行控制序列被拆成多个分片 When 到达刷新时机 Then 合并后一次写入 xterm', () => {
    const writes: string[] = []
    const scheduledCallbacks: Array<() => void> = []
    const queue = new IntegratedTerminalOutputQueue(
      (data) => writes.push(data),
      {
        scheduler: {
          schedule: (callback) => {
            scheduledCallbacks.push(callback)
            return 1
          },
          cancel: () => undefined,
        },
      },
    )

    queue.enqueue('\r\u001b[')
    queue.enqueue('2Kprompt ')
    queue.enqueue('a')

    expect(writes).toEqual([])
    scheduledCallbacks[0]?.()
    expect(writes).toEqual(['\r\u001b[2Kprompt a'])
  })

  test('Given 待写数据达到容量上限 When 继续输出 Then 立即刷新避免队列无限增长', () => {
    const writes: string[] = []
    const queue = new IntegratedTerminalOutputQueue(
      (data) => writes.push(data),
      {
        pendingLimit: 8,
        scheduler: {
          schedule: () => 1,
          cancel: () => undefined,
        },
      },
    )

    queue.enqueue('1234')
    queue.enqueue('5678')

    expect(writes).toEqual(['12345678'])
  })

  test('Given 终端已经销毁 When 延迟输出到达 Then 不再写入已销毁的 xterm', () => {
    const writes: string[] = []
    const queue = new IntegratedTerminalOutputQueue(
      (data) => writes.push(data),
      {
        scheduler: {
          schedule: () => 1,
          cancel: () => undefined,
        },
      },
    )

    queue.enqueue('pending')
    queue.dispose()
    queue.flush()
    queue.enqueue('late')

    expect(writes).toEqual([])
  })
})
