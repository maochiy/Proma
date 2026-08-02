import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import type { AgentRuntimeExecutionNode } from '@proma/shared'
import {
  agentFloatingPanelExecutionNodeStatesAtom,
  agentRuntimeExecutionGraphsAtom,
  agentSessionsAtom,
  agentSessionStreamingStateAtomFamily,
  beginAgentFloatingPanelTurnAtom,
} from '@/atoms/agent-atoms'
import { buildSessionExecutionNodes } from '@/lib/session-execution-nodes'
import {
  FLOATING_EXECUTION_NODE_COMPLETION_DELAY_MS,
  FLOATING_EXECUTION_NODE_COMPLETION_STAGGER_MS,
  isFloatingExecutionNodeTerminal,
} from '@/lib/session-floating-runtime-lifecycle'

const ACTIVE_EXECUTION_NODE_STATUSES = new Set<
  AgentRuntimeExecutionNode['status']
>(['queued', 'running'])

/**
 * 维护会话悬浮面板自己的数据生命周期。
 *
 * - 计划：全部完成后保留到本轮结束；下一轮开始时才清空。若仍有未完成项则跨轮保留。
 * - 执行节点：仅在节点自身明确完成/失败/停止后短暂展示终态，再从悬浮面板关闭。
 */
export function useSessionFloatingRuntimeLifecycle(sessionId: string): void {
  const graphs = useAtomValue(agentRuntimeExecutionGraphsAtom)
  const graph = graphs.get(sessionId)
  const sessions = useAtomValue(agentSessionsAtom)
  const streamState = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
  const beginTurn = useSetAtom(beginAgentFloatingPanelTurnAtom)
  const terminalNodeStates = useAtomValue(agentFloatingPanelExecutionNodeStatesAtom)
  const setTerminalNodeStates = useSetAtom(agentFloatingPanelExecutionNodeStatesAtom)
  const previousNodeStatusesRef = React.useRef(
    new Map<string, AgentRuntimeExecutionNode['status']>(),
  )
  const completionTimersRef = React.useRef(new Map<string, number>())
  const getCompletionTimerKey = React.useCallback(
    (nodeId: string) => `${sessionId}:${nodeId}`,
    [sessionId],
  )

  const nodes = React.useMemo(
    () => buildSessionExecutionNodes({
      sessionId,
      runtimeGraph: graph,
      sessions,
    }),
    [graph, sessionId, sessions],
  )
  // 普通新 Run 使用 startedAt 建立轮次；软空闲直接注入由发送入口显式调用 beginTurn。
  React.useLayoutEffect(() => {
    if (streamState?.running !== true || streamState.startedAt == null) return
    beginTurn({ sessionId, epoch: streamState.startedAt })
  }, [beginTurn, sessionId, streamState?.running, streamState?.startedAt])

  React.useLayoutEffect(() => {
    const now = Date.now()
    const currentSessionStates = terminalNodeStates.get(sessionId) ?? new Map()
    const nextSessionStates = new Map(currentSessionStates)
    const currentNodeIds = new Set(nodes.map((node) => node.id))
    let changed = false
    let terminalTransitionIndex = 0

    for (const [nodeId, terminalState] of nextSessionStates) {
      if (terminalState.expiresAt > now) continue
      nextSessionStates.delete(nodeId)
      const timerKey = getCompletionTimerKey(nodeId)
      const timer = completionTimersRef.current.get(timerKey)
      if (timer != null) window.clearTimeout(timer)
      completionTimersRef.current.delete(timerKey)
      changed = true
    }

    for (const node of nodes) {
      const previousStatus = previousNodeStatusesRef.current.get(node.id)
      const terminal = isFloatingExecutionNodeTerminal(node)
      const transitionedFromActive = (
        previousStatus != null
        && ACTIVE_EXECUTION_NODE_STATUSES.has(previousStatus)
        && terminal
      )

      if (!terminal) {
        if (nextSessionStates.delete(node.id)) changed = true
        const timerKey = getCompletionTimerKey(node.id)
        const timer = completionTimersRef.current.get(timerKey)
        if (timer != null) window.clearTimeout(timer)
        completionTimersRef.current.delete(timerKey)
      } else if (transitionedFromActive && !nextSessionStates.has(node.id)) {
        nextSessionStates.set(node.id, {
          node,
          expiresAt: (
            now
            + FLOATING_EXECUTION_NODE_COMPLETION_DELAY_MS
            + terminalTransitionIndex * FLOATING_EXECUTION_NODE_COMPLETION_STAGGER_MS
          ),
        })
        terminalTransitionIndex += 1
        changed = true
      }

      previousNodeStatusesRef.current.set(node.id, node.status)
    }

    for (const nodeId of previousNodeStatusesRef.current.keys()) {
      if (!currentNodeIds.has(nodeId)) previousNodeStatusesRef.current.delete(nodeId)
    }

    if (changed) {
      setTerminalNodeStates((previous) => {
        const next = new Map(previous)
        if (nextSessionStates.size > 0) next.set(sessionId, nextSessionStates)
        else next.delete(sessionId)
        return next
      })
    }

    for (const [nodeId, terminalState] of nextSessionStates) {
      const timerKey = getCompletionTimerKey(nodeId)
      if (completionTimersRef.current.has(timerKey)) continue
      const delay = Math.max(0, terminalState.expiresAt - Date.now())
      const timer = window.setTimeout(() => {
        completionTimersRef.current.delete(timerKey)
        setTerminalNodeStates((latest) => {
          const latestSessionStates = latest.get(sessionId)
          if (!latestSessionStates?.has(nodeId)) return latest
          const next = new Map(latest)
          const nextSession = new Map(latestSessionStates)
          nextSession.delete(nodeId)
          if (nextSession.size > 0) next.set(sessionId, nextSession)
          else next.delete(sessionId)
          return next
        })
      }, delay)
      completionTimersRef.current.set(timerKey, timer)
    }
  }, [
    getCompletionTimerKey,
    nodes,
    sessionId,
    setTerminalNodeStates,
    terminalNodeStates,
  ])

  React.useEffect(() => {
    const previousStatuses = previousNodeStatusesRef.current
    return () => {
      previousStatuses.clear()
    }
  }, [sessionId])
}
