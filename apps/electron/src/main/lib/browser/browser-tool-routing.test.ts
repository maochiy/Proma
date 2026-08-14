import { describe, expect, test } from 'bun:test'
import { nativeBrowserToolDenial } from './browser-tool-routing'

describe('模型浏览器工具路由', () => {
  test('Given Claude in Chrome 或 Playwright When 请求工具 Then 强制改用 Proma 内置浏览器', () => {
    expect(nativeBrowserToolDenial('mcp__claude-in-chrome__tabs_create_mcp', {}))
      .toContain('mcp__browser__browser_*')
    expect(nativeBrowserToolDenial('mcp__playwright__browser_click', {}))
      .toContain('browser_get_state')
  })

  test('Given Computer Use 申请控制浏览器 When 权限检查 Then 拒绝系统级浏览器控制', () => {
    const denial = nativeBrowserToolDenial('mcp__computer-use__request_access', {
      apps: [{ displayName: 'Google Chrome' }],
    })

    expect(denial).toContain('Computer Use 不允许控制')
  })

  test('Given Computer Use 控制非网页桌面应用 When 权限检查 Then 保留桌面自动化能力', () => {
    expect(nativeBrowserToolDenial('mcp__computer-use__request_access', {
      apps: [{ displayName: 'Microsoft Excel' }],
    })).toBeUndefined()
    expect(nativeBrowserToolDenial('mcp__computer-use__left_click', {
      coordinate: [120, 240],
    })).toBeUndefined()
  })
})
