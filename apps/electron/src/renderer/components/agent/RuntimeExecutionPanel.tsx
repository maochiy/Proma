import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  GitBranch,
  Loader2,
  RefreshCw,
  Users,
  Workflow,
  XCircle,
} from 'lucide-react'
import type {
  AgentRuntimeExecutionGraph,
  AgentRuntimeExecutionNode,
  AgentRuntimeSubagentTranscript,
  SDKMessage,
} from '@proma/shared'
import { agentRuntimeExecutionGraphsAtom } from '@/atoms/agent-atoms'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface RuntimeExecutionPanelProps {
  sessionId: string
}

function statusIcon(status: AgentRuntimeExecutionNode['status']): React.ReactNode {
  switch (status) {
    case 'running':
      return <Loader2 className="size-3.5 animate-spin text-primary" />
    case 'completed':
      return <CheckCircle2 className="size-3.5 text-emerald-500" />
    case 'failed':
      return <XCircle className="size-3.5 text-destructive" />
    case 'stopped':
      return <XCircle className="size-3.5 text-muted-foreground" />
    default:
      return <Circle className="size-3.5 text-muted-foreground/60" />
  }
}

function nodeIcon(kind: AgentRuntimeExecutionNode['kind']): React.ReactNode {
  switch (kind) {
    case 'teammate':
      return <Users className="size-3.5" />
    case 'workflow-agent':
      return <Workflow className="size-3.5" />
    case 'subagent':
      return <Bot className="size-3.5" />
    default:
      return <GitBranch className="size-3.5" />
  }
}

