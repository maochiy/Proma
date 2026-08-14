/**
 * Proma 内置 MCP 注册中心
 *
 * Orchestrator 只调用这里的统一入口；各内置 MCP 的可用性、注入条件和错误隔离
 * 都收敛在本模块，避免主编排流程继续膨胀。
 */

import type { AgentSessionMeta, PromaPermissionMode } from '@proma/shared'
import { injectAgentCollaborationMcpServer, userRequestedSubAgents } from '../agent-collaboration-tools'
import { injectAutomationMcpServer } from '../automation-agent-tools'
import { injectNanoBananaMcpServer } from '../chat-tools/nano-banana-mcp'
import { injectWebSearchMcpServer } from './web-search-mcp'
import { injectBrowserAgentMcpServer } from '../browser/browser-agent-tools'
import { isBuiltinMcpUserEnabled } from './settings'
import { builtinMcpToolFactory } from './tool-definition'
import { promaBuiltinMcpHttpHost } from './http-host'

export interface BuiltinMcpInjectContext {
  mcpServers: Record<string, Record<string, unknown>>
  sessionId: string
  channelId: string
  modelId?: string
  workspaceId?: string
  workspaceSlug?: string
  agentCwd?: string
  permissionMode?: PromaPermissionMode
  triggeredBy?: 'user' | 'automation' | 'delegation'
  sessionMeta?: AgentSessionMeta
}

async function injectBuiltinSafely(name: string, task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch (error) {
    console.error(`[Agent 编排] 注入内置 MCP 失败 (${name}):`, error)
  }
}

export async function injectBuiltinMcpServers(ctx: BuiltinMcpInjectContext): Promise<{ collaborationAvailable: boolean }> {
  // 联网搜索是基础设施型能力（toggleable: false）：始终注入，
  // 可用性由服务层 OpenSwitch 登录态决定。
  await injectBuiltinSafely('web-search', async () => {
    injectWebSearchMcpServer(builtinMcpToolFactory, ctx.mcpServers)
  })

  // 内置浏览器 Agent 控制：基础设施型能力，始终注入。Agent 调用 browser_* 工具
  // 时才创建浏览器任务并显示在悬浮面板；不调用则无任何副作用。
  await injectBuiltinSafely('browser', async () => {
    await injectBrowserAgentMcpServer(builtinMcpToolFactory, ctx.mcpServers, { sessionId: ctx.sessionId })
  })

  if (isBuiltinMcpUserEnabled('nano-banana')) {
    await injectBuiltinSafely('nano-banana', () => injectNanoBananaMcpServer(
      builtinMcpToolFactory,
      ctx.mcpServers,
      ctx.sessionId,
      ctx.agentCwd,
    ))
  }

  if (isBuiltinMcpUserEnabled('automation')) {
    await injectBuiltinSafely('automation', () => injectAutomationMcpServer(builtinMcpToolFactory, ctx.mcpServers, {
      sessionId: ctx.sessionId,
      channelId: ctx.channelId,
      modelId: ctx.modelId,
      workspaceId: ctx.workspaceId,
      triggeredBy: ctx.triggeredBy,
    }))
  }

  // 子 Agent 硬开关：除设置开关外，还要求用户在当前对话明确说了要开多个/并行子
  // 智能体（userRequestedSubAgents），否则不注入 delegate_* 工具——模型看不到即不会调用。
  // Claude Code / Codex 运行时内部派生子 Agent 走各自 SDK 通道，不经过此注入，不受限制。
  const collaborationAvailable = isBuiltinMcpUserEnabled('collaboration') &&
    !!ctx.workspaceId &&
    ctx.triggeredBy !== 'delegation' &&
    (ctx.sessionMeta?.delegationDepth ?? 0) === 0 &&
    userRequestedSubAgents(ctx.sessionId)

  if (collaborationAvailable) {
    await injectBuiltinSafely('collaboration', () => injectAgentCollaborationMcpServer(builtinMcpToolFactory, ctx.mcpServers, {
      sessionId: ctx.sessionId,
      channelId: ctx.channelId,
      modelId: ctx.modelId,
      workspaceId: ctx.workspaceId,
      permissionMode: ctx.permissionMode,
      triggeredBy: ctx.triggeredBy,
    }))
  }

  const materialized = await promaBuiltinMcpHttpHost.materialize(ctx.sessionId, ctx.mcpServers)
  for (const key of Object.keys(ctx.mcpServers)) delete ctx.mcpServers[key]
  Object.assign(ctx.mcpServers, materialized)

  return { collaborationAvailable }
}
