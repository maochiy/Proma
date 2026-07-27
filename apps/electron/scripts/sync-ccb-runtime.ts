#!/usr/bin/env bun
import {
  cpSync,
  existsSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { validateCcbRuntimeArtifact } from '../src/main/lib/ccb-runtime/artifact-validator'
import {
  CCB_PROTOCOL_VERSION,
  EXPECTED_CCB_RUNTIME_COMMIT,
  EXPECTED_CCB_RUNTIME_VERSION,
} from '../src/main/lib/ccb-runtime/protocol'

const appDir = resolve(import.meta.dir, '..')
const configured = process.env.PROMA_CCB_RUNTIME_PATH?.trim()
const source = configured
  ? (isAbsolute(configured) ? configured : resolve(configured))
  : resolve(appDir, '../../../claude-code/dist-desktop')
const target = resolve(appDir, 'resources/ccb-runtime')
const staging = resolve(
  appDir,
  `resources/.ccb-runtime-staging-${process.pid}-${Date.now()}`,
)
const backup = resolve(
  appDir,
  `resources/.ccb-runtime-backup-${process.pid}-${Date.now()}`,
)

function validate(path: string): void {
  validateCcbRuntimeArtifact(path, {
    runtimeVersion: EXPECTED_CCB_RUNTIME_VERSION,
    gitCommit: EXPECTED_CCB_RUNTIME_COMMIT,
    protocolVersion: CCB_PROTOCOL_VERSION,
    platform: process.platform,
    arch: process.arch,
  })
}

validate(source)
if (source === target) {
  console.log(`[ccb-runtime] Artifact 已在目标位置且校验通过: ${target}`)
  process.exit(0)
}

let movedPrevious = false
try {
  rmSync(staging, { recursive: true, force: true })
  rmSync(backup, { recursive: true, force: true })
  cpSync(source, staging, { recursive: true, dereference: true })
  validate(staging)

  if (existsSync(target)) {
    renameSync(target, backup)
    movedPrevious = true
  }
  renameSync(staging, target)
  rmSync(backup, { recursive: true, force: true })
  console.log(`[ccb-runtime] 已校验并同步 ${source} -> ${target}`)
} catch (error) {
  rmSync(staging, { recursive: true, force: true })
  if (movedPrevious && existsSync(backup) && !existsSync(target)) {
    renameSync(backup, target)
  }
  throw error
} finally {
  rmSync(staging, { recursive: true, force: true })
  rmSync(backup, { recursive: true, force: true })
}
