/**
 * Proma Runtime Registry 的 Electron 适配层。
 *
 * 这里负责发现、校验和激活四个 Runtime。旧 Frakio 配置只作为迁移兼容输入，
 * 不再作为 Proma 的产品概念或新配置输出。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  HarnessId,
  RuntimeCapability,
  RuntimeCapabilitySnapshot,
  RuntimeConfig,
  RuntimeDefinition,
  RuntimeId,
  RoutedHarnessId,
  RuntimeInstallation,
  RuntimeDiscoveryCandidate,
  RuntimePackage,
  RuntimePackageStatus,
  RuntimeActivation,
  RuntimeRelease,
} from '@proma/shared'
import { getRuntimeConfigPath } from '../config-paths'
import { readJsonFileSafe, writeJsonFileAtomic } from '../safe-file'

const ALL_CAPABILITIES: RuntimeCapability[] = [
  'streaming', 'tools', 'approvals', 'steering', 'cancellation', 'sessionResume',
  'customModels', 'managedCredentials', 'contextUsage', 'compaction', 'workTasks',
]

const RUNTIME_NAMES: Record<RuntimeId, { name: string; description: string; command: string | null }> = {
  pi: { name: 'Pi', description: '需求澄清与最终结果汇总内核', command: null },
  hermes: { name: 'Hermes', description: '任务拆解、依赖识别与协调内核', command: null },
  codex: { name: 'Codex', description: '实施计划与自动代码审查内核', command: null },
  claude: { name: 'Claude Code', description: '按批准计划实施代码的 Harness（Claude Agent SDK）', command: null },
}

const RUNTIME_IDS: RuntimeId[] = ['pi', 'hermes', 'codex', 'claude']

export const ALL_RUNTIME_IDS: readonly RuntimeId[] = RUNTIME_IDS

function defaultConfig(): RuntimeConfig {
  const runtimeHome = process.env.PROMA_RUNTIME_HOME
    || process.env.FRAKIO_WORK_RUNTIME_HOME
    || join(homedir(), '.proma-runtime')
  const runtimeSourceHome = process.env.PROMA_RUNTIME_SOURCE_HOME
    || process.env.FRAKIO_WORK_SOURCE_HOME
    || null
  const runtimeApiBaseUrl = process.env.PROMA_RUNTIME_API_URL
    || process.env.FRAKIO_WORK_API_URL
    || null
  return {
    runtimeHome,
    runtimeSourceHome,
    runtimeApiBaseUrl,
    defaultRuntimeId: 'pi',
    defaultHarnessId: 'pi',
    enabledRuntimeIds: [...RUNTIME_IDS],
    routedHarnesses: ['codex', 'claude'],
    updatedAt: Date.now(),
  }
}

interface RuntimePackageServiceResponse {
  runtimeId?: string
  activation?: {
    runtimeId?: string
    activeBuildId?: string
    previousBuildId?: string
    activationRevision?: string
  } | null
  activeBinding?: Record<string, unknown> | null
  packages?: Record<string, unknown>[]
  releases?: {
    verified?: Record<string, unknown>[]
    upstreamLatest?: { version?: string } | string | null
  }
  upstreamLatest?: { version?: string } | string | null
  checkedAt?: string
}

interface RuntimeServiceListResponse {
  runtimes?: Array<{
    id?: string
    runtimeId?: string
    installation?: {
      status?: string
      version?: string
      command?: string
      detail?: string
      checkedAt?: string
    }
    activeBinding?: Record<string, unknown> | null
  }>
}

interface HermesRuntimeInfo {
  source?: string
  runtimeDir?: string
  pythonRoot?: string
  python?: string
  version?: string
  platform?: string
  bridgeProtocolVersion?: number
  manifest?: Record<string, unknown> | null
  installedAt?: string
  verified?: boolean
  compatible?: boolean
}

interface HermesRuntimeStatusResponse {
  runtime?: HermesRuntimeInfo | null
  manager?: {
    activeVersion?: string
    previousVersion?: string
    bridgeProtocolVersion?: number
    officialLatest?: { version?: string; tag?: string } | string | null
    bundledRuntime?: HermesRuntimeInfo | null
    managedRuntimes?: HermesRuntimeInfo[]
  } | null
  checkedAt?: string
}

interface HermesRuntimeReleaseResponse {
  releases?: Array<{
    version?: string
    tag?: string
    label?: string
    publishedAt?: string
  }>
}

interface LocalRuntimeManifest {
  runtimeVersion?: string
  runtimeBuildId?: string
  installationState?: string
  verificationState?: string
  installedAt?: string
  verifiedAt?: string
}

function platformArch(): string {
  const arch = process.arch === 'arm64' || process.arch === 'x64' ? process.arch : process.arch
  return `${process.platform}-${arch}`
}

function hermesPlatformArch(): string {
  const os = process.platform === 'darwin' ? 'mac' : process.platform
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch
  return `${os}-${arch}`
}

function readJsonRecord(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    const value: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function localExecutablePath(runtimeId: RuntimeId, runtimeDir: string): string | null {
  if (runtimeId === 'codex') {
    const executable = join(runtimeDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    return existsSync(executable) ? executable : null
  }
  if (runtimeId === 'claude') {
    const packageRoot = join(runtimeDir, 'node_modules', '@anthropic-ai')
    if (!existsSync(packageRoot)) return null
    for (const packageName of readdirSync(packageRoot)) {
      if (!packageName.startsWith('claude-agent-sdk-')) continue
      const executable = join(packageRoot, packageName, 'claude')
      if (existsSync(executable)) return executable
    }
  }
  return null
}

/**
 * 扫描 Proma Runtime Home 中当前平台的托管包。
 *
 * Pi 新版会写 runtime-manifest.json；Codex/Claude 的历史托管包没有
 * manifest，因此同时通过各自的 node_modules 入口识别。
 */
