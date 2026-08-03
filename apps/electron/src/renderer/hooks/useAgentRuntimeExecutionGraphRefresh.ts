import * as React from 'react'
import { useSetAtom } from 'jotai'
import { mergeAgentRuntimeExecutionGraphAtom } from '@/atoms/agent-atoms'

/** 有活跃 runtime 节点时的默认轮询间隔（可见标签页）。 */
export const AGENT_RUNTIME_EXECUTION_GRAPH_POLL_MS = 2_500

export interface UseAgentRuntimeExecutionGraphRefreshOptions {
  /** 是否启用周期轮询；首次仍会拉一次快照。 */
  enabled: boolean
  /** 轮询间隔，默认 2.5s。 */
  intervalMs?: number
  /** 查询发起时看到的 Runtime ID，用于丢弃过期响应。 */
  baseRuntimeSessionId?: string | null
}

/**
 * 拉取并合并 session 的 runtime execution graph。
 *
 * - 始终在 effect 启动时拉一次（覆盖打开面板 / 切换会话）
 * - 仅在 enabled 且页面可见时做周期轮询
 * - 不触碰 SSE / liveMessages 文本流路径
 */
export function useAgentRuntimeExecutionGraphRefresh(
  sessionId: string,
  {
    enabled,
    intervalMs = AGENT_RUNTIME_EXECUTION_GRAPH_POLL_MS,
    baseRuntimeSessionId = null,
  }: UseAgentRuntimeExecutionGraphRefreshOptions,
): void {
  const mergeGraph = useSetAtom(mergeAgentRuntimeExecutionGraphAtom)

  React.useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const refresh = (): void => {
      void window.electronAPI.getAgentRuntimeExecutionGraph(sessionId)
        .then((next) => {
          if (cancelled) return
          mergeGraph({
            sessionId,
            graph: next,
            baseRuntimeSessionId,
          })
        })
        .catch(() => {
          // 会话尚未初始化或 Worker 暂时不可用时保留现有执行图。
        })
    }

    const stopInterval = (): void => {
      if (timer != null) {
        window.clearInterval(timer)
        timer = undefined
      }
    }

    const startInterval = (): void => {
      if (!enabled || cancelled) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (timer != null) return
      timer = window.setInterval(refresh, intervalMs)
    }

    const onVisibilityChange = (): void => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'visible') {
        // 回到前台时立即补一次，再恢复轮询
        if (enabled) refresh()
        startInterval()
      } else {
        stopInterval()
      }
    }

    refresh()
    startInterval()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }

    return () => {
      cancelled = true
      stopInterval()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
  }, [baseRuntimeSessionId, enabled, intervalMs, mergeGraph, sessionId])
}
