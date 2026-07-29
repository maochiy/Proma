import { describe, expect, test } from 'bun:test'
import { resolveMainWindowIconPath } from './app-icon-path'

describe('macOS 主窗口图标路径', () => {
  test('Given 打包后的 App When 解析图标 Then 从 Contents/Resources 读取', () => {
    expect(resolveMainWindowIconPath({
      isPackaged: true,
      resourcesPath: '/Applications/Proma.app/Contents/Resources',
      moduleDirectory: '/Applications/Proma.app/Contents/Resources/app.asar/dist',
      platform: 'darwin',
    })).toBe('/Applications/Proma.app/Contents/Resources/icon.icns')
  })

  test('Given 开发环境 When 解析图标 Then 从 dist/resources 读取', () => {
    expect(resolveMainWindowIconPath({
      isPackaged: false,
      resourcesPath: '/unused',
      moduleDirectory: '/repo/apps/electron/dist',
      platform: 'darwin',
    })).toBe('/repo/apps/electron/dist/resources/icon.icns')
  })
})
