import { describe, expect, test } from 'bun:test'
import {
  buildUnsignedMacInstallerScript,
  resolveMacAppBundlePath,
  validateMacUpdateIdentity,
} from './unsigned-mac-installer'

describe('未签名 macOS 更新安装器', () => {
  test('Given Electron 可执行文件路径 When 解析 Bundle Then 返回最外层 App 路径', () => {
    expect(
      resolveMacAppBundlePath('/Applications/Proma.app/Contents/MacOS/Proma'),
    ).toBe('/Applications/Proma.app')
  })

  test('Given 路径不在 App Bundle 中 When 解析 Then 拒绝执行替换', () => {
    expect(() => resolveMacAppBundlePath('/usr/local/bin/proma')).toThrow(
      '无法从可执行文件路径定位 macOS App',
    )
  })

  test('Given 更新包身份一致 When 校验 Then 通过', () => {
    expect(() => {
      validateMacUpdateIdentity('com.proma.app', '0.15.52', 'com.proma.app', '0.15.52')
    }).not.toThrow()
  })

  test('Given Bundle ID 或版本不一致 When 校验 Then 拒绝安装', () => {
    expect(() => {
      validateMacUpdateIdentity('com.example.fake', '0.15.52', 'com.proma.app', '0.15.52')
    }).toThrow('Bundle ID 不匹配')
    expect(() => {
      validateMacUpdateIdentity('com.proma.app', '9.9.9', 'com.proma.app', '0.15.52')
    }).toThrow('版本不匹配')
  })

  test('Given 生成辅助脚本 When 检查流程 Then 包含等待、备份、回滚与解除隔离', () => {
    const script = buildUnsignedMacInstallerScript()
    expect(script).toContain('/bin/kill -0 "$APP_PID"')
    expect(script).toContain('检测到上次安装中断，先恢复旧版本')
    expect(script).toContain('/bin/mv "$TARGET_APP" "$BACKUP_APP"')
    expect(script).toContain('/usr/bin/ditto "$STAGED_APP" "$TARGET_APP"')
    expect(script).toContain('/usr/bin/xattr -rd com.apple.quarantine "$TARGET_APP"')
    expect(script).toContain('新版本启动失败，正在恢复旧版本')
    expect(script).toContain('更新复制失败，正在恢复旧版本')
  })
})
