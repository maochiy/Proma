/**
 * 联网搜索工具模块（Chat 模式）
 *
 * 基于 OpenSwitch 搜索接口提供实时联网搜索能力。
 * 凭据复用 OpenSwitch 登录渠道的 API Key，登录即用、无需配置。
 */

import type { ToolCall, ToolResult, ToolDefinition } from '@proma/core'
import type { ChatToolMeta } from '@proma/shared'
import {
  formatSearchResults,
  searchWeb,
} from '../web-search-service'
import { getToolState } from '../chat-tool-config'
export { isWebSearchAvailable } from '../web-search-service'

// ===== 工具元数据 =====

export const WEB_SEARCH_TOOL_META: ChatToolMeta = {
  id: 'web-search',
  name: '联网搜索',
  description: '实时搜索互联网获取最新信息',
  params: [
    { name: 'query', type: 'string', description: '搜索查询', required: true },
  ],
  icon: 'Globe',
  category: 'builtin',
  executorType: 'builtin',
  systemPromptAppend: `
<web_search_instructions>
你拥有联网搜索能力。

**web_search — 搜索：**
当用户询问你不确定或可能过时的信息时主动调用：
- 时事新闻、最新数据、实时信息
- 你不确定的事实性问题
- 用户明确要求搜索或查找信息

**调用约束（重要）：**
- 同一轮用户问题默认只调用 **1 次** web_search，不要并行发中英文两次。
- 选择信息密度最高的一组关键词：中文问题优先中文；若主题偏国际资讯可用英文；二选一即可。
- 仅当首次结果明显不足（空结果/完全不相关）时，才允许再换关键词追加 1 次。
- 禁止为了“中英各搜一遍”而重复调用。

搜索时使用简洁明确的关键词，返回结果后综合整理回答用户。
</web_search_instructions>`,
}

// ===== 工具定义（ToolDefinition 格式，传给 Provider） =====

export const WEB_SEARCH_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Search the internet for real-time information. Use this when the user asks about current events, recent data, or information you are unsure about.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
      },
      required: ['query'],
    },
  },
]

// ===== 工具执行 =====

/** 搜索工具名称集合 */
const WEB_SEARCH_TOOL_NAMES = new Set(['web_search'])

/**
 * 判断是否为搜索工具调用
 */
export function isWebSearchToolCall(toolName: string): boolean {
  return WEB_SEARCH_TOOL_NAMES.has(toolName)
}

/**
 * 执行联网搜索工具调用
 */
export async function executeWebSearchTool(toolCall: ToolCall): Promise<ToolResult> {
  try {
    // 对话工具面板开关：关闭后拒绝执行（即使模型仍发起 tool call）
    if (!getToolState('web-search').enabled) {
      return {
        toolCallId: toolCall.id,
        content: '联网搜索已关闭。请在对话工具面板中重新开启后再试。',
        isError: true,
      }
    }

    const query = toolCall.arguments.query as string | undefined

    if (!query) {
      return {
        toolCallId: toolCall.id,
        content: '搜索参数缺失: query',
        isError: true,
      }
    }

    const data = await searchWeb({ query })
    return {
      toolCallId: toolCall.id,
      content: formatSearchResults(data),
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[联网搜索] 执行失败:`, error)
    return {
      toolCallId: toolCall.id,
      content: `Search failed: ${msg}`,
      isError: true,
    }
  }
}
