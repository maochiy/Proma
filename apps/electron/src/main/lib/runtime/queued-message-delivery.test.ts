import { describe, expect, test } from 'bun:test'
import type {
  AgentProviderAdapter,
  SDKUserMessageInput,
  SendQueuedMessageOptions,
} from '@proma/shared'
import { deliverQueuedMessageToRuntime } from './queued-message-delivery'

function createMessage(): SDKUserMessageInput {
  return {
    type: 'user',
    message: { role: 'user', content: '请立即处理这条消息' },
    parent_tool_use_id: null,
    priority: 'now',
    uuid: 'queued-message-1',
    session_id: 'session-1',
  }
}

describe('Proma Runtime 队列消息投递', () => {
  test('Given 当前 Turn 正在运行 When 用户点击立即发送 Then 原子调用 Runtime steering 而不预先中断', async () => {
    const calls: Array<{ sessionId: string; options?: SendQueuedMessageOptions }> = []
    let interruptCount = 0
    const adapter = {
      async *query() {},
      abort: async () => {},
      interruptQuery: async () => {
        interruptCount += 1
      },
      sendQueuedMessage: async (sessionId, _message, options) => {
        calls.push({ sessionId, options })
      },
      dispose: () => {},
    } satisfies AgentProviderAdapter

    await deliverQueuedMessageToRuntime(adapter, 'session-1', createMessage(), {
      interrupt: true,
    })

    expect(interruptCount).toBe(0)
    expect(calls).toEqual([{
      sessionId: 'session-1',
      options: { interrupt: true },
    }])
  })

  test('Given 当前 Turn 仅需等待发送 When 投递队列消息 Then 保留普通 follow-up 语义', async () => {
    const receivedOptions: SendQueuedMessageOptions[] = []
    const adapter = {
      async *query() {},
      abort: async () => {},
      sendQueuedMessage: async (_sessionId, _message, options) => {
        if (options) receivedOptions.push(options)
      },
      dispose: () => {},
    } satisfies AgentProviderAdapter

    await deliverQueuedMessageToRuntime(adapter, 'session-1', createMessage(), {
      interrupt: false,
    })

    expect(receivedOptions).toEqual([{ interrupt: false }])
  })

  test('Given Renderer 已进入运行态但 Runtime Turn 尚未就绪 When 点击立即发送 Then 等待就绪后自动注入', async () => {
    let attempt = 0
    const adapter = {
      async *query() {},
      abort: async () => {},
      sendQueuedMessage: async () => {
        attempt += 1
        if (attempt < 3) {
          throw new Error('Proma Codex Session 尚未打开。')
        }
      },
      dispose: () => {},
    } satisfies AgentProviderAdapter

    await deliverQueuedMessageToRuntime(adapter, 'session-1', createMessage(), {
      interrupt: true,
    })

    expect(attempt).toBe(3)
  })

  test('Given Codex Turn 已结束 When 尝试立即发送 Then 立即交给上层回退新 Turn', async () => {
    let attempt = 0
    const adapter = {
      async *query() {},
      abort: async () => {},
      sendQueuedMessage: async () => {
        attempt += 1
        throw new Error('Proma Codex Session 当前没有可介入的活跃 Turn。')
      },
      dispose: () => {},
    } satisfies AgentProviderAdapter

    await expect(deliverQueuedMessageToRuntime(
      adapter,
      'session-1',
      createMessage(),
      { interrupt: true },
    )).rejects.toThrow('当前没有可介入的活跃 Turn')
    expect(attempt).toBe(1)
  })
})
