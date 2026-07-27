/**
 * Proma 内置 MCP 注册中心
 *
 * Orchestrator 只调用这里的统一入口；各内置 MCP 的可用性、注入条件和错误隔离
 * 都收敛在本模块，避免主编排流程继续膨胀。
 */

import type { AgentSessionMeta, PromaPermissionMode } from '@proma/shared'
import { injectAgentCollaborationMcpServer } from '../agent-collaboration-tools'
import { injectAutomationMcpServer } from '../automation-agent-tools'
import { injectNanoBananaMcpServer } from '../chat-tools/nano-banana-mcp'
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

  const collaborationAvailable = isBuiltinMcpUserEnabled('collaboration') &&
    !!ctx.workspaceId &&
    ctx.triggeredBy !== 'delegation' &&
    (ctx.sessionMeta?.delegationDepth ?? 0) === 0

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
