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
  return resolve(app.getAppPath(), '../../../claude-code/dist-desktop')
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