export function scanManagedRuntimePackages(
  runtimeHome: string,
  runtimeId: RuntimeId,
  currentPlatformArch = platformArch(),
): RuntimePackage[] {
  const runtimeRoot = join(runtimeHome, 'packages', runtimeId)
  if (!existsSync(runtimeRoot)) return []
  const packages: RuntimePackage[] = []
  for (const version of readdirSync(runtimeRoot)) {
    const versionRoot = join(runtimeRoot, version, currentPlatformArch)
    if (!existsSync(versionRoot) || !statSync(versionRoot).isDirectory()) continue
    const manifest = readJsonRecord(join(versionRoot, 'runtime-manifest.json')) as LocalRuntimeManifest | null
    const runtimeVersion = String(manifest?.runtimeVersion || version).trim()
    const executablePath = localExecutablePath(runtimeId, versionRoot)
    const packagePresent = runtimeId === 'pi'
      ? existsSync(join(versionRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'))
      : Boolean(executablePath)
    if (!runtimeVersion || !packagePresent) continue
    const installed = manifest?.installationState !== 'broken'
      && manifest?.verificationState !== 'failed'
    packages.push({
      runtimeId,
      runtimeVersion,
      runtimeBuildId: String(manifest?.runtimeBuildId || `${runtimeId}-managed-${runtimeVersion}-${currentPlatformArch}`),
      source: 'managed',
      installationState: installed ? 'installed' : 'broken',
      availability: installed ? 'ready' : 'broken',
      executablePath,
      runtimeDir: versionRoot,
      installedAt: typeof manifest?.installedAt === 'string' ? manifest.installedAt : null,
      verifiedAt: typeof manifest?.verifiedAt === 'string' ? manifest.verifiedAt : null,
      detail: installed
        ? `从 Proma Runtime Home 发现 ${runtimeId} ${runtimeVersion}。`
        : `Proma Runtime ${runtimeId} ${runtimeVersion} 校验失败。`,
    })
  }
  return packages.sort((left, right) => left.runtimeVersion.localeCompare(right.runtimeVersion, undefined, { numeric: true }))
}

/** 扫描 Runtime 源码或 Runtime Home 中的 Hermes Python Runtime。 */
export function scanLocalHermesRuntimePackages(
  runtimeHome: string,
  sourceHome = '',
  currentPlatform = hermesPlatformArch(),
): RuntimePackage[] {
  const bundledRoot = process.resourcesPath ? join(process.resourcesPath, 'hermes') : ''
  const roots = isPackagedElectronApp()
    ? [bundledRoot]
    : [
        bundledRoot,
        join(runtimeHome, 'hermes'),
        join(sourceHome, 'runtime', 'hermes'),
      ]
  const uniqueRoots = roots.filter((root, index, values) => Boolean(root) && values.indexOf(root) === index)
  const packages: RuntimePackage[] = []
  for (const root of uniqueRoots) {
    if (!existsSync(root)) continue
    for (const version of readdirSync(root)) {
      const runtimeDir = join(root, version, currentPlatform)
      const python = join(runtimeDir, 'python', 'bin', 'python3.12')
      const runner = join(runtimeDir, 'python', 'lib')
      if (!existsSync(runtimeDir) || !existsSync(python) || !existsSync(runner)) continue
      const manifest = readJsonRecord(join(runtimeDir, 'runtime-manifest.json'))
      const runtimeVersion = String(manifest?.hermesAgentVersion || version).trim()
      if (!runtimeVersion) continue
      const bundled = root === join(process.resourcesPath || '', 'hermes')
        || Boolean(sourceHome && root.startsWith(join(sourceHome, 'runtime', 'hermes')))
      packages.push({
        runtimeId: 'hermes',
        runtimeVersion,
        runtimeBuildId: `${bundled ? 'hermes-bundled' : 'hermes-managed'}-${runtimeVersion}-${currentPlatform}`,
        source: bundled ? 'bundled' : 'managed',
        installationState: 'installed',
        availability: 'ready',
        executablePath: python,
        runtimeDir,
        installedAt: typeof manifest?.builtAt === 'string' ? manifest.builtAt : null,
        verifiedAt: typeof manifest?.builtAt === 'string' ? manifest.builtAt : null,
        detail: `从 Proma Hermes Runtime 发现 ${runtimeVersion}。`,
      })
    }
  }
  return packages
    .filter((item, index, items) => items.findIndex((candidate) => candidate.runtimeDir === item.runtimeDir) === index)
    .sort((left, right) => left.runtimeVersion.localeCompare(right.runtimeVersion, undefined, { numeric: true }))
}

function runtimeServiceBaseUrl(): string | null {
  return getRuntimeConfig().runtimeApiBaseUrl?.replace(/\/+$/, '') || null
}

function runtimeServiceHeaders(): Record<string, string> {
  const token = (
    process.env.PROMA_RUNTIME_TOKEN
    || process.env.FRAKIO_RUNTIME_TOKEN
  )?.trim()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function runtimeServiceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = runtimeServiceBaseUrl()
  if (!baseUrl) throw new Error('尚未配置 Proma Runtime API 地址。')
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...runtimeServiceHeaders(),
      ...(init?.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      ? String(body.error)
      : `Proma Runtime API 请求失败（HTTP ${response.status}）。`
    throw new Error(message)
  }
  return body as T
}

function mapRuntimePackage(value: Record<string, unknown>, runtimeId: RuntimeId): RuntimePackage {
  const source = value.source === 'bundled' || value.source === 'managed' || value.source === 'native' || value.source === 'system'
    ? value.source
    : 'managed'
  const installationState = value.installationState === 'installed' || value.installationState === 'broken' || value.installationState === 'checking'
    ? value.installationState
    : 'missing'
  const availability = value.availability === 'ready' || value.availability === 'broken' ? value.availability : 'unavailable'
  return {
    runtimeId,
    runtimeVersion: String(value.runtimeVersion || 'unknown'),
    runtimeBuildId: String(value.runtimeBuildId || `${runtimeId}-${String(value.runtimeVersion || 'unknown')}`),
    source,
    installationState,
    availability,
    executablePath: typeof value.executablePath === 'string' ? value.executablePath : null,
    runtimeDir: typeof value.runtimeDir === 'string' ? value.runtimeDir : null,
    installedAt: typeof value.installedAt === 'string' ? value.installedAt : null,
    verifiedAt: typeof value.verifiedAt === 'string'
      ? value.verifiedAt
      : typeof value.lastVerifiedAt === 'string' ? value.lastVerifiedAt : null,
    detail: typeof value.detail === 'string' ? value.detail : null,
  }
}

function mapRuntimePackageStatus(runtimeId: RuntimeId, response: RuntimePackageServiceResponse): RuntimePackageStatus {
  const packages = (response.packages || []).map((item) => mapRuntimePackage(item, runtimeId))
  const activationValue = response.activation
  const activation: RuntimeActivation | null = activationValue ? {
    runtimeId,
    activeBuildId: String(activationValue.activeBuildId || '') || null,
    previousBuildId: String(activationValue.previousBuildId || '') || null,
    activationRevision: String(activationValue.activationRevision || ''),
  } : null
  const latest = response.releases?.upstreamLatest ?? response.upstreamLatest
  const availableVersions = (response.releases?.verified || []).flatMap((item): RuntimeRelease[] => {
    const version = String(item.version || '').trim()
    return version ? [{
      version,
      ...(item.packageVersion ? { packageVersion: String(item.packageVersion) } : {}),
      ...(item.integrity ? { integrity: String(item.integrity) } : {}),
      ...(item.verifiedAt ? { verifiedAt: String(item.verifiedAt) } : {}),
      ...(item.node ? { node: String(item.node) } : {}),
      }] : []
  })
  const remoteActiveBinding = response.activeBinding
    ? mapRuntimePackage(response.activeBinding, runtimeId)
    : null
  return {
    runtimeId,
    activation,
    activeBinding: remoteActiveBinding
      || packages.find((item) => item.runtimeBuildId === activation?.activeBuildId)
      || null,
    packages,
    upstreamLatest: typeof latest === 'string' ? latest : latest?.version || null,
    availableVersions,
    checkedAt: response.checkedAt || new Date().toISOString(),
    source: 'remote',
  }
}

function mapHermesRuntimePackage(value: HermesRuntimeInfo | null | undefined): RuntimePackage | null {
  const version = String(value?.version || '').trim()
  const runtimeDir = String(value?.runtimeDir || '').trim()
  if (!version || !runtimeDir) return null
  const platform = String(value?.platform || process.platform).trim()
  const source = value?.source === 'bundled' ? 'bundled' : 'managed'
  const compatible = value?.compatible !== false
  return {
    runtimeId: 'hermes',
    runtimeVersion: version,
    runtimeBuildId: `hermes-${version}-${platform}`,
    source,
    installationState: compatible ? 'installed' : 'broken',
    availability: compatible ? 'ready' : 'broken',
    executablePath: typeof value?.python === 'string' ? value.python : null,
    runtimeDir,
    installedAt: typeof value?.installedAt === 'string' ? value.installedAt : null,
    verifiedAt: value?.verified === false ? null : new Date().toISOString(),
    detail: compatible ? 'Proma Hermes Runtime 已验证。' : 'Proma Hermes Runtime 与当前 Bridge 协议不兼容。',
  }
}

async function getHermesPackageStatusFromService(): Promise<RuntimePackageStatus> {
  const [response, releasesResponse] = await Promise.all([
    runtimeServiceRequest<HermesRuntimeStatusResponse>('/api/hermes-runtime/status'),
    runtimeServiceRequest<HermesRuntimeReleaseResponse>('/api/hermes-runtime/releases').catch(() => ({ releases: [] })),
  ])
  const manager = response.manager || {}
  const packages = [
    manager.bundledRuntime,
    ...(manager.managedRuntimes || []),
    response.runtime,
  ]
    .map(mapHermesRuntimePackage)
    .filter((item): item is RuntimePackage => item !== null)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.runtimeBuildId === item.runtimeBuildId) === index)
  const activeBinding = mapHermesRuntimePackage(response.runtime)
    || packages.find((item) => item.runtimeVersion === String(manager.activeVersion || '').trim())
    || null
  const previous = packages.find((item) => item.runtimeVersion === String(manager.previousVersion || '').trim())
  const latest = manager.officialLatest
  return {
    runtimeId: 'hermes',
    activation: activeBinding ? {
      runtimeId: 'hermes',
      activeBuildId: activeBinding.runtimeBuildId,
      previousBuildId: previous?.runtimeBuildId || null,
      activationRevision: `proma-hermes-${manager.activeVersion || activeBinding.runtimeVersion}`,
    } : null,
    activeBinding,
    packages,
    upstreamLatest: typeof latest === 'string' ? latest : latest?.version || latest?.tag || null,
    availableVersions: (releasesResponse.releases || []).flatMap((release): RuntimeRelease[] => {
      const version = String(release.version || release.tag || '').trim().replace(/^v/i, '')
      if (!version) return []
      return [{
        version,
        ...(release.tag ? { packageVersion: String(release.tag) } : {}),
        ...(release.label ? { detail: String(release.label) } : {}),
        ...(release.publishedAt ? { verifiedAt: String(release.publishedAt) } : {}),
      }]
    }),
    checkedAt: response.checkedAt || new Date().toISOString(),
    source: 'remote',
  }
}

