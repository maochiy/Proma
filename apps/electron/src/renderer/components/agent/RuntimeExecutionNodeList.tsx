import * as React from 'react'
import {
  Bot,
  CheckCircle2,
  Circle,
  GitBranch,
  Loader2,
  Users,
  Workflow,
  XCircle,
} from 'lucide-react'
import type { AgentRuntimeExecutionNode } from '@proma/shared'
import type { SessionExecutionNode } from '@/lib/session-execution-nodes'
import { cn } from '@/lib/utils'

interface RuntimeExecutionNodeListProps {
  nodes: SessionExecutionNode[]
  isNodeRunning: (node: SessionExecutionNode) => boolean
  onOpenNode: (node: SessionExecutionNode) => void
  className?: string
}

export function runtimeExecutionNodeStatusLabel(
  status: AgentRuntimeExecutionNode['status'],
  activelyRunning: boolean,
): string {
  if (status === 'completed') return '执行完成'
  if (status === 'failed') return '执行失败'
  if (status === 'stopped') return '已停止'
  if (status === 'running') return activelyRunning ? '执行中' : '未执行'
  return '未执行'
}

function RuntimeExecutionNodeStatusIcon({
  status,
  activelyRunning,
}: {
  status: AgentRuntimeExecutionNode['status']
  activelyRunning: boolean
}): React.ReactElement {
  if (status === 'running' && activelyRunning) {
    return <Loader2 className="size-3.5 animate-spin text-sky-500" />
  }
  if (status === 'completed') {
    return <CheckCircle2 className="size-3.5 text-emerald-500" />
  }
  if (status === 'failed') {
    return <XCircle className="size-3.5 text-destructive" />
  }
  if (status === 'stopped' || status === 'running') {
    return <XCircle className="size-3.5 text-muted-foreground" />
  }
  return <Circle className="size-3.5 text-muted-foreground/60" />
}

function RuntimeExecutionNodeKindIcon({
  kind,
}: {
  kind: AgentRuntimeExecutionNode['kind']
}): React.ReactElement {
  if (kind === 'teammate') return <Users className="size-3.5" />
  if (kind === 'workflow-agent') return <Workflow className="size-3.5" />
  if (kind === 'subagent') return <Bot className="size-3.5" />
  return <GitBranch className="size-3.5" />
}

/** 悬浮面板与右侧“子智能体”Tab 共用的节点列表。 */
export function RuntimeExecutionNodeList({
  nodes,
  isNodeRunning,
  onOpenNode,
  className,
}: RuntimeExecutionNodeListProps): React.ReactElement {
  return (
    <div className={cn('space-y-0.5', className)}>
      {nodes.map((node) => {
        const activelyRunning = isNodeRunning(node)
        return (
          <button
            key={node.id}
            type="button"
            data-execution-node-id={node.id}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent/55"
            onClick={() => onOpenNode(node)}
          >
            <span className="shrink-0 text-muted-foreground">
              <RuntimeExecutionNodeKindIcon kind={node.kind} />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {node.name || node.description}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <RuntimeExecutionNodeStatusIcon
                status={node.status}
                activelyRunning={activelyRunning}
              />
              <span
                className={cn(
                  'text-[10px] text-muted-foreground',
                  activelyRunning && 'text-sky-500',
                  node.status === 'completed' && 'text-emerald-500',
                  node.status === 'failed' && 'text-destructive',
                )}
              >
                {runtimeExecutionNodeStatusLabel(node.status, activelyRunning)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
