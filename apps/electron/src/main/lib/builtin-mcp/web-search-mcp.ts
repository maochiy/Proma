/**
 * 联网搜索 MCP Server（Agent 模式）
 *
 * 基于 OpenSwitch 搜索接口（WebSearch）+ 本地网页抓取（WebFetch），
 * 通过内置 MCP 注入到每个 Agent 会话，替代 CCB 原生 WebSearch/WebFetch。
 *
 * 工具名刻意与原生工具同名（WebSearch/WebFetch）：
 * - 命中 auto/plan 权限模式的只读工具白名单，无需审批；
 * - 模型按原生使用习惯即可调用。
 *
 * 凭据复用 OpenSwitch 登录渠道的 API Key（见 web-search-service）。
 */

import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { getBuiltinMcpName } from './baseline'
import type { BuiltinMcpToolFactory } from './tool-definition'
import {
  fetchWebPage,
  formatFetchResults,
  formatSearchResults,
  searchWeb,
} from '../web-search-service'

function okResult(text: string): CallToolResult {
  return { content: [{ type: 'text' as const, text }] }
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text' as const, text }], isError: true }
}

/**
 * 注入联网搜索内置 MCP Server。
 * 可用性由服务层决定：未登录 OpenSwitch 时工具返回引导错误的文本，
 * Agent 可读懂并告知用户，不影响会话主流程。
 */
export function injectWebSearchMcpServer(
  factory: BuiltinMcpToolFactory,
  mcpServers: Record<string, Record<string, unknown>>,
): void {
  const webSearchTool = factory.tool(
    'WebSearch',
    'Search the internet for real-time information via OpenSwitch. Use this when the user asks about current events, recent data, or information you are unsure about. ALWAYS use this tool instead of any built-in web search capability.',
    {
      query: z.string().describe('Search query string'),
      max_results: z.number().int().min(1).max(10).optional()
        .describe('Maximum number of results (default 5, max 10)'),
      search_depth: z.enum(['basic', 'advanced']).optional()
        .describe('Search depth: basic (fast) or advanced (thorough)'),
      include_domains: z.array(z.string()).optional()
        .describe('Only include results from these domains'),
      exclude_domains: z.array(z.string()).optional()
        .describe('Exclude results from these domains'),
    },
    async (args) => {
      try {
        const data = await searchWeb({
          query: args.query,
          maxResults: args.max_results,
          searchDepth: args.search_depth,
          includeDomains: args.include_domains,
          excludeDomains: args.exclude_domains,
        })
        return okResult(formatSearchResults(data))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[联网搜索 MCP] WebSearch 执行失败:', error)
        return errorResult(`Search failed: ${message}`)
      }
    },
    { annotations: { readOnlyHint: true } },
  )

  const webFetchTool = factory.tool(
    'WebFetch',
    'Fetch a web page and extract its main text content. Use this to read the full content of a URL found via WebSearch or provided by the user. ALWAYS use this tool instead of any built-in web fetch capability.',
    {
      url: z.string().describe('The http/https URL to fetch'),
      max_chars: z.number().int().min(1000).max(80000).optional()
        .describe('Maximum characters of extracted content (default 20000)'),
    },
    async (args) => {
      try {
        const data = await fetchWebPage({ url: args.url, maxChars: args.max_chars })
        const text = formatFetchResults(data, { maxChars: args.max_chars })
        if (data.failedResults && data.failedResults.length > 0 && data.results.length === 0) {
          return errorResult(text)
        }
        return okResult(text)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[联网搜索 MCP] WebFetch 执行失败:', error)
        return errorResult(`Fetch failed: ${message}`)
      }
    },
    { annotations: { readOnlyHint: true } },
  )

  mcpServers[getBuiltinMcpName('web-search')] = factory.createSdkMcpServer({
    name: getBuiltinMcpName('web-search'),
    version: '1.0.0',
    tools: [webSearchTool, webFetchTool],
  }) as unknown as Record<string, unknown>
}