interface BundledPackageInfo {
  packageRoot: string
  version: string
}

/**
 * 查找随 Proma 安装的 Node 包。
 *
 * Claude Code 不依赖用户 PATH 中的全局 `claude` 命令，而是使用
 * `@anthropic-ai/claude-agent-sdk` 和对应平台包。这里同时兼容开发环境、
 * Electron 打包目录和 ASAR 外的 node_modules。
 */
export function isPackagedElectronApp(): boolean {
  const resourcesPath = process.resourcesPath
  if (!resourcesPath) return false
  return existsSync(join(resourcesPath, 'app.asar'))
    || existsSync(join(resourcesPath, 'app.asar.unpacked'))
}

function findBundledPackage(packageName: string): BundledPackageInfo | null {
  const roots: string[] = []
  if (process.resourcesPath) {
    roots.push(
      // 安装包内的 Runtime 必须优先于用户工作区 / PATH。
      // asarUnpack 出去的整包位于 app.asar.unpacked，fork/spawn 读不到 ASAR 内文件。
      join(process.resourcesPath, 'app.asar.unpacked'),
      join(process.resourcesPath, 'app'),
      process.resourcesPath,
    )
  }
  if (!isPackagedElectronApp()) {
    let current = process.cwd()
    for (let depth = 0; depth < 6; depth += 1) {
      roots.push(current)
      const parent = join(current, '..')
      if (parent === current) break
      current = parent
    }
  }

  for (const root of roots) {
    const packageJsonPath = join(root, 'node_modules', ...packageName.split('/'), 'package.json')
    const packageJson = readJsonRecord(packageJsonPath)
    const version = typeof packageJson?.version === 'string' ? packageJson.version.trim() : ''
    if (version) {
      return {
        packageRoot: join(root, 'node_modules', ...packageName.split('/')),
        version,
      }
    }
  }
  return null
}

