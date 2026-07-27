import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { CcbRuntimeManifest } from './protocol'

interface RuntimeArtifactExpectations {
  runtimeVersion: string
  gitCommit: string
  protocolVersion: number
  platform: string
  arch: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Runtime Manifest 字段非法: ${key}`)
  }
  return value
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function resolveArtifactFile(rootDir: string, filePath: string): string {
  if (isAbsolute(filePath)) {
    throw new Error(`Runtime 文件路径不能是绝对路径: ${filePath}`)
  }
  const resolved = resolve(rootDir, filePath)
  const relativePath = relative(rootDir, resolved)
  if (
    relativePath.length === 0 ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Runtime 文件路径越界: ${filePath}`)
  }
  return resolved
}

function parseManifest(value: unknown): CcbRuntimeManifest {
  if (!isRecord(value)) throw new Error('Runtime Manifest 必须是对象')
  const entrypoints = value.entrypoints
  if (!isRecord(entrypoints)) {
    throw new Error('Runtime Manifest entrypoints 非法')
  }
  if (!Array.isArray(value.files) || value.files.length === 0) {
    throw new Error('Runtime Manifest files 非法')
  }

  const paths = new Set<string>()
  const files = value.files.map((file, index) => {
    if (!isRecord(file)) {
      throw new Error(`Runtime Manifest files[${index}] 非法`)
    }
    const path = requireString(file, 'path')
    const sha256 = requireString(file, 'sha256')
    if (!/^[a-f0-9]{64}$/i.test(sha256)) {
      throw new Error(`Runtime 文件 SHA-256 非法: ${path}`)
    }
    if (paths.has(path)) {
      throw new Error(`Runtime Manifest 包含重复文件: ${path}`)
    }
    paths.add(path)
    if (
      file.executable !== undefined &&
      typeof file.executable !== 'boolean'
    ) {
      throw new Error(`Runtime 文件 executable 非法: ${path}`)
    }
    return {
      path,
      sha256,
      ...(file.executable === true ? { executable: true } : {}),
    }
  })

  const protocolVersion = value.protocolVersion
  if (
    typeof protocolVersion !== 'number' ||
    !Number.isInteger(protocolVersion)
  ) {
    throw new Error('Runtime Manifest protocolVersion 非法')
  }

  return {
    runtimeName: requireString(value, 'runtimeName') as 'claude-code-best',
    runtimeVersion: requireString(value, 'runtimeVersion'),
    gitCommit: requireString(value, 'gitCommit'),
    protocolVersion,
    platform: requireString(value, 'platform'),
    arch: requireString(value, 'arch'),
    buildTime: requireString(value, 'buildTime'),
    entrypoints: {
      host: requireString(entrypoints, 'host'),
      worker: requireString(entrypoints, 'worker'),
    },
    capabilitiesHash: requireString(value, 'capabilitiesHash'),
    files,
  }
}

export function validateCcbRuntimeArtifact(
  rootPath: string,
  expectations: RuntimeArtifactExpectations,
): CcbRuntimeManifest {
  const rootDir = resolve(rootPath)
  const manifestPath = resolve(rootDir, 'runtime-manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`缺少 CCB Runtime Artifact: ${manifestPath}`)
  }

  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
  } catch (error) {
    throw new Error(
      `Runtime Manifest 解析失败: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  const manifest = parseManifest(manifestValue)

  if (manifest.runtimeName !== 'claude-code-best') {
    throw new Error(`Runtime 名称不匹配: ${manifest.runtimeName}`)
  }
  if (manifest.protocolVersion !== expectations.protocolVersion) {
    throw new Error(
      `Runtime 协议不兼容: Proma=${expectations.protocolVersion}, CCB=${manifest.protocolVersion}`,
    )
  }
  if (manifest.runtimeVersion !== expectations.runtimeVersion) {
    throw new Error(
      `Runtime 版本不匹配: Proma 固定 ${expectations.runtimeVersion}，实际 ${manifest.runtimeVersion}`,
    )
  }
  if (manifest.gitCommit !== expectations.gitCommit) {
    throw new Error(
      `Runtime commit 不匹配: Proma 固定 ${expectations.gitCommit}，实际 ${manifest.gitCommit}`,
    )
  }
  if (
    manifest.platform !== expectations.platform ||
    manifest.arch !== expectations.arch
  ) {
    throw new Error(
      `Runtime 平台不匹配: 需要 ${expectations.platform}-${expectations.arch}，实际 ${manifest.platform}-${manifest.arch}`,
    )
  }

  const filesByPath = new Map(
    manifest.files.map(file => [file.path, file] as const),
  )
  for (const requiredPath of [
    manifest.entrypoints.host,
    manifest.entrypoints.worker,
    'capability-manifest.json',
    'protocol.schema.json',
    'THIRD_PARTY_LICENSES.txt',
  ]) {
    if (!filesByPath.has(requiredPath)) {
      throw new Error(`Runtime Manifest 缺少必要文件: ${requiredPath}`)
    }
  }

  for (const file of manifest.files) {
    const path = resolveArtifactFile(rootDir, file.path)
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Runtime 文件缺失: ${file.path}`)
    }
    const actual = sha256File(path)
    if (actual !== file.sha256) {
      throw new Error(`Runtime 文件校验失败: ${file.path}`)
    }
    if (
      file.executable &&
      process.platform !== 'win32' &&
      (statSync(path).mode & 0o111) === 0
    ) {
      throw new Error(`Runtime 可执行文件缺少执行权限: ${file.path}`)
    }
  }

  const capabilityPath = resolveArtifactFile(
    rootDir,
    'capability-manifest.json',
  )
  let capabilityManifest: unknown
  try {
    capabilityManifest = JSON.parse(
      readFileSync(capabilityPath, 'utf8'),
    ) as unknown
  } catch (error) {
    throw new Error(
      `Capability Manifest 解析失败: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  const capabilityHash = createHash('sha256')
    .update(JSON.stringify(capabilityManifest))
    .digest('hex')
  if (capabilityHash !== manifest.capabilitiesHash) {
    throw new Error('Runtime Capability Manifest 校验失败')
  }

  return manifest
}
