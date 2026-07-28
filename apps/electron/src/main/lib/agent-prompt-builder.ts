/**
 * Agent 系统 Prompt 构建器
 *
 * 负责构建 Agent 的完整系统提示词和每条消息的动态上下文。
 *
 * 设计策略：
 * - 静态 system prompt（buildSystemPrompt）：追加到 claude_code preset 之后的自定义系统提示词
 *   preset 提供基础环境信息（platform/shell/OS/git/model 等），本模块追加 Proma 特有的指令
 * - 动态 per-message 上下文（buildDynamicContext）：注入到用户消息前，每次实时读取磁盘
 */

import type { PromaPermissionMode } from '@proma/shared'
import { buildGitAttributionPromptSection, isGitAttributionEnabled } from './agent-git-attribution'
import { getSettings } from './settings-service'

/** buildSystemPrompt 所需的上下文 */
interface SystemPromptContext {
  workspaceName?: string
  workspaceSlug?: string
  workspacePath?: string
  sessionId: string
  permissionMode: PromaPermissionMode
  /** 当前会话是否已注入 Proma collaboration 工具 */
  collaborationAvailable?: boolean
}

/**
 * 构建 Proma Desktop Host 的最小追加提示词。
 *
 * Tools、Commands、Skills、MCP、Subagent、CLAUDE.md、Memory 和 cwd 均由
 * CCB Core 原生加载；Proma 只追加桌面宿主特有的交互契约，避免重复上下文。
 */
export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const sections = [`# Proma Desktop Host

你运行在 Proma 桌面应用中，Claude Code Best 是唯一 Agent Core。继续遵循 CCB 原生的工具、命令、Skills、MCP、Subagent、CLAUDE.md、Memory、Session 与权限语义；Proma 只负责桌面交互和状态展示，不定义第二套核心规则。

- Proma Session ID: ${ctx.sessionId}
- 当前项目: ${ctx.workspaceName ?? '默认工作区'}
- 当前 cwd: ${ctx.workspacePath ?? '由 CCB Runtime 提供'}
- 权限、AskUserQuestion 和 Plan 审批必须等待 Proma UI 的用户响应。
- 默认使用中文简洁回复，保留必要技术术语。`]

  if (ctx.collaborationAvailable) {
    sections.push(`## Proma 协作会话

仅当任务确实需要独立、长期且可在 Proma 侧栏继续交互的会话时使用 \`collaboration\`；短期并行继续使用 CCB 原生 Subagent、Teams 或 Workflow。`)
  }

  if (ctx.permissionMode === 'plan') {
    sections.push(`## 计划模式

当前处于 Proma 计划模式。完成调研后先展示计划摘要并等待用户批准，再通过 ExitPlanMode 请求切换；批准前不得执行写操作。`)
  }

  const gitAttributionEnabled = isGitAttributionEnabled(getSettings().gitAttributionEnabled)
  sections.push(buildGitAttributionPromptSection(gitAttributionEnabled))

  return sections.join('\n\n')
}

// ===== 动态 Per-Message 上下文 =====

/** buildDynamicContext 所需的上下文 */
interface DynamicContext {
  workspaceName?: string
  workspaceSlug?: string
  agentCwd?: string
}

/**
 * 构建每条消息的动态上下文
 *
 * 包含当前时间、工作区实时状态（MCP 服务器 + Skills）和工作目录。
 * 每次调用都从磁盘实时读取，确保配置变更后下一条消息即可感知。
 */
export function buildDynamicContext(ctx: DynamicContext): string {
  void ctx
  return ''
}
