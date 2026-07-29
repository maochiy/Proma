import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type FileExists = (path: string) => boolean

export function resolveAppUpdateConfigPath(resourcesPath: string): string {
  return join(resourcesPath, 'app-update.yml')
}

/**
 * 本地签名包由 --dir 产物手动创建 DMG，不包含 electron-updater 生成的
 * app-update.yml。此时应关闭更新器，避免每次启动都产生 ENOENT。
 */
export function hasAppUpdateConfiguration(
  resourcesPath: string,
  fileExists: FileExists = existsSync,
): boolean {
  return fileExists(resolveAppUpdateConfigPath(resourcesPath))
}
