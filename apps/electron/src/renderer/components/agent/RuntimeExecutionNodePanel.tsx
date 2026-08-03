import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Loader2 } from 'lucide-react'
import type {
  AgentRuntimeSubagentTranscript,
} from '@proma/shared'
import {
  BasePathsProvider,
} from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation'
import {
  getGroupId,
  groupIntoTurns,
  MessageGroupRenderer,
} from './SDKMessageRenderer'
import {
  agentExecutionNodeTranscriptCacheAtom,
} from '@/atoms/agent-atoms'
import {
  type SessionExecutionNode,
} from '@/lib/session-execution-nodes'
import { AgentRunningIndicator } from './AgentRunningIndicator'

interface RuntimeExecutionNodePanelProps {
  cacheKey?: string
  sessionId: string
  sessionPath: string | null
  node: SessionExecutionNode
  running: boolean
}

/**
 * 执行节点独立 Tab。
 *
 * Transcript 使用与主会话相同的 SDKMessageRenderer 渲染链，
 * 仅保留只读消息正文，不挂载输入框与会话操作入口。
 */
export function RuntimeExecutionNodePanel({
  cacheKey,
  sessionId,
  sessionPath,
  node,
  running,
}: RuntimeExecutionNodePanelProps): React.ReactElement {
  const resolvedCacheKey = cacheKey ?? `${sessionId}:${node.id}`
  const transcriptCache = useAtomValue(agentExecutionNodeTranscriptCacheAtom)
  const setTranscriptCache = useSetAtom(agentExecutionNodeTranscriptCacheAtom)
  const [transcript, setTranscript] = React.useState<
    AgentRuntimeSubagentTranscript | undefined
  >(
    () => transcriptCache.get(resolvedCacheKey),
  )
  const [loading, setLoading] = React.useState(
    () => transcriptCache.get(resolvedCacheKey) == null,
  )
  const [error, setError] = React.useState<string>()
  const canQueryTranscript = (
    node.source === 'delegation'
    ||
    node.transcriptAvailable
    || node.kind === 'subagent'
    || node.kind === 'teammate'
  )
  const requestSequenceRef = React.useRef(0)

  const loadTranscript = React.useCallback(async (
    initial: boolean,
  ): Promise<void> => {
    const requestSequence = ++requestSequenceRef.current
    if (!canQueryTranscript) {
      setLoading(false)
      return
    }
    if (initial) setLoading(true)
    try {
      const next = node.source === 'delegation' && node.transcriptSessionId
        ? {
            executionNodeId: node.id,
            messages: await window.electronAPI.getAgentSessionSDKMessages(
              node.transcriptSessionId,
            ),
          }
        : await window.electronAPI
          .getAgentRuntimeSubagentTranscript(sessionId, node.id)
      if (requestSequence !== requestSequenceRef.current) return
      setTranscript(next)
      setTranscriptCache((previous) => {
        const nextCache = new Map(previous)
        nextCache.set(resolvedCacheKey, next)
        return nextCache
      })
      setError(undefined)
    } catch (reason) {
      if (requestSequence !== requestSequenceRef.current) return
      const message = reason instanceof Error
        ? reason.message
        : '读取执行节点会话失败'
      // Runtime 任务结束后会被清理；历史节点点开时优先展示摘要，而不是空白失败。
      if (
        node.source !== 'delegation'
        && !running
        && (node.status === 'completed' || node.status === 'failed' || node.status === 'stopped')
      ) {
        setError(
          node.summary
            ? undefined
            : `${message}。节点已结束，Runtime 可能已清理 Transcript。`,
        )
      } else {
        setError(message)
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) setLoading(false)
    }
  }, [
    canQueryTranscript,
    resolvedCacheKey,
    node.id,
    node.source,
    node.transcriptSessionId,
    sessionId,
    setTranscriptCache,
  ])

  React.useEffect(() => {
    const cached = transcriptCache.get(resolvedCacheKey)
    setTranscript(cached)
    setError(undefined)
    // 缓存只用于立即回显，不能作为“终态节点无需刷新”的依据。
    // 子智能体刚启动时缓存里可能只有首条用户提示词，完成后必须再从磁盘
    // 读取一次，才能补齐思考、工具调用和最终回复。
    void loadTranscript(cached == null)
    return () => {
      requestSequenceRef.current += 1
    }
  }, [loadTranscript, resolvedCacheKey, running])

  React.useEffect(() => {
    if (!canQueryTranscript || !running) return
    let cancelled = false
    let timer: number | undefined
    const schedule = (): void => {
      timer = window.setTimeout(() => {
        void loadTranscript(false).finally(() => {
          if (!cancelled) schedule()
        })
      }, 1_500)
    }
    schedule()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [canQueryTranscript, loadTranscript, running])

  const transcriptMessages = transcript?.messages ?? []
  // 节点创建提示词本身就是子会话的第一条真实用户消息，应与主会话一样
  // 按正文样式展示；这里只是不额外固定节点说明，也不显示底层 JSONL。
  const messages = transcriptMessages
  const groups = React.useMemo(() => groupIntoTurns(messages), [messages])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {loading ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" />
            正在读取执行节点会话
          </div>
          {running && <AgentRunningIndicator startedAt={node.startedAt} />}
        </div>
      ) : groups.length > 0 ? (
        <BasePathsProvider basePaths={sessionPath ? [sessionPath] : []}>
          <Conversation resize="smooth">
            <ConversationContent>
              {groups.map((group) => (
                <MessageGroupRenderer
                  key={getGroupId(group)}
                  group={group}
                  allMessages={messages}
                  basePath={sessionPath ?? undefined}
                  sessionId={node.transcriptSessionId ?? sessionId}
                />
              ))}
              {running && (
                <AgentRunningIndicator
                  startedAt={node.startedAt}
                  className="pl-8"
                />
              )}
            </ConversationContent>
          </Conversation>
        </BasePathsProvider>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {error
              ? error
              : node.summary
                ? node.summary
                : canQueryTranscript
                  ? (
                    node.source === 'delegation'
                      ? '该协作子会话暂时没有可显示的消息，请稍后重试或从左侧打开子会话查看。'
                      : '该执行节点暂时没有可显示的会话内容。'
                  )
                  : '该执行节点不产生独立会话内容。'}
          </p>
          {running && <AgentRunningIndicator startedAt={node.startedAt} />}
        </div>
      )}
    </div>
  )
}
