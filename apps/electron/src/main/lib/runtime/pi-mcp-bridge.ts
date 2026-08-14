/**
 * Pi Runtime MCP 桥接。
 *
 * Proma 主进程把内置/外部 MCP Server 编译为 HTTP 端点（materialize 后）放进
 * `AgentQueryInput.mcpServers`。Pi Worker 本身不带 MCP client，这里在宿主侧
 * 连接这些端点、列出工具，并把工具转成 Pi `customTools` 可识别的 externalTools
 * 通过 startRun 传给 Worker；Worker 调用工具时经 `tool.request` 桥回到这里，
 * 再由 MCP client 转发到对应 Server。collaboration 子 Agent 工具（delegate_*）
 * 就是通过这条链路暴露给 Pi 的。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/** 传给 Pi Worker 的外部工具描述（parameters 为 JSON Schema，TypeBox 兼容）。 */
export interface PiExternalTool {
  name: string
  label?: string
  description?: string
  promptSnippet?: string
  parameters?: Record<string, unknown>
}

interface McpServerConnection {
  client: Client
  tools: PiExternalTool[]
}

interface PiToolTextContent {
  type: 'text'
  text: string
}

interface PiToolImageContent {
  type: 'image'
  data: string
  mimeType: string
}

interface PiRichToolResult {
  content: Array<PiToolTextContent | PiToolImageContent>
  details: unknown
}

export function normalizePiMcpToolResult(result: {
  content?: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: string }
  >
  [key: string]: unknown
}): string | PiRichToolResult | typeof result {
  const content = result.content
  if (!Array.isArray(content)) return result
  const normalized = content.flatMap((block): Array<PiToolTextContent | PiToolImageContent> => {
    if (block.type === 'text' && 'text' in block) return [{ type: 'text', text: block.text }]
    if (block.type === 'image' && 'data' in block && 'mimeType' in block) {
      return [{ type: 'image', data: block.data, mimeType: block.mimeType }]
    }
    return []
  })
  if (normalized.some((block) => block.type === 'image')) {
    return { content: normalized, details: result }
  }
  const text = normalized
    .filter((block): block is PiToolTextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  return text || result
}

/**
 * 连接 mcpServers 中的 HTTP 端点并聚合工具列表。
 * 仅处理 `type: 'http'` 的端点（Proma 内置工具 materialize 后的形态）；
 * stdio 外部 server 不在 Pi 桥接范围内（保持简单，避免在宿主侧管理子进程）。
 */
export class PiMcpBridge {
  private readonly connections: McpServerConnection[] = []
  private readonly toolToClient = new Map<string, Client>()
  /** 已编译好的外部工具列表缓存：同一 session 跨轮复用连接，避免重复 initialize 被 server 拒绝 */
  private cachedTools: PiExternalTool[] | null = null

  /** 连接所有 HTTP MCP 端点，返回可传给 Pi Worker 的 externalTools。 */
  async collectExternalTools(mcpServers: Record<string, unknown> | undefined): Promise<PiExternalTool[]> {
    // 幂等：已有连接与工具缓存时直接复用，不重复 connect。
    // Proma 内置 MCP HTTP Host 的 StreamableHTTP 端点是 stateful 单会话的，
    // 同一 endpoint 第二次 initialize 会被 server 以 "Server already initialized" 拒绝。
    if (this.cachedTools) return this.cachedTools
    if (!mcpServers) return []
    const collected: PiExternalTool[] = []
    for (const [serverName, rawConfig] of Object.entries(mcpServers)) {
      const config = (rawConfig && typeof rawConfig === 'object' ? rawConfig : {}) as Record<string, unknown>
      if (config?.type !== 'http' || typeof config.url !== 'string') continue
      try {
        const client = new Client({ name: `proma-pi-${serverName}`, version: '1.0.0' })
        const headers = (config.headers && typeof config.headers === 'object')
          ? config.headers as Record<string, string>
          : undefined
        const transport = new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: headers ? { headers } : undefined,
        })
        await client.connect(transport)
        const listed = await client.listTools()
        const tools: PiExternalTool[] = (listed.tools || []).map((tool) => {
          // MCP 工具名可能与 Pi 内置/其它 server 冲突，加 server 前缀唯一化；
          // 但 collaboration 的子 Agent 工具保持原名，便于模型按约定识别 delegate_*。
          const rawName = String(tool.name)
          const name = serverName === 'collaboration' ? rawName : `mcp__${serverName}__${rawName}`
          const mapped: PiExternalTool = {
            name,
            label: rawName.replaceAll('_', ' '),
            description: tool.description || `Proma MCP 工具 ${rawName}`,
            promptSnippet: tool.description ? `${name}: ${String(tool.description).slice(0, 80)}` : '',
            parameters: (tool.inputSchema && typeof tool.inputSchema === 'object'
              ? tool.inputSchema
              : { type: 'object', properties: {} }) as Record<string, unknown>,
          }
          this.toolToClient.set(name, client)
          return mapped
        })
        this.connections.push({ client, tools })
        collected.push(...tools)
      } catch (error) {
        console.warn(`[Proma Pi MCP 桥接] 连接 MCP Server "${serverName}" 失败:`, error instanceof Error ? error.message : error)
      }
    }
    this.cachedTools = collected
    return collected
  }

  /** Pi Worker `tool.request` 的宿主处理器：把工具调用转发到对应 MCP Server。 */
  async handleToolCall(name: string, params: Record<string, unknown>): Promise<unknown> {
    const client = this.toolToClient.get(name)
    if (!client) throw new Error(`未知的 Pi 外部工具：${name}`)
    const result = await client.callTool({ name: this.originalToolName(name), arguments: params })
    return normalizePiMcpToolResult(result)
  }

  /** 还原加前缀的工具名为 MCP Server 上的原始名。 */
  private originalToolName(name: string): string {
    // mcp__server__tool → tool；collaboration 工具未加前缀，直接返回
    const match = name.match(/^mcp__[^_]+__([\s\S]+)$/)
    return match ? match[1]! : name
  }

  /** 释放所有 MCP 连接。 */
  async dispose(): Promise<void> {
    for (const connection of this.connections) {
      await connection.client.close().catch(() => undefined)
    }
    this.connections.length = 0
    this.toolToClient.clear()
    this.cachedTools = null
  }
}
