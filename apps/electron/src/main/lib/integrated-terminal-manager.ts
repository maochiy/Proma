import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { app, ipcMain } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import * as pty from 'node-pty'
import {
  IPC_CHANNELS,
  type IntegratedTerminalCreateInput,
  type IntegratedTerminalEvent,
  type IntegratedTerminalSessionSnapshot,
  type IntegratedTerminalShellKind,
} from '@proma/shared'
import {
  appendTerminalOutput,
  ensureNodePtySpawnHelperExecutable,
  filterTerminalReplayQueries,
  resolveLocalTerminalShell,
  updateAlternateScreenState,
} from './integrated-terminal-utils'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const require = createRequire(__filename)
const nodePtyPackageRoot = dirname(require.resolve('node-pty/package.json'))

interface IntegratedTerminalSession {
  id: string
  owner: WebContents
  conversationId: string
  conversationTitle?: string
  cwd: string
  shellName: string
  shellKind: IntegratedTerminalShellKind
  cols: number
  rows: number
  backend: pty.IPty
  output: string
  outputSequence: number
  truncated: boolean
  alternateScreen: boolean
}

const sessions = new Map<string, IntegratedTerminalSession>()
const observedOwners = new Set<number>()
let registered = false

function clampDimension(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(2, Math.min(1000, Math.floor(value!)))
}

function resolveTerminalCwd(cwd: string | undefined): string {
  const candidate = cwd?.trim() ? resolve(cwd) : homedir()
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error('终端工作目录不存在或不是文件夹')
  }
  return candidate
}

function buildSnapshot(session: IntegratedTerminalSession): IntegratedTerminalSessionSnapshot {
  const replay = filterTerminalReplayQueries(session.output)
  return {
    id: session.id,
    conversationId: session.conversationId,
    cwd: session.cwd,
    shellName: session.shellName,
    shellKind: session.shellKind,
    cols: session.cols,
    rows: session.rows,
    output: session.alternateScreen ? `\u001b[?1049h${replay}` : replay,
    outputSequence: session.outputSequence,
    truncated: session.truncated,
    alternateScreen: session.alternateScreen,
  }
}

function emitTerminalEvent(
  session: IntegratedTerminalSession,
  event: IntegratedTerminalEvent,
): void {
  if (session.owner.isDestroyed()) return
  session.owner.send(IPC_CHANNELS.TERMINAL_EVENT, event)
}

function assertOwnedSession(event: IpcMainInvokeEvent, sessionId: string): IntegratedTerminalSession {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('终端会话不存在或已结束')
  if (session.owner.id !== event.sender.id) {
    throw new Error('终端会话所有权不匹配')
  }
  return session
}

function closeTerminalSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
  try {
    session.backend.kill()
  } catch (error) {
    console.warn('[集成终端] 关闭 PTY 失败:', error)
  }
}

function observeOwner(owner: WebContents): void {
  if (observedOwners.has(owner.id)) return
  observedOwners.add(owner.id)
  owner.once('destroyed', () => {
    observedOwners.delete(owner.id)
    for (const session of sessions.values()) {
      if (session.owner.id === owner.id) closeTerminalSession(session.id)
    }
  })
}

function createTerminalSession(
  event: IpcMainInvokeEvent,
  input: IntegratedTerminalCreateInput,
): IntegratedTerminalSessionSnapshot {
  if (!input || typeof input.conversationId !== 'string' || !input.conversationId.trim()) {
    throw new Error('终端必须绑定有效会话')
  }

  const cwd = resolveTerminalCwd(input.cwd)
  const shell = resolveLocalTerminalShell()
  ensureNodePtySpawnHelperExecutable(nodePtyPackageRoot)
  const cols = clampDimension(input.cols, DEFAULT_COLS)
  const rows = clampDimension(input.rows, DEFAULT_ROWS)
  const terminalEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') terminalEnv[key] = value
  }
  if (process.platform !== 'win32') {
    terminalEnv.TERM = 'xterm-256color'
    terminalEnv.TERMINFO = ''
    terminalEnv.TERMINFO_DIRS = ''
  }
  if (input.conversationTitle?.trim()) {
    terminalEnv.CODEX_APP_TITLE = input.conversationTitle.trim()
  }

  const backend = pty.spawn(shell.command, shell.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: terminalEnv,
  })
  const session: IntegratedTerminalSession = {
    id: randomUUID(),
    owner: event.sender,
    conversationId: input.conversationId,
    conversationTitle: input.conversationTitle,
    cwd,
    shellName: shell.name,
    shellKind: shell.kind,
    cols,
    rows,
    backend,
    output: '',
    outputSequence: 0,
    truncated: false,
    alternateScreen: false,
  }
  sessions.set(session.id, session)
  observeOwner(event.sender)

  backend.onData((data) => {
    session.outputSequence += 1
    const cached = appendTerminalOutput(session.output, data, session.truncated)
    session.output = cached.output
    session.truncated = cached.truncated
    session.alternateScreen = updateAlternateScreenState(session.alternateScreen, data)
    emitTerminalEvent(session, {
      type: 'data',
      sessionId: session.id,
      data,
      sequence: session.outputSequence,
    })
  })
  backend.onExit(({ exitCode, signal }) => {
    if (!sessions.has(session.id)) return
    sessions.delete(session.id)
    emitTerminalEvent(session, {
      type: 'exit',
      sessionId: session.id,
      exitCode,
      signal,
    })
  })

  return buildSnapshot(session)
}

export function closeAllIntegratedTerminals(): void {
  for (const sessionId of Array.from(sessions.keys())) {
    closeTerminalSession(sessionId)
  }
}

export function registerIntegratedTerminalIpcHandlers(): void {
  if (registered) return
  registered = true

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_CREATE,
    (event, input: IntegratedTerminalCreateInput) => createTerminalSession(event, input),
  )
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_ATTACH,
    (event, sessionId: string) => {
      const session = assertOwnedSession(event, sessionId)
      emitTerminalEvent(session, {
        type: 'attached',
        sessionId,
        cwd: session.cwd,
        shellName: session.shellName,
        shellKind: session.shellKind,
      })
      return buildSnapshot(session)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_WRITE,
    (event, sessionId: string, data: string) => {
      const session = assertOwnedSession(event, sessionId)
      if (typeof data !== 'string') throw new Error('终端输入无效')
      session.backend.write(data)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_RESIZE,
    (event, sessionId: string, cols: number, rows: number) => {
      const session = assertOwnedSession(event, sessionId)
      const nextCols = clampDimension(cols, session.cols)
      const nextRows = clampDimension(rows, session.rows)
      session.cols = nextCols
      session.rows = nextRows
      session.backend.resize(nextCols, nextRows)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_CLOSE,
    (event, sessionId: string) => {
      assertOwnedSession(event, sessionId)
      closeTerminalSession(sessionId)
    },
  )

  app.once('before-quit', closeAllIntegratedTerminals)
}
