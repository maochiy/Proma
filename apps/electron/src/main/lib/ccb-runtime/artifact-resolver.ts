import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { validateCcbRuntimeArtifact } from './artifact-validator'
import {
  CCB_PROTOCOL_VERSION,
  EXPECTED_CCB_RUNTIME_COMMIT,
  EXPECTED_CCB_RUNTIME_VERSION,
  type CcbRuntimeManifest,
} from './protocol'

const require = createRequire(join(process.cwd(), 'package.json'))

export interface ResolvedCcbRuntimeArtifact {
  rootDir: string
  hostEntrypoint: string
  workerEntrypoint: string
  manifest: CcbRuntimeManifest
}

function getRuntimeRoot(): string {
  const configured = process.env.PROMA_CCB_RUNTIME_PATH?.trim()
  if (configured) return isAbsolute(configured) ? configured : resolve(configured)
  const { app } = require('electron') as typeof import('electron')
  if (app.isPackaged) return join(process.resourcesPath, 'ccb-runtime')
  // 开发模式默认也使用 Proma 已锁定并校验过的 Artifact，避免 sibling CCB
  // 仓库的 dist-desktop 尚未重建时，Manifest 版本与 Proma 锁定版本不一致。
  // 开发 CCB Runtime 本身时仍可通过 PROMA_CCB_RUNTIME_PATH 显式覆盖。
  return resolve(app.getAppPath(), 'resources/ccb-runtime')
}

export function resolveCcbRuntimeArtifact(rootOverride?: string): ResolvedCcbRuntimeArtifact {
  const rootDir = rootOverride ? resolve(rootOverride) : getRuntimeRoot()
  const manifest = validateCcbRuntimeArtifact(rootDir, {
    runtimeVersion: EXPECTED_CCB_RUNTIME_VERSION,
    gitCommit: EXPECTED_CCB_RUNTIME_COMMIT,
    protocolVersion: CCB_PROTOCOL_VERSION,
    platform: process.platform,
    arch: process.arch,
  })
  const hostEntrypoint = join(rootDir, manifest.entrypoints.host)
  const workerEntrypoint = join(rootDir, manifest.entrypoints.worker)
  if (!existsSync(hostEntrypoint) || !existsSync(workerEntrypoint)) {
    throw new Error('Runtime entrypoint 缺失')
  }
  return { rootDir, hostEntrypoint, workerEntrypoint, manifest }
}
