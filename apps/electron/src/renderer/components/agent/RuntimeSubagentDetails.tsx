import * as React from 'react'
import {
  Bot,
  Brain,
  Clock3,
  Loader2,
  RefreshCw,
  User,
  Wrench,
} from 'lucide-react'
import type {
  AgentRuntimeExecutionNode,
  AgentRuntimeSubagentTranscript,
  SDKMessage,
} from '@proma/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { MessageResponse } from '@/components/ai-elements/message'
import { extractToolResultText } from './task-progress'

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function TranscriptMessage({
  message,
}: {
  message: SDKMessage
}): React.ReactElement | null {
  const record = message as unknown as Record<string, unknown>
  const nested = record.message
  const content = nested && typeof nested === 'object'
    ? (nested as Record<string, unknown>).content
    : undefined

  if (typeof content === 'string') {
    return (
      <div className="flex items-start gap-2 text-xs leading-5">
        {message.type === 'user'
          ? <User className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
          : <Bot className="mt-1 size-3.5 shrink-0 text-muted-foreground" />}
        <MessageResponse className="min-w-0 flex-1">{content}</MessageResponse>
      </div>
    )
  }
  if (!Array.isArray(content)) return null

  const blocks = content.flatMap((block, index) => {
    if (!block || typeof block !== 'object') return []
    const item = block as Record<string, unknown>
    if (item.type === 'text' && typeof item.text === 'string') {
      return [
        <MessageResponse key={`text-${index}`} className="text-xs leading-5">
          {item.text}
        </MessageResponse>,
      ]
    }
    if (item.type === 'thinking' && typeof item.thinking === 'string') {
      return [
        <details key={`thinking-${index}`} className="rounded-md bg-background/65 px-2 py-1.5">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <Brain className="size-3" />
            思考过程
          </summary>
          <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground">
            {item.thinking}
          </p>
        </details>,
      ]
    }
    if (item.type === 'tool_use') {
      return [
        <div key={`tool-${index}`} className="rounded-md bg-background/65 px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium">
            <Wrench className="size-3 text-muted-foreground" />
            {typeof item.name === 'string' ? item.name : 'Tool'}
          </div>
          {item.input !== undefined && (
            <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-muted-foreground">
              {formatUnknown(item.input)}
            </pre>
          )}
        </div>,
      ]
    }
    if (item.type === 'tool_result') {
      const text = extractToolResultText(item.content)
      return text
        ? [
            <pre
              key={`result-${index}`}
              className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/65 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground"
            >
              {text}
            </pre>,
          ]
        : []
    }
    return []
  })

  if (blocks.length === 0) return null
  return (
    <div className="flex items-start gap-2">
      {message.type === 'user'
        ? <User className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
        : <Bot className="mt-1 size-3.5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1 space-y-1.5">{blocks}</div>
    </div>
  )
}

interface RuntimeSubagentDetailsProps {
  sessionId: string
  node: AgentRuntimeExecutionNode
  className?: string
}

function formatElapsed(node: AgentRuntimeExecutionNode): string | undefined {
  if (!node.startedAt) return undefined
  const end = node.completedAt ?? Date.now()
  const seconds = Math.max(0, Math.round((end - node.startedAt) / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining > 0 ? `${minutes} 分 ${remaining} 秒` : `${minutes} 分`
}

export function RuntimeSubagentDetails({
  sessionId,
  node,
  className,
}: RuntimeSubagentDetailsProps): React.ReactElement {
  const [transcript, setTranscript] =
    React.useState<AgentRuntimeSubagentTranscript>()
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const canQueryTranscript = (
    node.transcriptAvailable
    || node.kind === 'subagent'
    || node.kind === 'teammate'
  )

  const loadTranscript = React.useCallback(async (
    initial: boolean,
  ): Promise<void> => {
    if (!canQueryTranscript) {
      setLoading(false)
      return
    }
    if (initial) setLoading(true)
    else setRefreshing(true)
    try {
      const next = await window.electronAPI
        .getAgentRuntimeSubagentTranscript(sessionId, node.id)
      setTranscript(next)
      setError(undefined)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '读取 CCB 子 Agent Transcript 失败',
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [canQueryTranscript, node.id, sessionId])

  React.useEffect(() => {
    setTranscript(undefined)
    setError(undefined)
    void loadTranscript(true)
  }, [loadTranscript])

  React.useEffect(() => {
    if (!canQueryTranscript || node.status !== 'running') return
    const timer = window.setInterval(() => {
      void loadTranscript(false)
    }, 1_500)
    return () => window.clearInterval(timer)
  }, [canQueryTranscript, loadTranscript, node.status])

  const elapsed = formatElapsed(node)
  const messages = transcript?.messages ?? []

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {node.agentType && (
          <span className="rounded-md bg-muted/70 px-1.5 py-0.5">
            {node.agentType}
          </span>
        )}
        {node.model && (
          <span className="rounded-md bg-muted/70 px-1.5 py-0.5">
            {node.model}
          </span>
        )}
        {node.teamName && (
          <span className="rounded-md bg-muted/70 px-1.5 py-0.5">
            Team · {node.teamName}
          </span>
        )}
        {elapsed && (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-1.5 py-0.5">
            <Clock3 className="size-3" />
            {elapsed}
          </span>
        )}
      </div>

      {node.summary && (
        <p className="whitespace-pre-wrap text-[12px] leading-5 text-foreground/75">
          {node.summary}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          正在读取 CCB 子 Agent 会话
        </div>
      ) : messages.length > 0 ? (
        <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg bg-muted/35 p-2.5">
          {messages.map((message, index) => {
            return (
              <TranscriptMessage
                key={`${node.id}-${index}`}
                message={message}
              />
            )
          })}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className={cn(
            'text-[11px] leading-4',
            error ? 'text-destructive' : 'text-muted-foreground',
          )}>
            {error
              ? error
              : node.status === 'running' && canQueryTranscript
                ? 'CCB 子 Agent 正在执行，Transcript 将自动刷新。'
                : canQueryTranscript
                  ? 'CCB 暂未返回 Transcript，可手动重新读取。'
                  : '该执行节点不产生独立的 Agent Transcript。'}
          </p>
          {canQueryTranscript && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-[11px]"
              disabled={refreshing}
              onClick={() => void loadTranscript(false)}
            >
              {refreshing
                ? <Loader2 className="size-3 animate-spin" />
                : <RefreshCw className="size-3" />}
              重新读取
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
