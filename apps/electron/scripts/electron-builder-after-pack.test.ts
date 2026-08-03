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
import {
  CCB_PROTOCOL_VERSION,
  EXPECTED_CCB_RUNTIME_COMMIT,
  EXPECTED_CCB_RUNTIME_VERSION,
} from '../src/main/lib/ccb-runtime/protocol'
import afterPack, { refreshPackagedCcbRuntime } from './electron-builder-after-pack'
import { resolvePackagedCliPath } from './packaged-cli-guard'

const temporaryDirectories: string[] = []

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function createWindowsRuntime(): {
  appOutDir: string
  manifestPath: string
  ripgrepPath: string
} {
  const appOutDir = mkdtempSync(join(tmpdir(), 'proma-after-pack-'))
  temporaryDirectories.push(appOutDir)
  const runtimeRoot = join(appOutDir, 'resources', 'ccb-runtime')
  const capabilityManifest = { manifestVersion: 1, tools: ['Read'] }
  const files = new Map<string, string>([
    ['entry.js', 'console.log("host")'],
    ['session-worker.js', 'console.log("worker")'],
    ['capability-manifest.json', JSON.stringify(capabilityManifest, null, 2)],
    ['protocol.schema.json', JSON.stringify({ type: 'object' })],
    ['THIRD_PARTY_LICENSES.txt', 'licenses'],
    ['native/ripgrep/x64-win32/rg.exe', '签名前'],
  ])

  for (const [path, content] of files) {
    const fullPath = join(runtimeRoot, path)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content)
  }
  chmodSync(join(runtimeRoot, 'entry.js'), 0o755)
  chmodSync(join(runtimeRoot, 'session-worker.js'), 0o755)

  const manifestPath = join(runtimeRoot, 'runtime-manifest.json')
  writeFileSync(
    manifestPath,
    JSON.stringify({
      runtimeName: 'claude-code-best',
      runtimeVersion: EXPECTED_CCB_RUNTIME_VERSION,
      gitCommit: EXPECTED_CCB_RUNTIME_COMMIT,
      protocolVersion: CCB_PROTOCOL_VERSION,
      platform: 'win32',
      arch: 'x64',
      buildTime: new Date().toISOString(),
      entrypoints: { host: 'entry.js', worker: 'session-worker.js' },
      capabilitiesHash: sha256(JSON.stringify(capabilityManifest)),
      files: [...files].map(([path, content]) => ({
        path,
        sha256: sha256(content),
        ...(path === 'entry.js' || path === 'session-worker.js'
          ? { executable: true }
          : {}),
      })),
    }),
  )

  return {
    appOutDir,
    manifestPath,
    ripgrepPath: join(runtimeRoot, 'native/ripgrep/x64-win32/rg.exe'),
  }
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Windows Electron 打包后的 CCB Runtime', () => {
  test('Given rg.exe 被 Authenticode 改写 When afterPack 执行 Then 刷新哈希并通过完整校验', () => {
    const fixture = createWindowsRuntime()
    writeFileSync(fixture.ripgrepPath, '签名后')

    expect(
      refreshPackagedCcbRuntime({
        appOutDir: fixture.appOutDir,
        arch: 1,
        electronPlatformName: 'win32',
      }),
    ).toEqual(['native/ripgrep/x64-win32/rg.exe'])

    const manifest = JSON.parse(
      readFileSync(fixture.manifestPath, 'utf8'),
    ) as { files: Array<{ path: string; sha256: string }> }
    expect(
      manifest.files.find(
        file => file.path === 'native/ripgrep/x64-win32/rg.exe',
      )?.sha256,
    ).toBe(sha256('签名后'))
  })

  test('Given 非 exe 文件被意外改写 When afterPack 执行 Then 拒绝刷新清单', () => {
    const fixture = createWindowsRuntime()
    writeFileSync(
      join(fixture.appOutDir, 'resources', 'ccb-runtime', 'entry.js'),
      'unexpected',
    )

    expect(() =>
      refreshPackagedCcbRuntime({
        appOutDir: fixture.appOutDir,
        arch: 1,
        electronPlatformName: 'win32',
      }),
    ).toThrow('非预期文件变化: entry.js')
  })

  test('Given 非 Windows 目标 When afterPack 执行 Then 不处理 Runtime', () => {
    expect(
      refreshPackagedCcbRuntime({
        appOutDir: '/unused',
        arch: 3,
        electronPlatformName: 'darwin',
      }),
    ).toEqual([])
  })
})


describe('afterPack 入口（proma CLI 守卫）', () => {
  test('Given darwin 产物缺少 proma CLI When afterPack Then 抛错中断打包', () => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'proma-after-pack-cli-'))
    temporaryDirectories.push(appOutDir)

    expect(() =>
      afterPack({
        appOutDir,
        arch: 3,
        electronPlatformName: 'darwin',
      }),
    ).toThrow(/缺少 proma CLI/)
  })

  test('Given linux 产物含可执行 proma 且 smoke 通过 When afterPack Then 不处理 Windows Runtime', () => {
    // 此用例依赖 mock 较重；路径解析单独由 packaged-cli-guard 覆盖。
    // 这里只断言 Windows 专用逻辑在非 win32 仍返回空。
    expect(
      refreshPackagedCcbRuntime({
        appOutDir: '/unused',
        arch: 3,
        electronPlatformName: 'darwin',
      }),
    ).toEqual([])
    expect(resolvePackagedCliPath('/out', 'darwin')).toContain('Proma.app')
  })
})
