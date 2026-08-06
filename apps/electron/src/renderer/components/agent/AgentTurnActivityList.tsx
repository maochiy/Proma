import * as React from 'react'
import {
  ChevronRight,
  FilePenLine,
  Globe2,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react'
import type { SDKToolUseBlock } from '@proma/shared'
import type { AgentActivityItem } from '@/lib/agent-turn-presentation'
import { cn } from '@/lib/utils'

/** 稳定 key：避免 thinking 合并 / synthetic→真实 切换导致整行卸载重挂（闪一下/跳）。 */
export function getAgentActivityItemKey(item: AgentActivityItem): string {
  if (item.block.type === 'tool_use') {
    return `tool:${(item.block as SDKToolUseBlock).id}`
  }
  // text 只用稳定 index，流式正文变化不触发卸载重挂；每条过程正文独立 key 以便追加
  if (item.block.type === 'text') {
    return `text:${item.index}`
  }
  if (item.block.type === 'thinking') {
    // 不要用 running 参与 key：暂停 running→false 会从 surface 切到 index，
    // remount 后丢失用户手动展开状态。合成占位固定 surface；真实思考用稳定 index。
    if (item.index < 0) return 'thinking:surface'
    return `thinking:${item.index}`
  }
  return `block:${item.index}:${item.block.type}`
}

type ActivityGroupKind =
  | 'exploration'
  | 'command'
  | 'file-change'
  | 'web'
  | 'tool'

interface SingleActivityEntry {
  type: 'single'
  item: AgentActivityItem
}

interface GroupedActivityEntry {
  type: 'group'
  kind: ActivityGroupKind
  items: AgentActivityItem[]
}

type ActivityEntry = SingleActivityEntry | GroupedActivityEntry

const COMMAND_TOOLS = /^(Bash|Shell|Execute|Terminal|run_command)$/i
const EXPLORATION_TOOLS = /^(Read|NotebookRead|read_file|Grep|Glob|Search|FileSearch|search_files|LS|ListDir)$/i
const FILE_CHANGE_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/i
const WEB_TOOLS = /(Web|Browser|Fetch|SearchWeb|web_search)/i
const SUBAGENT_TOOLS = /^(Agent|Task|Delegate)|collaboration|delegate_agent/i

function getGroupKind(item: AgentActivityItem): ActivityGroupKind | undefined {
  if (item.running || item.block.type !== 'tool_use') return undefined
  const toolName = (item.block as SDKToolUseBlock).name
  if (SUBAGENT_TOOLS.test(toolName)) return undefined
  if (COMMAND_TOOLS.test(toolName)) return 'command'
  if (EXPLORATION_TOOLS.test(toolName)) return 'exploration'
  if (FILE_CHANGE_TOOLS.test(toolName)) return 'file-change'
  if (WEB_TOOLS.test(toolName)) return 'web'
  return 'tool'
}

export function groupAgentTurnActivities(
  items: AgentActivityItem[],
): ActivityEntry[] {
  const entries: ActivityEntry[] = []

  for (const item of items) {
    const kind = getGroupKind(item)
    const previous = entries.at(-1)
    if (
      kind
      && previous?.type === 'group'
      && previous.kind === kind
    ) {
      previous.items.push(item)
      continue
    }

    if (kind) {
      entries.push({ type: 'group', kind, items: [item] })
    } else {
      entries.push({ type: 'single', item })
    }
  }

  return entries.flatMap((entry) => {
    if (entry.type === 'group' && entry.items.length === 1) {
      const item = entry.items[0]
      return item ? [{ type: 'single' as const, item }] : []
    }
    return [entry]
  })
}

function getGroupPresentation(kind: ActivityGroupKind, count: number): {
  label: string
  icon: typeof Search
} {
 switch (kind) {
   case 'exploration':
     return { label: `探索了 ${count} 项`, icon: Search }
   case 'command':
     return { label: count === 1 ? '已运行命令' : `已运行 ${count} 条命令`, icon: Terminal }
   case 'file-change':
     return { label: count === 1 ? '编辑了一个文件' : `编辑了 ${count} 个文件`, icon: FilePenLine }
   case 'web':
     return { label: count === 1 ? '已搜索网页' : `已搜索 ${count} 次网页`, icon: Globe2 }
  case 'tool':
  default:
    return { label: count === 1 ? '调用了一个工具' : `调用了 ${count} 个工具`, icon: Wrench }
 }
}

function ActivitySummaryGroup({
  entry,
  renderItem,
}: {
  entry: GroupedActivityEntry
  renderItem: (item: AgentActivityItem) => React.ReactNode
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const presentation = getGroupPresentation(entry.kind, entry.items.length)
  const Icon = presentation.icon

  return (
    <div>
      <button
        type="button"
        className="inline-flex min-h-7 max-w-full items-center gap-1 rounded-md text-left text-muted-foreground outline-none hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring/45"
        aria-expanded={expanded}
        onClick={() => setExpanded((previous) => !previous)}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate text-[14px]">{presentation.label}</span>
        <ChevronRight className={cn(
          'size-3 shrink-0 text-muted-foreground/45 transition-transform duration-300 motion-reduce:transition-none',
          expanded && 'rotate-90',
        )} />
      </button>
      <div className={cn(
        'ml-5.5 overflow-hidden border-l border-border/35 pl-3 transition-[max-height,opacity] duration-500 ease-out motion-reduce:transition-none',
        expanded
          ? 'pointer-events-auto max-h-[40rem] opacity-100'
          : 'pointer-events-none max-h-0 opacity-0',
      )}>
        <div className="space-y-1 py-1">
          {entry.items.map(renderItem)}
        </div>
      </div>
    </div>
  )
}

export function AgentTurnActivityList({
  items,
  renderItem,
}: {
  items: AgentActivityItem[]
  renderItem: (item: AgentActivityItem) => React.ReactNode
}): React.ReactElement {
  const entries = groupAgentTurnActivities(items)
  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        if (entry.type === 'single') {
          return (
            <React.Fragment key={`single:${getAgentActivityItemKey(entry.item)}`}>
              {renderItem(entry.item)}
            </React.Fragment>
          )
        }
        const first = entry.items[0]
        const groupKey = first
          ? `group:${entry.kind}:${getAgentActivityItemKey(first)}:${entry.items.length}`
          : `group:${entry.kind}:empty`
        return (
          <ActivitySummaryGroup
            key={groupKey}
            entry={entry}
            renderItem={renderItem}
          />
        )
      })}
    </div>
  )
}
