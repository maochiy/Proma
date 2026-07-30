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

interface RefreshRuntimeManifestOptions {
  allowChangedFile?: (file: RuntimeManifestFile) => boolean
}

function sha256File(filePath: string): string {
  return createHash('sha256')
    .update(readFileSync(filePath))
    .digest('hex')
}

/**
 * 平台签名工具会改写原生文件内容，因此 CCB Runtime 原始 Artifact 的 SHA-256
 * 可能在应用打包期间失效。这里原子刷新 Manifest，使完整性校验与最终分发内容
 * 保持一致；调用方可限制允许变化的文件，避免掩盖非预期改写。
 */
export function refreshSignedRuntimeManifest(
  runtimeRoot: string,
  options: RefreshRuntimeManifestOptions = {},
): string[] {
  const manifestPath = join(runtimeRoot, 'runtime-manifest.json')
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as RuntimeManifest
  const changedFiles: string[] = []

  for (const file of manifest.files) {
    const actual = sha256File(join(runtimeRoot, file.path))
    if (actual === file.sha256) continue
    if (options.allowChangedFile && !options.allowChangedFile(file)) {
      throw new Error(`Runtime 打包期间出现非预期文件变化: ${file.path}`)
    }
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
