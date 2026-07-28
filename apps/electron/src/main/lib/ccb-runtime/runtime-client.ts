import { randomUUID } from 'node:crypto'
import { MessageChannelMain, utilityProcess } from 'electron'
import type { MessagePortMain, UtilityProcess } from 'electron'
import { redactSensitiveLogText } from '../bridge-log-redaction'
import { resolveCcbRuntimeArtifact, type ResolvedCcbRuntimeArtifact } from './artifact-resolver'
import { buildCcbHostEnvironment } from './runtime-security'
import { CcbSessionEventSequencer } from './session-event-sequencer'
import {
  assertCcbCommandEnvelope,
  assertCcbEventEnvelope,
} from './protocol-validation'
import {
  CCB_PROTOCOL_VERSION,
  type CcbRuntimeCommand,
  type CcbRuntimeEnvelope,
  type CcbRuntimeEvent,
} from './protocol'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type EventListener = (envelope: CcbRuntimeEnvelope<CcbRuntimeEvent>) => void

export class CcbDesktopRuntimeClient {
  private process?: UtilityProcess
  private controlPort?: MessagePortMain
  private streamPort?: MessagePortMain
  private artifact?: ResolvedCcbRuntimeArtifact
  private starting?: Promise<void>
  private readonly pending = new Map<string, PendingRequest>()
  private readonly listeners = new Map<string, Set<EventListener>>()
  private readonly sequencer = new CcbSessionEventSequencer(
    envelope => this.processEnvelope(envelope),
    (sessionId, expectedSequence, nextAvailableSequence) => {
      console.warn(
        `[CCB Runtime] 检测到事件序号缺口: session=${sessionId}, expected=${expectedSequence}, next=${nextAvailableSequence}`,
      )
    },
  )
  private shuttingDown = false

  async start(): Promise<void> {
    if (this.process && this.controlPort) return
    if (this.starting) return this.starting
    this.starting = this.startWithRetry()
    try {
      await this.starting
    } finally {
      this.starting = undefined
    }
  }

  subscribe(sessionId: string, listener: EventListener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<EventListener>()
    set.add(listener)
    this.listeners.set(sessionId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(sessionId)
    }
  }

  getRuntimeInfo():
    | {
        runtimeVersion: string
        gitCommit: string
        protocolVersion: number
      }
    | undefined {
    if (!this.artifact) return undefined
    return {
      runtimeVersion: this.artifact.manifest.runtimeVersion,
      gitCommit: this.artifact.manifest.gitCommit,
      protocolVersion: this.artifact.manifest.protocolVersion,
    }
  }

