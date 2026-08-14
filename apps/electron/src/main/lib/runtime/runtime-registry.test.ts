import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeId } from '@proma/shared'
import { scanManagedRuntimePackages } from './runtime-registry'

const runtimeIds: RuntimeId[] = ['pi', 'hermes', 'codex', 'claude']

describe('Proma Runtime Registry 契约', () => {
  test('Given Pi、Hermes 内核和两个 Harness When 枚举运行时 Then 四个 Runtime 都可被统一识别', () => {
    expect(runtimeIds).toEqual(['pi', 'hermes', 'codex', 'claude'])
  })

  test('Given Proma Runtime Home 中已有托管包 When 扫描当前平台 Then 返回可直接启动的入口', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-runtime-'))
    try {
      const piDir = join(root, 'packages', 'pi', '0.83.0', 'darwin-arm64')
      const codexDir = join(root, 'packages', 'codex', '0.146.0', 'darwin-arm64')
      const claudeDir = join(root, 'packages', 'claude', '2.1.220', 'darwin-arm64')
      mkdirSync(join(piDir, 'node_modules', '@earendil-works', 'pi-coding-agent'), { recursive: true })
      mkdirSync(join(codexDir, 'node_modules', '@openai', 'codex', 'bin'), { recursive: true })
      mkdirSync(join(claudeDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64'), { recursive: true })
      writeFileSync(join(piDir, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'), '{}')
      writeFileSync(join(codexDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), '')
      writeFileSync(join(claudeDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude'), '')
      writeFileSync(join(piDir, 'runtime-manifest.json'), JSON.stringify({
        runtimeVersion: '0.83.0',
        runtimeBuildId: 'pi-managed-test',
        installationState: 'installed',
        verificationState: 'verified',
      }))

      const pi = scanManagedRuntimePackages(root, 'pi', 'darwin-arm64')
      const codex = scanManagedRuntimePackages(root, 'codex', 'darwin-arm64')
      const claude = scanManagedRuntimePackages(root, 'claude', 'darwin-arm64')

      expect(pi[0]?.runtimeBuildId).toBe('pi-managed-test')
      expect(pi[0]?.runtimeDir).toBe(piDir)
      expect(codex[0]?.executablePath).toBe(join(codexDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'))
      expect(claude[0]?.executablePath).toBe(join(claudeDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
