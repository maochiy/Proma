import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  appendTerminalOutput,
  ensureNodePtySpawnHelperExecutable,
  filterTerminalReplayQueries,
  resolveLocalTerminalShell,
  TERMINAL_OUTPUT_CACHE_LIMIT,
  updateAlternateScreenState,
} from './integrated-terminal-utils'

describe('集成终端会话工具', () => {
  test('Given macOS SHELL 为 zsh When 解析本地 Shell Then 使用登录 Shell 启动', () => {
    expect(resolveLocalTerminalShell('darwin', { SHELL: '/bin/zsh' })).toEqual({
      command: '/bin/zsh',
      args: ['-l'],
      name: 'zsh',
      kind: 'zsh',
    })
  })

  test('Given macOS spawn-helper 缺少可执行位 When 准备 PTY Then 自动修复权限', () => {
    const packageRoot = join(tmpdir(), `proma-node-pty-${crypto.randomUUID()}`)
    const nativeRoot = join(packageRoot, 'prebuilds', 'darwin-arm64')
    const nativeModule = join(nativeRoot, 'pty.node')
    const helper = join(nativeRoot, 'spawn-helper')
    mkdirSync(nativeRoot, { recursive: true })
    writeFileSync(nativeModule, '')
    writeFileSync(helper, '')
    chmodSync(helper, 0o644)

    expect(
      ensureNodePtySpawnHelperExecutable(packageRoot, 'darwin', 'arm64'),
    ).toBe(helper)
    expect(statSync(helper).mode & 0o111).not.toBe(0)
  })

  test('Given 非 macOS 平台 When 准备 PTY Then 不要求 spawn-helper', () => {
    expect(
      ensureNodePtySpawnHelperExecutable('/missing/node-pty', 'linux', 'x64'),
    ).toBeNull()
  })

  test('Given Windows COMSPEC 为 cmd When 解析本地 Shell Then 使用 Command Prompt', () => {
    expect(resolveLocalTerminalShell('win32', {
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
    })).toMatchObject({
      args: [],
      name: 'Command Prompt',
      kind: 'cmd',
    })
  })

  test('Given 输出超过 16K When 写入缓存 Then 只保留末尾并标记截断', () => {
    const result = appendTerminalOutput(
      'a'.repeat(TERMINAL_OUTPUT_CACHE_LIMIT),
      'tail',
      false,
    )

    expect(result.output).toHaveLength(TERMINAL_OUTPUT_CACHE_LIMIT)
    expect(result.output.endsWith('tail')).toBe(true)
    expect(result.truncated).toBe(true)
  })

  test('Given TUI 进入并退出 alternate screen When 更新状态 Then 追踪最后控制序列', () => {
    expect(updateAlternateScreenState(false, '\u001b[?1049h')).toBe(true)
    expect(updateAlternateScreenState(true, '输出\u001b[?1049l')).toBe(false)
  })

  test('Given 缓存包含终端状态查询 When 回放 Then 移除查询但保留普通 ANSI 输出', () => {
    expect(
      filterTerminalReplayQueries('before\u001b[6nafter\u001b[31mred'),
    ).toBe('beforeafter\u001b[31mred')
  })
})