/**
 * 查找随 Proma 安装的 Pi 内核。
 *
 * Pi Worker 通过 `<runtimeRoot>/node_modules/@earendil-works/pi-coding-agent`
 * 加载依赖。不能使用用户 PATH 中的 `pi` CLI：本机可能没装，版本也可能
 * 与安装包内置 Worker 不一致。
 */
function bundledPiInstallation(): RuntimeInstallation | null {
  const sdk = findBundledPackage('@earendil-works/pi-coding-agent')
  if (!sdk) return null
  // scoped 包：<root>/node_modules/@earendil-works/pi-coding-agent → <root>
  const runtimeDir = join(sdk.packageRoot, '..', '..', '..')
  return {
    runtimeId: 'pi',
    status: 'ready',
    version: sdk.version,
    executablePath: runtimeDir,
    source: 'bundled',
    detail: `Proma 已内置 Pi ${sdk.version}。`,
    checkedAt: Date.now(),
  }
}

function bundledClaudeSdkInstallation(): RuntimeInstallation | null {
  const sdk = findBundledPackage('@anthropic-ai/claude-agent-sdk')
  if (!sdk) return null
  const platformPackage = `claude-agent-sdk-${process.platform}-${process.arch}`
  const executableName = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const executablePath = join(
    sdk.packageRoot,
    '..',
    platformPackage,
    executableName,
  )
  return {
    runtimeId: 'claude',
    status: 'ready',
    version: sdk.version,
    executablePath: existsSync(executablePath) ? executablePath : null,
    source: 'bundled',
    detail: existsSync(executablePath)
      ? `Proma 已内置 Claude Agent SDK ${sdk.version} 及当前平台执行包。`
      : `Proma 已内置 Claude Agent SDK ${sdk.version}；当前平台执行包由 SDK 负责解析。`,
    checkedAt: Date.now(),
  }
}

