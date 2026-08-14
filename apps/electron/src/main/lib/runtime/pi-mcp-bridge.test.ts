import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { promaBuiltinMcpHttpHost } from '../builtin-mcp/http-host'
import { builtinMcpToolFactory } from '../builtin-mcp/tool-definition'
import { normalizePiMcpToolResult, PiMcpBridge } from './pi-mcp-bridge'

/** 模拟 collaboration 子 Agent 工具（delegate_* 命名约定） */
function createCollabServer() {
  return builtinMcpToolFactory.createSdkMcpServer({
    name: 'collaboration',
    version: '1.0.0',
    tools: [
      builtinMcpToolFactory.tool(
        'delegate_agent',
        '创建一个真实可见的 Proma 协作子 Agent 会话',
        { task: z.string() },
        async ({ task }) => ({ content: [{ type: 'text', text: `子会话已启动: ${task}` }] }),
      ),
    ],
  })
}

/** 普通（非 collaboration）MCP server，验证加前缀 */
function createSearchServer() {
  return builtinMcpToolFactory.createSdkMcpServer({
    name: 'websearch',
    version: '1.0.0',
    tools: [
      builtinMcpToolFactory.tool(
        'search',
        '搜索',
        { query: z.string() },
        async ({ query }) => ({ content: [{ type: 'text', text: `结果:${query}` }] }),
      ),
    ],
  })
}

afterEach(async () => {
  await promaBuiltinMcpHttpHost.shutdown()
})

describe('Pi MCP 桥接', () => {
  test('Given collaboration 端点 When 收集工具 Then delegate_* 保持原名且可调用', async () => {
    const mcpServers = await promaBuiltinMcpHttpHost.materialize('sess-collab', { collaboration: createCollabServer() })
    const bridge = new PiMcpBridge()
    const tools = await bridge.collectExternalTools(mcpServers)

    expect(tools.map((t) => t.name)).toContain('delegate_agent')
    const result = await bridge.handleToolCall('delegate_agent', { task: '读后端' })
    expect(String(result)).toContain('子会话已启动')
    await bridge.dispose()
  })

  test('Given 普通 MCP server When 收集工具 Then 加 mcp__server__ 前缀并正确还原调用', async () => {
    const mcpServers = await promaBuiltinMcpHttpHost.materialize('sess-search', { websearch: createSearchServer() })
    const bridge = new PiMcpBridge()
    const tools = await bridge.collectExternalTools(mcpServers)

    expect(tools.map((t) => t.name)).toContain('mcp__websearch__search')
    const result = await bridge.handleToolCall('mcp__websearch__search', { query: 'pi' })
    expect(String(result)).toContain('结果:pi')
    await bridge.dispose()
  })

  test('Given 未知工具名 When 调用 Then 抛出明确错误', async () => {
    const bridge = new PiMcpBridge()
    await expect(bridge.handleToolCall('nonexistent_tool', {})).rejects.toThrow('未知的 Pi 外部工具')
    await bridge.dispose()
  })

  test('Given MCP 返回图片 When 投影给 Pi Then 保留标准图片内容块', () => {
    const result = normalizePiMcpToolResult({
      content: [
        { type: 'text', text: '已截图' },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
      ],
    })

    expect(result).toMatchObject({
      content: [
        { type: 'text', text: '已截图' },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
      ],
    })
  })

  test('Given 空 mcpServers When 收集工具 Then 返回空数组', async () => {
    const bridge = new PiMcpBridge()
    expect(await bridge.collectExternalTools(undefined)).toEqual([])
    expect(await bridge.collectExternalTools({})).toEqual([])
    await bridge.dispose()
  })
})
