/**
 * 校验安装包是否包含随 Proma 分发的内置 Runtime。
 *
 * Pi / Codex / Claude 必须在安装时即可用，不能依赖用户 PATH 中的
 * `pi` / `codex` / `claude`。Hermes 目前没有随包 Python，这里不伪造 extraResources。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronBuilderPlatform } from './packaged-cli-guard'

export function resolvePackagedResourcesRoot(
  appOutDir: string,
  electronPlatformName: ElectronBuilderPlatform,
  productName = 'Proma',
): string {
  if (electronPlatformName === 'darwin') {
    return join(appOutDir, `${productName}.app`, 'Contents', 'Resources')
  }
  return join(appOutDir, 'resources')
}

const BUNDLED_RUNTIME_FILES: Array<{ label: string; candidates: string[] }> = [
  {
    label: 'Pi Worker',
    candidates: ['pi-runtime/workers/pi-worker.mjs'],
  },
  {
    label: '@earendil-works/pi-coding-agent',
    candidates: [
      'app.asar.unpacked/node_modules/@earendil-works/pi-coding-agent/package.json',
      'app/node_modules/@earendil-works/pi-coding-agent/package.json',
    ],
  },
  {
    label: '@openai/codex',
    candidates: [
      'app.asar.unpacked/node_modules/@openai/codex/package.json',
      'app/node_modules/@openai/codex/package.json',
    ],
  },
  {
    label: '@anthropic-ai/claude-agent-sdk',
    candidates: [
      'app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/package.json',
      'app/node_modules/@anthropic-ai/claude-agent-sdk/package.json',
    ],
  },
]

export function ensurePackagedBundledRuntimes(
  appOutDir: string,
  electronPlatformName: ElectronBuilderPlatform,
): string[] {
  const resourcesRoot = resolvePackagedResourcesRoot(appOutDir, electronPlatformName)
  const missing = BUNDLED_RUNTIME_FILES.filter((item) =>
    !item.candidates.some((relativePath) => existsSync(join(resourcesRoot, relativePath))),
  )
  if (missing.length === 0) {
    return BUNDLED_RUNTIME_FILES.map((item) => item.label)
  }
  throw new Error(
    `安装包缺少内置 Runtime：${missing.map((item) => item.label).join('、')}。Pi / Codex / Claude 必须随 Proma 安装包分发，不能依赖用户 PATH。`,
  )
}