/**
 * 查找随 Proma 安装的 Codex Harness。
 *
 * Codex 主包 `@openai/codex` 通过自身 optionalDependencies 按平台装入
 * `@openai/codex-{platform}-{arch}` 子包；统一 Node 入口 `bin/codex.js`
 * 会在运行时解析当前平台的 vendor 二进制。这里只需定位主包入口即可，
 * 与 Claude SDK 的 bundled 检测一致，兼容开发 / 打包 / ASAR 外目录。
 */
function bundledCodexSdkInstallation(): RuntimeInstallation | null {
  const sdk = findBundledPackage('@openai/codex')
  if (!sdk) return null
  const entrypoint = join(sdk.packageRoot, 'bin', process.platform === 'win32' ? 'codex.js' : 'codex.js')
  return {
    runtimeId: 'codex',
    status: 'ready',
    version: sdk.version,
    executablePath: existsSync(entrypoint) ? entrypoint : null,
    source: 'bundled',
    detail: existsSync(entrypoint)
      ? `Proma 已内置 Codex ${sdk.version} 及当前平台执行包。`
      : `Proma 已内置 Codex ${sdk.version}；当前平台执行包由主包负责解析。`,
    checkedAt: Date.now(),
  }
}

function readRuntimeRegistry(config: RuntimeConfig): Record<string, unknown> | null {
  const candidates = [
    config.runtimeHome ? join(config.runtimeHome, 'runtime-registry.json') : '',
  ].filter(Boolean)
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      console.warn('[Runtime] Proma Runtime Registry 读取失败:', filePath)
    }
  }
  return null
}

function localRuntimePackages(config: RuntimeConfig, runtimeId: RuntimeId): RuntimePackage[] {
  const runtimeHome = config.runtimeHome || ''
  return runtimeHome ? scanManagedRuntimePackages(runtimeHome, runtimeId) : []
}

function newestReadyPackage(packages: RuntimePackage[]): RuntimePackage | null {
  return packages
    .filter((item) => item.installationState === 'installed' && item.availability === 'ready')
    .at(-1) || null
}

function missingInstallation(runtimeId: RuntimeId, now: number): RuntimeInstallation {
  return {
    runtimeId,
    status: 'missing',
    version: null,
    executablePath: null,
    source: null,
    detail: `未发现内置 ${RUNTIME_NAMES[runtimeId].name} Runtime。安装 Proma 时会随应用分发，不依赖本机 PATH。`,
    checkedAt: now,
  }
}

function installationFor(runtimeId: RuntimeId, config: RuntimeConfig): RuntimeInstallation {
  const now = Date.now()
  if (runtimeId === 'claude') {
    const bundled = bundledClaudeSdkInstallation()
    if (bundled) return bundled
  }
  if (runtimeId === 'codex') {
    const bundled = bundledCodexSdkInstallation()
    if (bundled) return bundled
  }
  if (runtimeId === 'pi') {
    const bundled = bundledPiInstallation()
    if (bundled) return bundled
  }
  if (runtimeId === 'hermes') {
    const runtimeHome = config.runtimeHome || ''
    const scanned = scanLocalHermesRuntimePackages(runtimeHome, config.runtimeSourceHome || '')
    const bundled = scanned.find((item) => item.source === 'bundled')
    const active = bundled || (isPackagedElectronApp() ? null : newestReadyPackage(scanned))
    return {
      runtimeId,
      status: active ? 'ready' : 'missing',
      version: active?.runtimeVersion || null,
      executablePath: active?.executablePath || null,
      source: active?.source === 'bundled' ? 'bundled' : active ? 'managed' : null,
      detail: active?.detail || '未发现内置 Hermes Runtime。安装 Proma 时会随应用分发，不依赖本机 PATH。',
      checkedAt: now,
    }
  }
  if (!isPackagedElectronApp()) {
    const managed = newestReadyPackage(localRuntimePackages(config, runtimeId))
    if (managed) {
      return {
        runtimeId,
        status: 'ready',
        version: managed.runtimeVersion,
        executablePath: managed.executablePath || managed.runtimeDir,
        source: 'managed',
        detail: managed.detail,
        checkedAt: now,
      }
    }
  }
  return missingInstallation(runtimeId, now)
}