  async request<T = unknown>(
    payload: CcbRuntimeCommand,
    sessionId?: string,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (!this.controlPort) await this.start()
    const requestId = randomUUID()
    const envelope: CcbRuntimeEnvelope<CcbRuntimeCommand> = {
      protocolVersion: CCB_PROTOCOL_VERSION,
      requestId,
      sessionId,
      timestamp: Date.now(),
      payload,
    }
    assertCcbCommandEnvelope(envelope)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`CCB Runtime 请求超时: ${payload.type}`))
      }, timeoutMs)
      this.pending.set(requestId, {
        resolve: value => resolve(value as T),
        reject,
        timer,
      })
      this.controlPort!.postMessage(envelope)
    })
  }

  async shutdown(): Promise<void> {
    const child = this.process
    if (!child) return
    this.shuttingDown = true
    try {
      await this.request({ type: 'host.shutdown' }, undefined, 5_000)
    } catch {
      child.kill()
    }
    this.cleanup(new Error('CCB Runtime 已关闭'))
    this.shuttingDown = false
  }

  private async startWithRetry(): Promise<void> {
    let lastError: Error | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.startInternal()
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        this.process?.kill()
        this.cleanup(lastError)
        if (attempt < 2) {
          await new Promise(resolve =>
            setTimeout(resolve, Math.min(2_000, 250 * 2 ** attempt)),
          )
        }
      }
    }
    throw lastError ?? new Error('CCB Runtime Host 启动失败')
  }

  private async startInternal(): Promise<void> {
    this.artifact = resolveCcbRuntimeArtifact()
    const child = utilityProcess.fork(this.artifact.hostEntrypoint, [], {
      serviceName: 'Proma Claude Code Best Runtime',
      env: buildCcbHostEnvironment(process.env),
      stdio: 'pipe',
    })
    this.process = child
    child.stderr?.on('data', data =>
      console.error(`[CCB Runtime] ${redactSensitiveLogText(String(data))}`),
    )
    child.on('exit', code => {
      if (!this.shuttingDown) {
        const error = new Error(`CCB Runtime Host 异常退出: code=${code}`)
        this.notifyRuntimeFailure(error, code)
        this.cleanup(error)
      }
    })

    const control = new MessageChannelMain()
    const stream = new MessageChannelMain()
    this.controlPort = control.port1
    this.streamPort = stream.port1
    this.controlPort.on('message', event => this.handleEnvelope(event.data))
    this.streamPort.on('message', event => this.handleEnvelope(event.data))
    this.controlPort.start()
    this.streamPort.start()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CCB Runtime Host spawn 超时')), 10_000)
      child.once('spawn', () => {
        clearTimeout(timer)
        child.postMessage({ type: 'desktop.attachPorts' }, [control.port2, stream.port2])
        resolve()
      })
    })

    await this.request(
      {
        type: 'host.initialize',
        expectedRuntimeVersion: this.artifact.manifest.runtimeVersion,
      },
      undefined,
      15_000,
    )
  }

  private handleEnvelope(value: unknown): void {
    try {
      assertCcbEventEnvelope(value)
    } catch (error) {
      console.error(
        `[CCB Runtime] 丢弃未通过协议校验的事件: ${redactSensitiveLogText(
          error instanceof Error ? error.message : String(error),
        )}`,
      )
      return
    }
    this.sequencer.push(value)
  }

  private processEnvelope(
    envelope: CcbRuntimeEnvelope<CcbRuntimeEvent>,
  ): void {
    const payload = envelope.payload
    if (payload.type === 'response.success' || payload.type === 'response.failure') {
      const pending = this.pending.get(payload.responseTo)
      if (pending) {
        this.pending.delete(payload.responseTo)
        clearTimeout(pending.timer)
        if (payload.type === 'response.success') pending.resolve(payload.result)
        else pending.reject(new Error(payload.error.message))
      }
    }
    if (envelope.sessionId) {
      for (const listener of this.listeners.get(envelope.sessionId) ?? []) {
        listener(envelope)
      }
    }
  }

  private cleanup(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.controlPort?.close()
    this.streamPort?.close()
    this.controlPort = undefined
    this.streamPort = undefined
    this.process = undefined
    this.sequencer.reset()
  }

  /**
   * Host 在请求已确认后崩溃时，pending request 通常已经为空；如果只做 cleanup，
   * Adapter 会永远等待 turn.completed。向所有活跃 Session 注入崩溃事件，让上层
   * 立即结束 Turn，并明确禁止自动重放可能产生副作用的工具调用。
   */
  private notifyRuntimeFailure(error: Error, exitCode: number): void {
    const timestamp = Date.now()
    for (const [sessionId, listeners] of this.listeners) {
      const envelope: CcbRuntimeEnvelope<CcbRuntimeEvent> = {
        protocolVersion: CCB_PROTOCOL_VERSION,
        requestId: randomUUID(),
        sessionId,
        timestamp,
        payload: {
          type: 'worker.crashed',
          exitCode,
          signal: null,
          recoverable: false,
        },
      }
      for (const listener of listeners) {
        try {
          listener(envelope)
        } catch (listenerError) {
          console.error(
            `[CCB Runtime] 处理 Host 崩溃事件失败: ${redactSensitiveLogText(
              listenerError instanceof Error
                ? listenerError.message
                : String(listenerError),
            )}; 原因: ${redactSensitiveLogText(error.message)}`,
          )
        }
      }
    }
  }
}

export const ccbDesktopRuntimeClient = new CcbDesktopRuntimeClient()