function messageText(message: SDKMessage): string | undefined {
  const record = message as Record<string, unknown>
  const nested = record.message
  if (!nested || typeof nested !== 'object') return undefined
  const content = (nested as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const texts = content.flatMap(block => {
    if (!block || typeof block !== 'object') return []
    const item = block as Record<string, unknown>
    return item.type === 'text' && typeof item.text === 'string'
      ? [item.text]
      : []
  })
  return texts.length > 0 ? texts.join('\n') : undefined
}

export function RuntimeExecutionPanel({
  sessionId,
}: RuntimeExecutionPanelProps): React.ReactElement {
  const graphs = useAtomValue(agentRuntimeExecutionGraphsAtom)
  const setGraphs = useSetAtom(agentRuntimeExecutionGraphsAtom)
  const graph = graphs.get(sessionId)
  const [refreshing, setRefreshing] = React.useState(false)
  const [expandedNodeId, setExpandedNodeId] = React.useState<string>()
  const [transcripts, setTranscripts] = React.useState(
    new Map<string, AgentRuntimeSubagentTranscript>(),
  )
  const [loadingNodeId, setLoadingNodeId] = React.useState<string>()
  const [transcriptError, setTranscriptError] = React.useState<string>()

  React.useEffect(() => {
    setExpandedNodeId(undefined)
    setTranscripts(new Map())
    setLoadingNodeId(undefined)
    setTranscriptError(undefined)
  }, [sessionId])

  const refresh = React.useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      const next = await window.electronAPI.getAgentRuntimeExecutionGraph(sessionId)
      setGraphs(previous => {
        const updated = new Map(previous)
        updated.set(sessionId, next)
        return updated
      })
    } catch {
      // Session 未打开或已挂起时保留最后一次由 CCB 事件推送的执行图。
    } finally {
      setRefreshing(false)
    }
  }, [sessionId, setGraphs])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const toggleNode = React.useCallback(async (
    node: AgentRuntimeExecutionNode,
  ): Promise<void> => {
    if (expandedNodeId === node.id) {
      setExpandedNodeId(undefined)
      return
    }
    setExpandedNodeId(node.id)
    setTranscriptError(undefined)
    if (!node.transcriptAvailable || transcripts.has(node.id)) return
    setLoadingNodeId(node.id)
    try {
      const transcript =
        await window.electronAPI.getAgentRuntimeSubagentTranscript(
          sessionId,
          node.id,
        )
      setTranscripts(previous => {
        const next = new Map(previous)
        next.set(node.id, transcript)
        return next
      })
    } catch (error) {
      setTranscriptError(
        error instanceof Error ? error.message : '读取 CCB 子代理 Transcript 失败',
      )
    } finally {
      setLoadingNodeId(undefined)
    }
  }, [expandedNodeId, sessionId, transcripts])

  const effectiveGraph: AgentRuntimeExecutionGraph = graph ?? {
    nodes: [],
    todos: [],
    updatedAt: 0,
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold">CCB 执行状态</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Todo、Subagent、Teams 与 Workflow
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>

      <section className="rounded-xl bg-muted/45 p-2.5 shadow-sm">
        <div className="mb-2 text-[11px] font-medium text-muted-foreground">
          Todo · {effectiveGraph.todos.length}
        </div>
        <div className="space-y-1.5">
          {effectiveGraph.todos.length === 0 ? (
            <p className="py-2 text-center text-[11px] text-muted-foreground">
              当前没有 CCB Todo
            </p>
          ) : effectiveGraph.todos.map(todo => (
            <div key={todo.id} className="flex items-start gap-2 rounded-lg bg-background/70 px-2 py-1.5">
              {todo.status === 'completed'
                ? <CheckCircle2 className="mt-0.5 size-3.5 text-emerald-500" />
                : todo.status === 'in_progress'
                  ? <Loader2 className="mt-0.5 size-3.5 animate-spin text-primary" />
                  : <Circle className="mt-0.5 size-3.5 text-muted-foreground/60" />}
              <div className="min-w-0">
                <p className="text-xs leading-5">{todo.content}</p>
                {todo.owner && (
                  <p className="text-[10px] text-muted-foreground">负责人：{todo.owner}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-3 rounded-xl bg-muted/45 p-2.5 shadow-sm">
        <div className="mb-2 text-[11px] font-medium text-muted-foreground">
          执行节点 · {effectiveGraph.nodes.length}
        </div>
        <div className="space-y-1.5">
          {effectiveGraph.nodes.length === 0 ? (
            <p className="py-2 text-center text-[11px] text-muted-foreground">
              当前没有运行中的子代理或工作流
            </p>
          ) : effectiveGraph.nodes.map(node => {
            const expanded = expandedNodeId === node.id
            const transcript = transcripts.get(node.id)
            return (
              <div key={node.id} className="overflow-hidden rounded-lg bg-background/75">
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-2 py-2 text-left hover:bg-accent/45"
                  onClick={() => void toggleNode(node)}
                >
                  <span className="mt-0.5 text-muted-foreground">{nodeIcon(node.kind)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {statusIcon(node.status)}
                      <span className="truncate text-xs font-medium">
                        {node.name || node.description}
                      </span>
                    </div>
                    {node.name && (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                        {node.description}
                      </p>
                    )}
                  </div>
                  {node.transcriptAvailable && (
                    expanded
                      ? <ChevronDown className="mt-0.5 size-3.5 text-muted-foreground" />
                      : <ChevronRight className="mt-0.5 size-3.5 text-muted-foreground" />
                  )}
                </button>
                {expanded && node.transcriptAvailable && (
                  <div className="border-t border-border/45 bg-background/45 px-2 py-2">
                    {loadingNodeId === node.id ? (
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        正在读取 CCB Transcript
                      </div>
                    ) : transcriptError ? (
                      <p className="text-[11px] leading-4 text-destructive">
                        {transcriptError}
                      </p>
                    ) : (
                      <div className="max-h-56 space-y-2 overflow-y-auto">
                        {(transcript?.messages ?? []).map((message, index) => {
                          const text = messageText(message)
                          if (!text) return null
                          return (
                            <div key={`${node.id}-${index}`} className="text-[11px] leading-4">
                              <span className="mr-1 font-medium text-muted-foreground">
                                {message.type === 'user' ? '用户' : 'Agent'}:
                              </span>
                              <span className="whitespace-pre-wrap">{text}</span>
                            </div>
                          )
                        })}
                        {transcript && transcript.messages.length === 0 && (
                          <p className="text-[11px] text-muted-foreground">暂无可展示内容</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
