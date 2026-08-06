import { basename } from 'node:path'
import { chmodSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { IntegratedTerminalShellKind } from '@proma/shared'

export const TERMINAL_OUTPUT_CACHE_LIMIT = 16_000

export interface ShellLaunchConfiguration {
  command: string
  args: string[]
  name: string
  kind: IntegratedTerminalShellKind
}

/**
 * node-pty 1.1.0 的 macOS 预编译包中 spawn-helper 可能缺少可执行位，
 * 此时底层只会返回含糊的 `posix_spawnp failed`。
 */
export function ensureNodePtySpawnHelperExecutable(
  packageRoot: string,
  platform = process.platform,
  arch = process.arch,
): string | null {
  if (platform !== 'darwin') return null

  const unpackedPackageRoot = packageRoot
    .replace(/app\.asar(?=[/\\])/, 'app.asar.unpacked')
    .replace(/node_modules\.asar(?=[/\\])/, 'node_modules.asar.unpacked')
  const candidateDirectories = [
    join(unpackedPackageRoot, 'build', 'Release'),
    join(unpackedPackageRoot, 'build', 'Debug'),
    join(unpackedPackageRoot, 'prebuilds', `${platform}-${arch}`),
  ]
  const nativeDirectory = candidateDirectories.find((directory) =>
    existsSync(join(directory, 'pty.node')),
  )
  if (!nativeDirectory) {
    throw new Error(`找不到 node-pty 的 ${platform}-${arch} 原生模块`)
  }

  const helperPath = join(nativeDirectory, 'spawn-helper')
  if (!existsSync(helperPath)) {
    throw new Error('node-pty 缺少 macOS spawn-helper')
  }

  const currentMode = statSync(helperPath).mode
  if ((currentMode & 0o111) === 0) {
    chmodSync(helperPath, currentMode | 0o111)
  }
  return helperPath
}

export function resolveLocalTerminalShell(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ShellLaunchConfiguration {
  if (platform === 'win32') {
    const command = env.COMSPEC || 'powershell.exe'
    const executable = command.split(/[\\/]/).pop()?.toLowerCase() || command.toLowerCase()
    if (executable === 'cmd' || executable === 'cmd.exe') {
      return { command, args: [], name: 'Command Prompt', kind: 'cmd' }
    }
    return { command, args: ['-NoLogo'], name: 'PowerShell', kind: 'powershell' }
  }

  const command = env.SHELL || '/bin/zsh'
  const executable = basename(command).toLowerCase()
  const kind: IntegratedTerminalShellKind = executable.includes('zsh')
    ? 'zsh'
    : executable.includes('bash')
      ? 'bash'
      : executable.includes('fish')
        ? 'fish'
        : 'unknown'
  return {
    command,
    args: ['-l'],
    name: executable || 'Shell',
    kind,
  }
}

export function appendTerminalOutput(
  previous: string,
  chunk: string,
  wasTruncated: boolean,
): { output: string; truncated: boolean } {
  const combined = previous + chunk
  if (combined.length <= TERMINAL_OUTPUT_CACHE_LIMIT) {
    return { output: combined, truncated: wasTruncated }
  }
  return {
    output: combined.slice(-TERMINAL_OUTPUT_CACHE_LIMIT),
    truncated: true,
  }
}

export function updateAlternateScreenState(
  previous: boolean,
  chunk: string,
): boolean {
  const matches = Array.from(chunk.matchAll(/\u001b\[\?(47|1047|1049)([hl])/g))
  const latest = matches.at(-1)
  if (!latest) return previous
  return latest[2] === 'h'
}

/** 回放缓存时移除会要求终端主动响应的查询序列，避免旧日志触发二次输入。 */
export function filterTerminalReplayQueries(output: string): string {
  return output
    .replace(/\u001b\[(?:5|6)n/g, '')
    .replace(/\u001b\[\?6n/g, '')
}