function definition(runtimeId: RuntimeId, config: RuntimeConfig, registry: Record<string, unknown> | null): RuntimeDefinition {
  const metadata = registry?.[runtimeId]
  const registryVersion = metadata && typeof metadata === 'object' && 'runtimeVersion' in metadata
    ? String(metadata.runtimeVersion)
    : null
  const installation = installationFor(runtimeId, config)
  if (registryVersion && !installation.version) installation.version = registryVersion
  return {
    id: runtimeId,
    role: runtimeId === 'pi' || runtimeId === 'hermes' ? 'kernel' : 'routed-harness',
    name: RUNTIME_NAMES[runtimeId].name,
    description: RUNTIME_NAMES[runtimeId].description,
    command: RUNTIME_NAMES[runtimeId].command,
    // Runtime 适配器随 Proma 内置；installation 仍保留真实执行依赖的检测结果。
    bundled: true,
    capabilities: [...ALL_CAPABILITIES],
    installation,
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  const stored = readJsonFileSafe<Partial<RuntimeConfig>>(getRuntimeConfigPath())
  const defaults = defaultConfig()
  const enabled = Array.isArray(stored?.enabledRuntimeIds)
    ? stored.enabledRuntimeIds.filter((id): id is RuntimeId => RUNTIME_IDS.includes(id as RuntimeId))
    : defaults.enabledRuntimeIds
  const routedHarnesses = Array.isArray(stored?.routedHarnesses)
    ? stored.routedHarnesses.filter((id): id is RoutedHarnessId => id === 'codex' || id === 'claude')
    : defaults.routedHarnesses
  return {
    ...defaults,
    defaultRuntimeId: RUNTIME_IDS.includes(stored?.defaultRuntimeId as RuntimeId) ? stored!.defaultRuntimeId! : defaults.defaultRuntimeId,
    defaultHarnessId: ['native', ...RUNTIME_IDS].includes(stored?.defaultHarnessId as HarnessId) ? stored!.defaultHarnessId! : defaults.defaultHarnessId,
    runtimeSourceHome: typeof stored?.runtimeSourceHome === 'string'
      ? stored.runtimeSourceHome
      : typeof stored?.frakioSourceHome === 'string' ? stored.frakioSourceHome : defaults.runtimeSourceHome,
    runtimeHome: typeof stored?.runtimeHome === 'string'
      ? stored.runtimeHome
      : typeof stored?.frakioHome === 'string' ? stored.frakioHome : defaults.runtimeHome,
    runtimeApiBaseUrl: typeof stored?.runtimeApiBaseUrl === 'string'
      ? stored.runtimeApiBaseUrl
      : typeof stored?.frakioApiBaseUrl === 'string' ? stored.frakioApiBaseUrl : defaults.runtimeApiBaseUrl,
    enabledRuntimeIds: enabled.length > 0 ? enabled : defaults.enabledRuntimeIds,
    routedHarnesses: routedHarnesses.length > 0 ? routedHarnesses : defaults.routedHarnesses,
    updatedAt: typeof stored?.updatedAt === 'number' ? stored.updatedAt : defaults.updatedAt,
  }
}

export function updateRuntimeConfig(updates: Partial<RuntimeConfig>): RuntimeConfig {
  const next: RuntimeConfig = {
    ...getRuntimeConfig(),
    ...updates,
    routedHarnesses: updates.routedHarnesses ?? getRuntimeConfig().routedHarnesses,
    updatedAt: Date.now(),
  }
  writeJsonFileAtomic(getRuntimeConfigPath(), next)
  return next
}

export function listRuntimes(): RuntimeDefinition[] {
  const config = getRuntimeConfig()
  const registry = readRuntimeRegistry(config)
  return RUNTIME_IDS.map((runtimeId) => definition(runtimeId, config, registry))
}

/** 刷新 Runtime Center；配置 Proma Runtime 服务时读取远程绑定状态。 */
export async function refreshRuntimes(): Promise<RuntimeDefinition[]> {
  const local = listRuntimes()
  if (!runtimeServiceBaseUrl()) return local
  const response = await runtimeServiceRequest<RuntimeServiceListResponse>('/api/runtimes')
  const remote = new Map((response.runtimes || []).map((item) => [String(item.id || item.runtimeId || ''), item]))
  return local.map((runtime) => {
    const item = remote.get(runtime.id)
    if (!item) return runtime
    if (runtime.installation.source === 'bundled' && runtime.installation.status === 'ready') {
      return runtime
    }
    const installation = item.installation || {}
    const binding = item.activeBinding || {}
    const status = installation.status === 'ready' || installation.status === 'broken' || installation.status === 'checking'
      ? installation.status
      : 'missing'
    const source = binding.source === 'managed' || binding.source === 'frakio'
      ? 'managed'
      : binding.source === 'native' || binding.source === 'system'
        ? 'system'
        : runtime.installation.source
    return {
      ...runtime,
      installation: {
        ...runtime.installation,
        status,
        version: String(installation.version || binding.runtimeVersion || runtime.installation.version || '') || null,
        executablePath: String(installation.command || binding.executablePath || runtime.installation.executablePath || '') || null,
        source,
        detail: String(installation.detail || binding.detail || runtime.installation.detail || ''),
        checkedAt: installation.checkedAt ? Date.parse(installation.checkedAt) || Date.now() : Date.now(),
      },
    }
  })
}

export function getRuntimeCapabilities(runtimeId: RuntimeId): RuntimeCapabilitySnapshot {
  const runtime = listRuntimes().find((item) => item.id === runtimeId)
  const capabilities = Object.fromEntries(ALL_CAPABILITIES.map((capability) => [
    capability,
    runtime?.installation.status === 'ready' ? 'supported' : 'unknown',
  ])) as Partial<RuntimeCapabilitySnapshot['capabilities']>
  return {
    runtimeId,
    runtimeVersion: runtime?.installation.version || '',
    source: runtime?.installation.source || 'unknown',
    capabilities,
    checkedAt: Date.now(),
  }
}

function packageSource(source: RuntimeInstallation['source']): RuntimePackage['source'] {
  if (source === 'system') return 'native'
  if (source === 'managed') return 'managed'
  return 'bundled'
}

function packageFor(runtime: RuntimeDefinition): RuntimePackage {
  const installation = runtime.installation
  const buildId = `${runtime.id}-${installation.source || 'bundled'}-${installation.version || 'unknown'}`
  return {
    runtimeId: runtime.id,
    runtimeVersion: installation.version || 'unknown',
    runtimeBuildId: buildId,
    source: packageSource(installation.source),
    installationState: installation.status === 'ready' ? 'installed' : installation.status === 'broken' ? 'broken' : 'missing',
    availability: installation.status === 'ready' ? 'ready' : installation.status === 'broken' ? 'broken' : 'unavailable',
    executablePath: installation.executablePath,
    runtimeDir: runtime.id === 'pi' || runtime.id === 'hermes' ? installation.executablePath : null,
    installedAt: null,
    verifiedAt: installation.checkedAt ? new Date(installation.checkedAt).toISOString() : null,
    detail: installation.detail,
  }
}

export function detectRuntime(runtimeId: RuntimeId): RuntimeDefinition | null {
  return listRuntimes().find((runtime) => runtime.id === runtimeId) || null
}

export async function discoverRuntime(runtimeId: RuntimeId): Promise<RuntimeDiscoveryCandidate[]> {
  if (runtimeServiceBaseUrl()) {
    const response = await runtimeServiceRequest<{ candidates?: Record<string, unknown>[] }>(
      `/api/runtimes/${runtimeId}/discover`,
      { method: 'POST', body: JSON.stringify({}) },
    )
    return (response.candidates || []).flatMap((item): RuntimeDiscoveryCandidate[] => {
      const executablePath = String(item.realPath || item.path || '').trim()
      if (!executablePath) return []
      return [{
        executablePath,
        version: typeof item.version === 'string' ? item.version : null,
        source: item.compatibility === 'compatible' ? 'system' : 'unknown',
        detail: typeof item.detail === 'string' ? item.detail : null,
      }]
    })
  }
  const managed = localRuntimePackages(getRuntimeConfig(), runtimeId)
  if (managed.length > 0) {
    return managed
      .map((item): RuntimeDiscoveryCandidate => ({
        executablePath: item.executablePath || item.runtimeDir || '',
        version: item.runtimeVersion,
        source: 'managed',
        detail: item.detail,
      }))
      .filter((item) => Boolean(item.executablePath))
  }
  return []
}

export async function getRuntimePackageStatus(runtimeId: RuntimeId): Promise<RuntimePackageStatus> {
  const runtime = detectRuntime(runtimeId)
  if (!runtime) throw new Error(`找不到 Runtime：${runtimeId}`)
  if (runtimeId === 'hermes') {
    if (!isPackagedElectronApp() && runtimeServiceBaseUrl()) {
      return getHermesPackageStatusFromService()
    }
    const packages = scanLocalHermesRuntimePackages(
      getRuntimeConfig().runtimeHome || '',
      getRuntimeConfig().runtimeSourceHome || '',
    )
    const bundled = packages.find((item) => item.source === 'bundled')
    const active = bundled || (isPackagedElectronApp() ? null : newestReadyPackage(packages))
    return {
      runtimeId,
      activation: active ? {
        runtimeId,
        activeBuildId: active.runtimeBuildId,
        previousBuildId: packages.filter((item) => item.runtimeBuildId !== active.runtimeBuildId).at(-1)?.runtimeBuildId || null,
        activationRevision: `local-${active.runtimeBuildId}`,
      } : null,
      activeBinding: active,
      packages,
      upstreamLatest: null,
      checkedAt: new Date().toISOString(),
      source: 'local',
    }
  }
  const bundled = runtime.installation.source === 'bundled' && runtime.installation.status === 'ready'
    ? packageFor(runtime)
    : null
  const managedPackages = localRuntimePackages(getRuntimeConfig(), runtimeId)
  if (bundled) {
    const packages = [
      bundled,
      ...managedPackages.filter((item) => item.runtimeBuildId !== bundled.runtimeBuildId),
    ]
    return {
      runtimeId,
      activation: {
        runtimeId,
        activeBuildId: bundled.runtimeBuildId,
        previousBuildId: packages.filter((item) => item.runtimeBuildId !== bundled.runtimeBuildId).at(-1)?.runtimeBuildId || null,
        activationRevision: `local-${bundled.runtimeBuildId}`,
      },
      activeBinding: bundled,
      packages,
      upstreamLatest: null,
      checkedAt: new Date().toISOString(),
      source: 'local',
    }
  }
  if (runtimeServiceBaseUrl()) {
    const response = await runtimeServiceRequest<RuntimePackageServiceResponse>(`/api/runtime-packages/${runtimeId}`)
    return mapRuntimePackageStatus(runtimeId, response)
  }
  const active = newestReadyPackage(managedPackages)
    || (runtime.installation.status === 'ready' ? packageFor(runtime) : null)
  const packages = managedPackages
  const activation: RuntimeActivation | null = active ? {
    runtimeId,
    activeBuildId: active.runtimeBuildId,
    previousBuildId: packages.filter((item) => item.runtimeBuildId !== active.runtimeBuildId).at(-1)?.runtimeBuildId || null,
    activationRevision: `local-${active.runtimeBuildId}`,
  } : null
  return {
    runtimeId,
    activation,
    activeBinding: active,
    packages,
    upstreamLatest: null,
    checkedAt: new Date().toISOString(),
    source: 'local',
  }
}

/**
 * 返回当前激活的真实 Runtime 绑定。
 *
 * Runtime Center 的版本状态和 Runtime 执行器是两个不同的边界：
 * 前者通过 API 返回，后者必须拿到 runtimeDir/executablePath 才能启动。
 * 统一从这里读取，避免各 adapter 又回退到 PATH 中的旧版本。
 */
export async function getActiveRuntimePackage(runtimeId: RuntimeId): Promise<RuntimePackage | null> {
  const status = await getRuntimePackageStatus(runtimeId)
  return status.activeBinding
}

export async function installRuntimePackage(runtimeId: RuntimeId, version: string): Promise<RuntimePackageStatus> {
  if (runtimeServiceBaseUrl() && runtimeId === 'hermes') {
    await runtimeServiceRequest('/api/hermes-runtime/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: version.startsWith('v') ? version : `v${version}` }),
    })
    return getHermesPackageStatusFromService()
  }
  if (runtimeServiceBaseUrl() && runtimeId !== 'hermes') {
    const response = await runtimeServiceRequest<RuntimePackageServiceResponse>(`/api/runtime-packages/${runtimeId}/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    })
    return mapRuntimePackageStatus(runtimeId, response)
  }
  throw new Error('当前 Runtime 未配置 Proma Runtime 版本安装服务。')
}

export async function activateRuntimePackage(runtimeId: RuntimeId, runtimeBuildId: string): Promise<RuntimePackageStatus> {
  if (runtimeServiceBaseUrl() && runtimeId === 'hermes') {
    const status = await getHermesPackageStatusFromService()
    const target = status.packages.find((pkg) => pkg.runtimeBuildId === runtimeBuildId)
    if (!target) throw new Error('目标 Hermes Runtime 版本尚未安装。')
    await runtimeServiceRequest('/api/hermes-runtime/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: target.runtimeVersion }),
    })
    return getHermesPackageStatusFromService()
  }
  if (runtimeServiceBaseUrl() && runtimeId !== 'hermes') {
    const response = await runtimeServiceRequest<RuntimePackageServiceResponse>(`/api/runtime-packages/${runtimeId}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtimeBuildId }),
    })
    return mapRuntimePackageStatus(runtimeId, response)
  }
  const status = await getRuntimePackageStatus(runtimeId)
  if (!status.packages.some((pkg) => pkg.runtimeBuildId === runtimeBuildId)) {
    throw new Error('目标 Runtime 版本尚未安装或不是当前平台版本。')
  }
  return status
}

