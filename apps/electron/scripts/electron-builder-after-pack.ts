import { join } from 'node:path'
import { validateCcbRuntimeArtifact } from '../src/main/lib/ccb-runtime/artifact-validator'
import {
  CCB_PROTOCOL_VERSION,
  EXPECTED_CCB_RUNTIME_COMMIT,
  EXPECTED_CCB_RUNTIME_VERSION,
} from '../src/main/lib/ccb-runtime/protocol'
import { refreshSignedRuntimeManifest } from './runtime-manifest-refresh'

interface ElectronBuilderAfterPackContext {
  appOutDir: string
  arch: number
  electronPlatformName: string
}

const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'] as const

function resolveArchName(arch: number): string {
  const archName = ARCH_NAMES[arch]
  if (!archName) {
    throw new Error(`不支持的 electron-builder 架构编号: ${arch}`)
  }
  return archName
}

/**
 * electron-builder 会在复制 Windows extraResources 时自动签名其中的 .exe，
 * Authenticode 会改变 rg.exe 字节。此 Hook 在复制完成后刷新对应哈希，避免
 * 安装后的 Runtime 完整性校验误报。
 */
export function refreshPackagedCcbRuntime(
  context: ElectronBuilderAfterPackContext,
): string[] {
  if (context.electronPlatformName !== 'win32') return []

  const runtimeRoot = join(context.appOutDir, 'resources', 'ccb-runtime')
  const changedFiles = refreshSignedRuntimeManifest(runtimeRoot, {
    allowChangedFile: file => file.path.toLowerCase().endsWith('.exe'),
  })

  validateCcbRuntimeArtifact(runtimeRoot, {
    runtimeVersion: EXPECTED_CCB_RUNTIME_VERSION,
    gitCommit: EXPECTED_CCB_RUNTIME_COMMIT,
    protocolVersion: CCB_PROTOCOL_VERSION,
    platform: context.electronPlatformName,
    arch: resolveArchName(context.arch),
  })

  console.log(
    changedFiles.length > 0
      ? `[CCB Runtime] 已刷新 Windows 签名文件哈希: ${changedFiles.join(', ')}`
      : '[CCB Runtime] Windows Runtime Manifest 校验通过，无需刷新',
  )
  return changedFiles
}

export default refreshPackagedCcbRuntime
