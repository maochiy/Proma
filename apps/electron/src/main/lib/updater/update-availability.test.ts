import { describe, expect, test } from 'bun:test'
import {
  hasAppUpdateConfiguration,
  resolveAppUpdateConfigPath,
} from './update-availability'

describe('macOS 本地构建自动更新可用性', () => {
  test('Given 正式发布包包含 app-update.yml When 检查 Then 启用更新器', () => {
    const expectedPath = '/Applications/Proma.app/Contents/Resources/app-update.yml'
    expect(resolveAppUpdateConfigPath('/Applications/Proma.app/Contents/Resources')).toBe(expectedPath)
    expect(hasAppUpdateConfiguration(
      '/Applications/Proma.app/Contents/Resources',
      path => path === expectedPath,
    )).toBe(true)
  })

  test('Given 本地签名包不含 app-update.yml When 检查 Then 禁用更新器', () => {
    expect(hasAppUpdateConfiguration(
      '/Applications/Proma.app/Contents/Resources',
      () => false,
    )).toBe(false)
  })
})
