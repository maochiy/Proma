import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveCcbRuntimeArtifact } from './artifact-resolver'
import {
  CCB_PROTOCOL_VERSION,
  EXPECTED_CCB_RUNTIME_COMMIT,
  EXPECTED_CCB_RUNTIME_VERSION,
} from './protocol'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createArtifact(overrides: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'proma-ccb-runtime-'))
  dirs.push(dir)
  const capabilityManifest = { manifestVersion: 1, tools: ['Read'] }
  const files = new Map<string, string>([
    ['entry.js', 'console.log("host")'],
    ['session-worker.js', 'console.log("worker")'],
    ['capability-manifest.json', JSON.stringify(capabilityManifest, null, 2)],
    ['protocol.schema.json', JSON.stringify({ type: 'object' })],
    ['THIRD_PARTY_LICENSES.txt', 'licenses'],
  ])
  for (const [path, content] of files) {
    const fullPath = join(dir, path)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content)
  }
  chmodSync(join(dir, 'entry.js'), 0o755)
  chmodSync(join(dir, 'session-worker.js'), 0o755)
  writeFileSync(
    join(dir, 'runtime-manifest.json'),
    JSON.stringify({
      runtimeName: 'claude-code-best',
      runtimeVersion: EXPECTED_CCB_RUNTIME_VERSION,
      gitCommit: EXPECTED_CCB_RUNTIME_COMMIT,
      protocolVersion: CCB_PROTOCOL_VERSION,
      platform: process.platform,
      arch: process.arch,
      buildTime: new Date().toISOString(),
      entrypoints: { host: 'entry.js', worker: 'session-worker.js' },
      capabilitiesHash: createHash('sha256')
        .update(JSON.stringify(capabilityManifest))
        .digest('hex'),
      files: [...files.entries()].map(([path, content]) => ({
        path,
        sha256: createHash('sha256').update(content).digest('hex'),
        ...(path === 'entry.js' || path === 'session-worker.js'
          ? { executable: true }
          : {}),
      })),
      ...overrides,
    }),
  )
  return dir
}

describe('CCB Runtime Artifact 解析', () => {
  test('校验并返回当前平台 Artifact', () => {
    const artifact = resolveCcbRuntimeArtifact(createArtifact())
    expect(artifact.manifest.runtimeName).toBe('claude-code-best')
    expect(artifact.hostEntrypoint.endsWith('entry.js')).toBe(true)
  })

  test('拒绝哈希损坏的 Artifact', () => {
    const dir = createArtifact()
    writeFileSync(join(dir, 'entry.js'), 'tampered')
    expect(() => resolveCcbRuntimeArtifact(dir)).toThrow('校验失败')
  })

  test('拒绝协议不匹配', () => {
    expect(() => resolveCcbRuntimeArtifact(createArtifact({ protocolVersion: 99 }))).toThrow(
      '协议不兼容',
    )
  })

  test('拒绝越界文件路径', () => {
    const dir = createArtifact()
    const manifestPath = join(dir, 'runtime-manifest.json')
    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as Record<string, unknown>
    manifest.files = [
      ...(manifest.files as Array<Record<string, unknown>>),
      {
        path: '../escape.js',
        sha256: '0'.repeat(64),
      },
    ]
    writeFileSync(manifestPath, JSON.stringify(manifest))
    expect(() => resolveCcbRuntimeArtifact(dir)).toThrow('路径越界')
  })

  test('拒绝 Capability Manifest 哈希不匹配', () => {
    const dir = createArtifact({ capabilitiesHash: '0'.repeat(64) })
    expect(() => resolveCcbRuntimeArtifact(dir)).toThrow(
      'Capability Manifest 校验失败',
    )
  })
})
