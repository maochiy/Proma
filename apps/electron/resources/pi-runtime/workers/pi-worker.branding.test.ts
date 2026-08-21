import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const runtimeDir = join(here, '..')

function readRuntime(relativePath: string): string {
  return readFileSync(join(runtimeDir, relativePath), 'utf8')
}

describe('Proma Pi Runtime 模型可见品牌', () => {
  test('Given Pi Worker 系统提示词 When 发给模型 Then 身份是 Proma Agent 而不是 Frakio Work', () => {
    const source = readRuntime('workers/pi-worker.mjs')
    expect(source).toContain('a Proma Agent')
    expect(source).toContain('You are ${agentName}, a Proma Agent.')
    expect(source).not.toContain('Frakio Work')
    expect(source).not.toContain('a Frakio Work Agent')
    expect(source).not.toContain('frakio_')
    expect(source).toContain('proma_memory_search')
    expect(source).toContain("name: message.model.providerName || 'Proma'")
  })

  test('Given Bridge fork Worker When 注入 Runtime Binding Then 优先写入 PROMA_PI_*', () => {
    const source = readRuntime('pi-bridge.mjs')
    expect(source).toContain('PROMA_PI_RUNTIME_ROOT')
    expect(source).toContain('PROMA_PI_RUNTIME_VERSION')
    expect(source).toContain('PROMA_PI_RUNTIME_BUILD_ID')
    expect(source).toContain('PROMA_PI_HOST_PROTOCOL_VERSION')
    expect(source).toContain('runtimeBindingEnv(runtimeBinding)')
    expect(source).not.toContain('Frakio Work')
  })

  test('Given Context Packet V2 When 写入 receipt Then deliveryMode 为 proma_full', () => {
    const source = readRuntime('thread-context-v2.mjs')
    expect(source).toContain("deliveryMode: 'proma_full'")
    expect(source).not.toContain("deliveryMode: 'frakio_full'")
  })
})
