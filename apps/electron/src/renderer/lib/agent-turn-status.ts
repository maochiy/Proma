import type { SDKContentBlock, SDKToolUseBlock } from '@proma/shared'

export type AgentTurnStatus =
  | 'thinking'
  | 'running-command'
  | 'reading-files'
  | 'searching'
  | 'editing-files'
  | 'browsing-web'
  | 'calling-subagent'
  | 'using-tool'
  | 'activity-completed'
  | 'completed'
  | 'failed'
  | 'stopped'

const COMMAND_TOOLS = /^(Bash|Shell|Execute|Terminal|run_command)$/i
const READ_TOOLS = /^(Read|NotebookRead|read_file)$/i
const SEARCH_TOOLS = /^(Grep|Glob|Search|FileSearch|search_files)$/i
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/i
const WEB_TOOLS = /(Web|Browser|Fetch|SearchWeb|web_search)/i
const SUBAGENT_TOOLS = /^(Agent|Task|Delegate)|collaboration|delegate_agent/i

function resolveToolStatus(toolName: string): AgentTurnStatus {
  if (COMMAND_TOOLS.test(toolName)) return 'running-command'
  if (READ_TOOLS.test(toolName)) return 'reading-files'
  if (SEARCH_TOOLS.test(toolName)) return 'searching'
  if (EDIT_TOOLS.test(toolName)) return 'editing-files'
  if (WEB_TOOLS.test(toolName)) return 'browsing-web'
  if (SUBAGENT_TOOLS.test(toolName)) return 'calling-subagent'
  return 'using-tool'
}

export function getLastUnfinishedToolName(
  blocks: SDKContentBlock[],
  completedToolIds: ReadonlySet<string> = new Set(),
): string | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block?.type !== 'tool_use') continue
    const tool = block as SDKToolUseBlock
    if (!completedToolIds.has(tool.id)) return tool.name
  }
  return undefined
}

export function resolveRunningTurnStatus(
  blocks: SDKContentBlock[],
  completedToolIds: ReadonlySet<string> = new Set(),
): AgentTurnStatus {
  const toolName = getLastUnfinishedToolName(blocks, completedToolIds)
  if (!toolName) return 'thinking'
  return resolveToolStatus(toolName)
}

export function getAgentTurnStatusLabel(status: AgentTurnStatus): string {
  switch (status) {
    case 'running-command':
      return '正在运行命令'
    case 'reading-files':
      return '正在读取文件'
   case 'searching':
      return '正在搜索文件'
   case 'editing-files':
      return '正在编辑文件'
   case 'browsing-web':
      return '正在搜索网页'
    case 'calling-subagent':
      return '正在调用子智能体'
    case 'using-tool':
      return '正在使用工具'
    case 'stopped':
      return '已停止'
    case 'completed':
      return '已完成'
    case 'activity-completed':
      return '已完成'
    case 'failed':
      return '执行失败'
    case 'thinking':
    default:
      return '正在思考'
  }
}

export function formatTurnDuration(durationMs: number): string {
  // 有效执行耗时（含极短暂停）至少显示 1 秒，避免「你在 0 秒后停止了 / 已处理 0 秒」
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '0 秒'
  }
  const seconds = Math.max(1, Math.round(durationMs / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds > 0
    ? `${minutes} 分 ${remainingSeconds} 秒`
    : `${minutes} 分钟`
}