export async function deleteRuntimePackage(runtimeId: RuntimeId, version: string): Promise<RuntimePackageStatus> {
  if (runtimeServiceBaseUrl() && runtimeId === 'hermes') {
    const status = await getHermesPackageStatusFromService()
    if (status.activation?.activeBuildId && status.packages.find((pkg) => pkg.runtimeBuildId === status.activation?.activeBuildId)?.runtimeVersion === version) {
      throw new Error('当前激活版本不能删除。')
    }
    await runtimeServiceRequest(`/api/hermes-runtime/versions/${encodeURIComponent(version)}`, { method: 'DELETE' })
    return getHermesPackageStatusFromService()
  }
  if (runtimeServiceBaseUrl() && runtimeId !== 'hermes') {
    const response = await runtimeServiceRequest<RuntimePackageServiceResponse>(
      `/api/runtime-packages/${runtimeId}/versions/${encodeURIComponent(version)}`,
      { method: 'DELETE' },
    )
    return mapRuntimePackageStatus(runtimeId, response)
  }
  const status = await getRuntimePackageStatus(runtimeId)
  if (status.packages.some((pkg) => pkg.runtimeVersion === version && pkg.runtimeBuildId === status.activation?.activeBuildId)) {
    throw new Error('当前激活版本不能删除。')
  }
  return status
}

export async function bindNativeRuntime(runtimeId: RuntimeId, executablePath: string): Promise<RuntimePackageStatus> {
  const runtime = detectRuntime(runtimeId)
  if (!runtime) throw new Error(`找不到 Runtime：${runtimeId}`)
  if (!executablePath.trim()) throw new Error('系统 Runtime 路径不能为空。')
  if (runtimeServiceBaseUrl() && runtimeId !== 'hermes') {
    const response = await runtimeServiceRequest<RuntimePackageServiceResponse>(`/api/runtimes/${runtimeId}/native-bindings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executablePath }),
    })
    return mapRuntimePackageStatus(runtimeId, response)
  }
  return getRuntimePackageStatus(runtimeId)
}

export async function unbindNativeRuntime(runtimeId: RuntimeId, buildId: string): Promise<RuntimePackageStatus> {
  if (runtimeServiceBaseUrl() && runtimeId !== 'hermes') {
    const response = await runtimeServiceRequest<RuntimePackageServiceResponse>(
      `/api/runtimes/${runtimeId}/native-bindings/${encodeURIComponent(buildId)}`,
      { method: 'DELETE' },
    )
    return mapRuntimePackageStatus(runtimeId, response)
  }
  return getRuntimePackageStatus(runtimeId)
}
