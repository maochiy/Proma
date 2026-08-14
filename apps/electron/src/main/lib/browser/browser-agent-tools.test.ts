import { describe, expect, test } from 'bun:test'
import {
  browserErrorResult,
  createBrowserScreenshotResult,
} from './browser-agent-tools'

describe('Browser Agent 工具结果', () => {
  test('Given 浏览器动作失败 When 返回 MCP 结果 Then 标记为工具错误', () => {
    const result = browserErrorResult('打开失败')

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: '打开失败' }])
  })

  test('Given 无效截图数据 When 构建结果 Then 标记为工具错误', () => {
    const result = createBrowserScreenshotResult('invalid')

    expect(result.isError).toBe(true)
  })
})
