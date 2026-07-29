import { createHash } from 'node:crypto'
import {
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

interface RuntimeManifestFile {
  path: string
  sha256: string
  executable?: boolean
}

interface RuntimeManifest {
  files: RuntimeManifestFile[]
}

function sha256File(filePath: string): string {
  return createHash('sha256')
    .update(readFileSync(filePath))
    .digest('hex')
}

/**
 * macOS codesign 会改写 Mach-O 文件内容，因此 CCB Runtime 原始 Artifact 的
 * SHA-256 会在 App 签名后失效。这里在签完 Runtime 原生文件、签主 App 前，
 * 原子刷新 Manifest，使 Runtime 完整性校验与最终分发内容保持一致。
 */
export function refreshSignedRuntimeManifest(runtimeRoot: string): string[] {
  const manifestPath = join(runtimeRoot, 'runtime-manifest.json')
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as RuntimeManifest
  const changedFiles: string[] = []

  for (const file of manifest.files) {
    const actual = sha256File(join(runtimeRoot, file.path))
    if (actual === file.sha256) continue
    file.sha256 = actual
    changedFiles.push(file.path)
  }

  if (changedFiles.length === 0) return changedFiles

  const temporaryPath = join(
    dirname(manifestPath),
    `.runtime-manifest-${process.pid}-${Date.now()}.tmp`,
  )
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
  renameSync(temporaryPath, manifestPath)
  return changedFiles
}
