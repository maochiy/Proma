import * as React from 'react'
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import type { AgentRuntimeExecutionNode } from '@proma/shared'
import type { SessionExecutionNode } from '@/lib/session-execution-nodes'
import { cn } from '@/lib/utils'
import { buildSubagentPresentation } from '@/lib/subagent-presentation'
import { SubagentAvatar } from './SubagentAvatar'

interface RuntimeExecutionNodeListProps {
  nodes: SessionExecutionNode[]
  isNodeRunning: (node: SessionExecutionNode) => boolean
  onOpenNode: (node: SessionExecutionNode) => void
  className?: string
}

export function runtimeExecutionNodeStatusLabel(
  status: AgentRuntimeExecutionNode['status'],
  activelyRunning: boolean,
  detached: boolean = false,
): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'stopped') return '已中断'
  if (status === 'running' && detached) return '正在等待指示'
  if (status === 'running') return activelyRunning ? '正在运行' : '正在等待指示'
  return '正在等待指示'
}

function RuntimeExecutionNodeStatusIcon({
  status,
  activelyRunning,
  detached,
}: {
  status: AgentRuntimeExecutionNode['status']
  activelyRunning: boolean
  detached: boolean
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
  if (status === 'running' && detached) {
    return <Circle className="size-3.5 text-sky-500" />
  }
  if (status === 'stopped') {
    return <XCircle className="size-3.5 text-muted-foreground" />
  }
  return <Circle className="size-3.5 text-muted-foreground/60" />
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
        const detached = node.turnCompletionPolicy === 'detach'
        const presentation = buildSubagentPresentation(node, activelyRunning)
        const item = (
          <button
            key={node.id}
            type="button"
            data-execution-node-id={node.id}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent/55 disabled:cursor-default disabled:opacity-60"
            disabled={!presentation.canOpen}
            onClick={() => {
              if (presentation.canOpen) onOpenNode(node)
            }}
            title={presentation.modelTooltip}
          >
            <SubagentAvatar seed={presentation.avatarSeed} name={presentation.name} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {presentation.name}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <RuntimeExecutionNodeStatusIcon
                status={node.status}
                activelyRunning={activelyRunning}
                detached={detached}
              />
              <span
                className={cn(
                  'text-[10px] text-muted-foreground',
                  activelyRunning && 'text-sky-500',
                  node.status === 'completed' && 'text-emerald-500',
                  node.status === 'failed' && 'text-destructive',
                )}
              >
                {presentation.statusLabel}
              </span>
            </span>
          </button>
        )
        return item
      })}
    </div>
  )
}
