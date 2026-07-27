import { expect, test } from 'bun:test'
import type {
  CcbRuntimeEnvelope,
  CcbRuntimeEvent,
} from './protocol'
import { CcbSessionEventSequencer } from './session-event-sequencer'

function runtimeMessageEnvelope(
  sequence: number,
): CcbRuntimeEnvelope<CcbRuntimeEvent> {
  return {
    protocolVersion: 1,
    requestId: `event-${sequence}`,
    sessionId: 'session-a',
    sequence,
    timestamp: sequence,
    payload: {
      type: 'runtime.log',
      level: 'info',
      message: `event-${sequence}`,
    },
  }
}

test('CCB 双端口事件重排 > Given Control 事件先于较低序号 Stream 事件到达 When 分发 Then 按 sequence 顺序交给 Adapter', async () => {
  const received: number[] = []
  const sequencer = new CcbSessionEventSequencer(envelope => {
    if (envelope.sequence !== undefined) received.push(envelope.sequence)
  }, () => undefined)

  sequencer.push(runtimeMessageEnvelope(1))
  sequencer.push(runtimeMessageEnvelope(3))
  expect(received).toEqual([1])

  sequencer.push(runtimeMessageEnvelope(2))
  expect(received).toEqual([1, 2, 3])
  sequencer.reset()
})

test('CCB 双端口事件重排 > Given 重复事件 When 分发 Then 只交付一次', async () => {
  const received: number[] = []
  const sequencer = new CcbSessionEventSequencer(envelope => {
    if (envelope.sequence !== undefined) received.push(envelope.sequence)
  }, () => undefined)

  sequencer.push(runtimeMessageEnvelope(1))
  sequencer.push(runtimeMessageEnvelope(1))
  sequencer.push(runtimeMessageEnvelope(2))

  expect(received).toEqual([1, 2])
  sequencer.reset()
})
