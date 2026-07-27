import type {
  CcbRuntimeEnvelope,
  CcbRuntimeEvent,
} from './protocol'

interface SessionSequenceState {
  nextSequence: number
  buffered: Map<number, CcbRuntimeEnvelope<CcbRuntimeEvent>>
  gapTimer?: ReturnType<typeof setTimeout>
}

/**
 * Control Port 与 Stream Port 各自有序，但两个端口之间没有全局顺序保证。
 * Runtime 使用单一 Session sequence，因此 Main 必须先重排再交给 Adapter。
 */
export class CcbSessionEventSequencer {
  private readonly states = new Map<string, SessionSequenceState>()

  constructor(
    private readonly deliver: (
      envelope: CcbRuntimeEnvelope<CcbRuntimeEvent>,
    ) => void,
    private readonly onGap: (
      sessionId: string,
      expectedSequence: number,
      nextAvailableSequence: number,
    ) => void,
    private readonly gapTimeoutMs = 100,
  ) {}

  push(envelope: CcbRuntimeEnvelope<CcbRuntimeEvent>): void {
    if (!envelope.sessionId || envelope.sequence === undefined) {
      this.deliver(envelope)
      return
    }

    const sessionId = envelope.sessionId
    const sequence = envelope.sequence
    const state = this.states.get(sessionId) ?? {
      nextSequence: 1,
      buffered: new Map<number, CcbRuntimeEnvelope<CcbRuntimeEvent>>(),
    }
    this.states.set(sessionId, state)

    if (sequence < state.nextSequence || state.buffered.has(sequence)) return
    state.buffered.set(sequence, envelope)
    this.flushContiguous(sessionId, state)
    this.scheduleGapFlush(sessionId, state)

    if (state.buffered.size > 10_000) {
      this.flushGap(sessionId, state)
    }
  }

  reset(): void {
    for (const state of this.states.values()) {
      if (state.gapTimer) clearTimeout(state.gapTimer)
    }
    this.states.clear()
  }

  private flushContiguous(
    sessionId: string,
    state: SessionSequenceState,
  ): void {
    while (true) {
      const envelope = state.buffered.get(state.nextSequence)
      if (!envelope) break
      state.buffered.delete(state.nextSequence)
      state.nextSequence += 1
      this.deliver(envelope)
    }
    if (state.buffered.size === 0 && state.gapTimer) {
      clearTimeout(state.gapTimer)
      state.gapTimer = undefined
    }
  }

  private scheduleGapFlush(
    sessionId: string,
    state: SessionSequenceState,
  ): void {
    if (state.buffered.size === 0 || state.gapTimer) return
    state.gapTimer = setTimeout(() => {
      state.gapTimer = undefined
      this.flushGap(sessionId, state)
    }, this.gapTimeoutMs)
  }

  private flushGap(sessionId: string, state: SessionSequenceState): void {
    const firstAvailable = Math.min(...state.buffered.keys())
    if (!Number.isFinite(firstAvailable)) return
    this.onGap(sessionId, state.nextSequence, firstAvailable)
    state.nextSequence = firstAvailable
    this.flushContiguous(sessionId, state)
    this.scheduleGapFlush(sessionId, state)
  }
}
