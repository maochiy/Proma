import { join } from 'node:path'

export interface ResolveMainWindowIconPathInput {
  isPackaged: boolean
  resourcesPath: string
  moduleDirectory: string
  platform: NodeJS.Platform
}

function getIconFileName(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'icon.icns'
  if (platform === 'win32') return 'icon.ico'
  return 'icon.png'
}

/**
 * 解析 BrowserWindow 图标路径。
 *
 * 开发环境的资源由 build:resources 复制到 dist/resources；打包后资源位于
 * process.resourcesPath，不能再从 app.asar 内的 __dirname 查找。
 */
export function resolveMainWindowIconPath(
  input: ResolveMainWindowIconPathInput,
): string {
  const fileName = getIconFileName(input.platform)
  return input.isPackaged
    ? join(input.resourcesPath, fileName)
    : join(input.moduleDirectory, 'resources', fileName)
}
