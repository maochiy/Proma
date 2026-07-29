import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { refreshSignedRuntimeManifest } from './local-mac-signing'

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

describe('本地 macOS 签名后的 CCB Runtime Manifest', () => {
  test('Given 原生文件被 codesign 改写 When 刷新 Manifest Then 保存最终文件哈希', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-local-signing-'))
    try {
      const nativePath = join(root, 'native.node')
      writeFileSync(nativePath, '签名前')
      writeFileSync(
        join(root, 'runtime-manifest.json'),
        JSON.stringify({
          files: [
            {
              path: 'native.node',
              sha256: sha256('签名前'),
            },
          ],
        }),
      )

      writeFileSync(nativePath, '签名后')
      const changed = refreshSignedRuntimeManifest(root)
      const manifest = JSON.parse(
        readFileSync(join(root, 'runtime-manifest.json'), 'utf8'),
      ) as { files: Array<{ path: string; sha256: string }> }

      expect(changed).toEqual(['native.node'])
      expect(manifest.files[0]?.sha256).toBe(sha256('签名后'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('Given Runtime 文件未变化 When 刷新 Manifest Then 不改写清单', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-local-signing-'))
    try {
      const content = '保持不变'
      writeFileSync(join(root, 'entry.js'), content)
      const manifestPath = join(root, 'runtime-manifest.json')
      writeFileSync(
        manifestPath,
        JSON.stringify({
          files: [
            {
              path: 'entry.js',
              sha256: sha256(content),
            },
          ],
        }),
      )
      const before = readFileSync(manifestPath, 'utf8')

      expect(refreshSignedRuntimeManifest(root)).toEqual([])
      expect(readFileSync(manifestPath, 'utf8')).toBe(before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
