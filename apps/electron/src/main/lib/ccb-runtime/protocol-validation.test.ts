import { describe, expect, test } from 'bun:test'
import {
  CCB_PROTOCOL_VERSION,
  type CcbRuntimeCommand,
  type CcbRuntimeEnvelope,
  type CcbRuntimeEvent,
} from './protocol'
import {
  assertCcbCommandEnvelope,
  assertCcbEventEnvelope,
} from './protocol-validation'

function commandEnvelope(
  payload: CcbRuntimeCommand,
  sessionId?: string,
): CcbRuntimeEnvelope<CcbRuntimeCommand> {
  return {
    protocolVersion: CCB_PROTOCOL_VERSION,
    requestId: 'request-1',
    sessionId,
    timestamp: Date.now(),
    payload,
  }
}

function eventEnvelope(
  payload: CcbRuntimeEvent,
  sessionId?: string,
): CcbRuntimeEnvelope<CcbRuntimeEvent> {
  return {
    protocolVersion: CCB_PROTOCOL_VERSION,
    requestId: 'event-1',
    sessionId,
    timestamp: Date.now(),
    payload,
  }
}

describe('Proma CCB Runtime protocol validation', () => {
  test('接受合法的 Turn 命令', () => {
    expect(() =>
      assertCcbCommandEnvelope(
        commandEnvelope(
          {
            type: 'turn.start',
            prompt: 'hello',
          },
          'session-1',
        ),
      ),
    ).not.toThrow()
  })

  test('拒绝缺少 Session ID 的 Turn 命令', () => {
    expect(() =>
      assertCcbCommandEnvelope(
        commandEnvelope({
          type: 'turn.start',
          prompt: 'hello',
        }),
      ),
    ).toThrow('sessionId')
  })

  test('拒绝未知命令类型', () => {
    const envelope = commandEnvelope({
      type: 'host.getCapabilities',
    }) as unknown as {
      protocolVersion: number
      requestId: string
      timestamp: number
      payload: { type: string }
    }
    envelope.payload = { type: 'unknown.command' }
    expect(() => assertCcbCommandEnvelope(envelope)).toThrow('不支持')
  })

  test('接受合法的 Runtime event', () => {
    expect(() =>
      assertCcbEventEnvelope(
        eventEnvelope(
          {
            type: 'runtime.log',
            level: 'info',
            message: 'ready',
          },
          'session-1',
        ),
      ),
    ).not.toThrow()
  })

  test('拒绝缺少 recoverable 的崩溃事件', () => {
    const envelope = eventEnvelope(
      {
        type: 'worker.crashed',
        exitCode: 1,
        signal: null,
        recoverable: false,
      },
      'session-1',
    ) as unknown as {
      protocolVersion: number
      requestId: string
      sessionId: string
      timestamp: number
      payload: {
        type: 'worker.crashed'
        exitCode: number
        signal: null
        recoverable?: boolean
      }
    }
    delete envelope.payload.recoverable
    expect(() => assertCcbEventEnvelope(envelope)).toThrow('recoverable')
  })
})
