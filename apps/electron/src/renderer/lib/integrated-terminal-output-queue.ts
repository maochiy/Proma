const DEFAULT_FLUSH_DELAY_MS = 8
const DEFAULT_PENDING_LIMIT = 1024 * 1024

interface TerminalOutputQueueScheduler {
  schedule(callback: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
}

interface TerminalOutputQueueOptions {
  flushDelayMs?: number
  pendingLimit?: number
  scheduler?: TerminalOutputQueueScheduler
}

const defaultScheduler: TerminalOutputQueueScheduler = {
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (handle) => window.clearTimeout(handle as number),
}

/**
 * 将 PTY 的细碎输出短暂合并后再交给 xterm。
 *
 * zsh 等 Shell 在编辑当前命令时会连续输出 `\r`、清行序列和重绘文本。
 * 如果这些分片分别进入 xterm，用户会先看到当前行被清空，再看到新内容，形成输入闪烁。
 */
export class IntegratedTerminalOutputQueue {
  private pending = ''
  private scheduledFlush: unknown | null = null
  private disposed = false
  private readonly flushDelayMs: number
  private readonly pendingLimit: number
  private readonly scheduler: TerminalOutputQueueScheduler

  constructor(
    private readonly write: (data: string) => void,
    options: TerminalOutputQueueOptions = {},
  ) {
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS
    this.pendingLimit = options.pendingLimit ?? DEFAULT_PENDING_LIMIT
    this.scheduler = options.scheduler ?? defaultScheduler
  }

  enqueue(data: string): void {
    if (this.disposed || data.length === 0) return

    if (this.pending.length > 0 && this.pending.length + data.length > this.pendingLimit) {
      this.flush()
    }

    if (data.length >= this.pendingLimit) {
      this.write(data)
      return
    }

    this.pending += data
    if (this.pending.length >= this.pendingLimit) {
      this.flush()
      return
    }

    if (this.scheduledFlush !== null) return
    this.scheduledFlush = this.scheduler.schedule(
      () => this.flush(),
      this.flushDelayMs,
    )
  }

  flush(): void {
    if (this.scheduledFlush !== null) {
      this.scheduler.cancel(this.scheduledFlush)
      this.scheduledFlush = null
    }
    if (this.disposed || this.pending.length === 0) return

    const output = this.pending
    this.pending = ''
    this.write(output)
  }

  dispose(): void {
    this.disposed = true
    if (this.scheduledFlush !== null) {
      this.scheduler.cancel(this.scheduledFlush)
      this.scheduledFlush = null
    }
    this.pending = ''
  }
}
