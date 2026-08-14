/**
 * useTaskSessionSummary — 任务会话摘要 Hook
 *
 * 任务绑定了 Agent 会话（threadId）时，读取会话最新消息并提取：
 * - 处理中：最新进度摘要（最后一条 assistant 文本）
 * - 受阻：阻塞原因摘要（最后 assistant 文本，兜底最后 user 文本）
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  extractTaskSessionSummary,
  extractTaskBlockedReason,
} from '@/lib/taskboard-agent'
import { agentStreamingStatesAtom } from '@/atoms/agent-atoms'

export interface TaskSessionSummaryResult {
  summary: string | null
  loading: boolean
  running: boolean
}

/**
 * 读取任务绑定会话的摘要。
 *
 * @param threadId 任务绑定的 Agent 会话 ID
 * @param mode 'progress'（处理中：最新进度）| 'blocked'（受阻：阻塞原因）
 */
export function useTaskSessionSummary(
  threadId: string | null | undefined,
  mode: 'progress' | 'blocked',
): TaskSessionSummaryResult {
  const streamingStates = useAtomValue(agentStreamingStatesAtom)
  const [summary, setSummary] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    setSummary(null)
    if (!threadId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void window.electronAPI.getAgentSessionSDKMessages(threadId)
      .then((messages) => {
        if (cancelled) return
        setSummary(mode === 'progress'
          ? extractTaskSessionSummary(messages)
          : extractTaskBlockedReason(messages))
      })
      .catch((error) => {
        if (cancelled) return
        console.error('[任务看板] 会话摘要读取失败:', error)
        setSummary(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [threadId, mode])

  const running = threadId ? Boolean(streamingStates.get(threadId)?.running) : false

  return { summary, loading, running }
}
