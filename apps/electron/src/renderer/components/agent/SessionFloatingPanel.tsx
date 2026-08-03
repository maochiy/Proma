import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useAgentRuntimeExecutionGraphRefresh } from '@/hooks/useAgentRuntimeExecutionGraphRefresh'
import {
  FileDiff,
  GitBranch,
} from 'lucide-react'
import type {
  AgentRuntimeTodoItem,
} from '@proma/shared'
import {
  agentAttachedDirectoriesMapAtom,
  agentAttachedFilesMapAtom,
  agentDiffRefreshVersionAtom,
  agentFloatingPanelExecutionNodeStatesAtom,
  agentFloatingPanelPlanStatesAtom,
  agentRuntimeExecutionGraphAtomFamily,
  agentRuntimePlanLifecycleAtom,
  agentSidePanelRuntimeHistoryAtom,
  agentSessionsAtom,
  agentSessionGitSummaryAtom,
  agentSessionStreamingStateAtomFamily,
  agentStreamingStatesAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  createAgentExecutionNodeTab,
  openAgentSidePanelTabAtom,
  workspaceAttachedDirectoriesMapAtom,
  workspaceAttachedFilesMapAtom,
  workspaceFilesVersionAtom,
} from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'
import {
  buildSessionExecutionNodes,
  isSessionExecutionNodeActivelyRunning,
} from '@/lib/session-execution-nodes'
import {
  createFloatingPlanSignature,
  isFloatingExecutionNodeTerminal,
} from '@/lib/session-floating-runtime-lifecycle'
import { getVisibleRuntimePlanTodos } from '@/lib/runtime-plan-lifecycle'
import {
  completedTodoCount,
  sortRuntimeTodos,
} from './RuntimeTodoHoverProgress'
import { selectRuntimePlanVisibleItems } from './runtime-plan-visible-window'
import { RuntimePlanList } from './RuntimePlanList'
import { RuntimeExecutionNodeList } from './RuntimeExecutionNodeList'

interface SessionFloatingPanelProps {
  sessionId: string
  sessionPath: string | null
}

const EMPTY_PATHS: string[] = []
const EMPTY_TODOS: AgentRuntimeTodoItem[] = []
export const FLOATING_PLAN_MAX_VISIBLE_ITEMS = 5
export const FLOATING_SUBAGENT_MAX_VISIBLE_ITEMS = 4

export interface FloatingRuntimeListAllocation {
  visiblePlanItems: number
  visibleSubagentItems: number
}

/**
 * 计划与子智能体分别使用自己的可见上限，面板高度由实际渲染数量决定。
 * 不再用共享行预算压缩其中一类，否则少量子智能体可能被计划区域裁掉。
 */
export function allocateFloatingRuntimeListRows(
  planCount: number,
  subagentCount: number,
): FloatingRuntimeListAllocation {
  return {
    visiblePlanItems: Math.min(planCount, FLOATING_PLAN_MAX_VISIBLE_ITEMS),
    visibleSubagentItems: Math.min(
      subagentCount,
      FLOATING_SUBAGENT_MAX_VISIBLE_ITEMS,
    ),
  }
}

export function SessionFloatingPanel({
  sessionId,
  sessionPath,
}: SessionFloatingPanelProps): React.ReactElement {
  const openSidePanelTab = useSetAtom(openAgentSidePanelTabAtom)
  const graph = useAtomValue(agentRuntimeExecutionGraphAtomFamily(sessionId))
  const graphTodos = graph?.todos ?? EMPTY_TODOS
  const planLifecycle = useAtomValue(agentRuntimePlanLifecycleAtom).get(sessionId)
  const planState = useAtomValue(agentFloatingPanelPlanStatesAtom).get(sessionId)
  // 生命周期尚未初始化时保留旧签名屏蔽作为启动期兜底；
  // 一旦生命周期存在，三个入口只服从统一生命周期状态。
  const planSuppressed = (
    planLifecycle == null
    && graphTodos.length > 0
    && planState?.suppressedCompletedPlanSignature != null
    && createFloatingPlanSignature(graphTodos)
      === planState.suppressedCompletedPlanSignature
  )
  const visibleLifecycleTodos = getVisibleRuntimePlanTodos(
    planLifecycle,
    graphTodos,
  )
  const todos = React.useMemo(
    () => sortRuntimeTodos(
      planSuppressed ? EMPTY_TODOS : visibleLifecycleTodos,
    ),
    [planSuppressed, visibleLifecycleTodos],
  )
  const sessions = useAtomValue(agentSessionsAtom)
  const runtimeHistory = useAtomValue(agentSidePanelRuntimeHistoryAtom)
    .get(sessionId)
  const parentRuntimeWorkerState = sessions.find(
    (session) => session.id === sessionId,
  )?.runtimeWorkerState
  const streamingStates = useAtomValue(agentStreamingStatesAtom)
  const currentNodes = React.useMemo(
    () => buildSessionExecutionNodes({
      sessionId,
      runtimeGraph: graph,
      sessions,
    }),
    [graph, sessionId, sessions],
  )
  const streamState = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
  const running = streamState?.running === true
  const canRetainRuntimeHistory = (
    runtimeHistory != null
    && (
      graph?.runtimeSessionId == null
      || runtimeHistory.runtimeSessionId == null
      || graph.runtimeSessionId === runtimeHistory.runtimeSessionId
    )
    && (
      running
      || parentRuntimeWorkerState === 'busy'
      || parentRuntimeWorkerState === 'starting'
    )
  )
  const allNodes = React.useMemo(() => {
    const merged = new Map(
      currentNodes.map((node) => [node.id, node]),
    )
    if (canRetainRuntimeHistory) {
      const currentRuntimeNodeIds = new Set(
        (graph?.nodes ?? []).map((node) => node.id),
      )
      for (const node of runtimeHistory?.nodes ?? []) {
        if (
          currentRuntimeNodeIds.has(node.id)
          || isFloatingExecutionNodeTerminal(node)
        ) {
          continue
        }
        merged.set(node.id, {
          ...node,
          source: 'runtime',
          liveRuntimeNode: true,
          runtimeWorkerState: parentRuntimeWorkerState,
        })
      }
    }
    return Array.from(merged.values())
  }, [
    canRetainRuntimeHistory,
    currentNodes,
    graph?.nodes,
    parentRuntimeWorkerState,
    runtimeHistory?.nodes,
  ])
  const executionNodeStates = useAtomValue(agentFloatingPanelExecutionNodeStatesAtom)
    .get(sessionId)
  const now = Date.now()
  const nodes = React.useMemo(() => {
    const visible = new Map<string, (typeof allNodes)[number]>()
    for (const node of allNodes) {
      if (
        !isFloatingExecutionNodeTerminal(node)
        && (node.status === 'queued' || node.status === 'running')
      ) {
        visible.set(node.id, node)
      }
    }
    for (const lifecycle of executionNodeStates?.values() ?? []) {
      if (lifecycle.expiresAt > now) {
        visible.set(lifecycle.node.id, lifecycle.node)
      }
    }
    return Array.from(visible.values())
  }, [allNodes, executionNodeStates, now])
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const workspaceSlug = workspaces.find((workspace) => workspace.id === currentWorkspaceId)?.slug
  const attachedDirsMap = useAtomValue(agentAttachedDirectoriesMapAtom)
  const attachedFilesMap = useAtomValue(agentAttachedFilesMapAtom)
  const workspaceAttachedDirsMap = useAtomValue(workspaceAttachedDirectoriesMapAtom)
  const workspaceAttachedFilesMap = useAtomValue(workspaceAttachedFilesMapAtom)
  const attachedDirs = attachedDirsMap.get(sessionId) ?? EMPTY_PATHS
  const attachedFiles = attachedFilesMap.get(sessionId) ?? EMPTY_PATHS
  const workspaceAttachedDirs = workspaceAttachedDirsMap.get(currentWorkspaceId ?? '') ?? EMPTY_PATHS
  const workspaceAttachedFiles = workspaceAttachedFilesMap.get(currentWorkspaceId ?? '') ?? EMPTY_PATHS
  const diffRefreshVersion = useAtomValue(agentDiffRefreshVersionAtom).get(sessionId) ?? 0
  const filesVersion = useAtomValue(workspaceFilesVersionAtom)
  const gitSummaryMap = useAtomValue(agentSessionGitSummaryAtom)
  const setGitSummaryMap = useSetAtom(agentSessionGitSummaryAtom)
  const gitSummary = gitSummaryMap.get(sessionId)

  const activeRuntimeNodeExists = React.useMemo(() => (
    (graph?.nodes ?? []).some((node) => (
      node.status === 'queued' || node.status === 'running'
    ))
    || (
      canRetainRuntimeHistory
      && (runtimeHistory?.nodes ?? []).some((node) => (
        node.status === 'queued' || node.status === 'running'
      ))
    )
  ), [canRetainRuntimeHistory, graph?.nodes, runtimeHistory?.nodes])

  // 有活跃节点时才轮询；页面隐藏自动暂停。merge 短路保证内容不变不重渲染。
  useAgentRuntimeExecutionGraphRefresh(sessionId, {
    enabled: activeRuntimeNodeExists,
    baseRuntimeSessionId: graph?.runtimeSessionId ?? null,
  })

  React.useEffect(() => {
    let cancelled = false
    let refreshSequence = 0
    if (!sessionPath) {
      setGitSummaryMap((previous) => {
        if (!previous.has(sessionId)) return previous
        const next = new Map(previous)
        next.delete(sessionId)
        return next
      })
      return
    }

    const refresh = async (): Promise<void> => {
      const sequence = ++refreshSequence
      try {
        const workspaceFilesPath = workspaceSlug
          ? await window.electronAPI.getWorkspaceFilesPath(workspaceSlug)
          : null
        const extraPaths = [
          ...attachedDirs,
          ...workspaceAttachedDirs,
          ...attachedFiles,
          ...workspaceAttachedFiles,
        ]
        const [nextRepoStatus, changes] = await Promise.all([
          window.electronAPI.getGitRepoStatus(sessionPath),
          window.electronAPI.getUnstagedChanges(
            sessionPath,
            sessionPath,
            workspaceFilesPath ?? undefined,
            extraPaths,
            sessionId,
          ),
        ])
        if (cancelled || sequence !== refreshSequence) return
        setGitSummaryMap((previous) => {
          const next = new Map(previous)
          next.set(sessionId, {
            repoStatus: nextRepoStatus,
            filesChanged: changes.files.length + changes.untrackedFiles.length,
            additions: changes.files.reduce((sum, file) => sum + file.additions, 0),
            deletions: changes.files.reduce((sum, file) => sum + file.deletions, 0),
            updatedAt: Date.now(),
          })
          return next
        })
      } catch {
        if (cancelled || sequence !== refreshSequence) return
        setGitSummaryMap((previous) => {
          const next = new Map(previous)
          next.set(sessionId, {
            repoStatus: null,
            filesChanged: 0,
            additions: 0,
            deletions: 0,
            updatedAt: Date.now(),
          })
          return next
        })
      }
    }

    void refresh()
    const handleWindowFocus = (): void => {
      void refresh()
    }
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      cancelled = true
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [
    attachedDirs,
    attachedFiles,
    diffRefreshVersion,
    filesVersion,
    sessionId,
    sessionPath,
    setGitSummaryMap,
    workspaceAttachedDirs,
    workspaceAttachedFiles,
    workspaceSlug,
  ])

  const completedCount = completedTodoCount(todos)
  const allocation = allocateFloatingRuntimeListRows(todos.length, nodes.length)
  const visibleTodos = selectRuntimePlanVisibleItems(
    todos,
    allocation.visiblePlanItems,
  )
  const visibleNodes = nodes.slice(0, allocation.visibleSubagentItems)
  const hasMoreTodos = visibleTodos.length < todos.length
  const hasMoreNodes = visibleNodes.length < nodes.length

  const openChanges = React.useCallback(() => {
    openSidePanelTab({ sessionId, tab: 'changes' })
  }, [openSidePanelTab, sessionId])

  const openAllPlans = React.useCallback(() => {
    openSidePanelTab({ sessionId, tab: 'plan' })
  }, [openSidePanelTab, sessionId])

  const openAllSubagents = React.useCallback(() => {
    openSidePanelTab({ sessionId, tab: 'execution' })
  }, [openSidePanelTab, sessionId])

  const openExecutionNode = React.useCallback((node: (typeof nodes)[number]) => {
    const runtimeIdentity = node.source === 'delegation'
      ? node.transcriptSessionId
      : graph?.runtimeSessionId
    const tab = createAgentExecutionNodeTab(node.id, runtimeIdentity)
    openSidePanelTab({
      sessionId,
      tab,
      executionNodeSnapshot: {
        node,
        runtimeSessionId: runtimeIdentity,
      },
    })
  }, [graph?.runtimeSessionId, nodes, openSidePanelTab, sessionId])

  return (
    <aside
      aria-label="会话环境信息"
      className={cn(
        'absolute right-4 top-[56px] z-40 flex w-[300px] max-h-[calc(100%-72px)] flex-col overflow-hidden p-3',
        '!rounded-[24px] border border-black/[0.07] bg-card text-card-foreground shadow-lg',
        'dark:border-white/[0.10] dark:shadow-[0_12px_36px_-18px_rgba(0,0,0,0.85)]',
      )}
    >
      <div className="shrink-0">
        <h2 className="px-1 pb-2 text-[11px] font-medium text-muted-foreground">环境信息</h2>

        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent/55"
          onClick={openChanges}
        >
          <FileDiff className="size-3.5 text-muted-foreground" />
          <span className="flex-1 text-xs">变更</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {(gitSummary?.filesChanged ?? 0) > 0 ? `${gitSummary?.filesChanged} 个文件` : '无变更'}
          </span>
          {(gitSummary?.additions ?? 0) > 0 && (
            <span className="text-[11px] tabular-nums text-emerald-500">+{gitSummary?.additions}</span>
          )}
          {(gitSummary?.deletions ?? 0) > 0 && (
            <span className="text-[11px] tabular-nums text-red-500">-{gitSummary?.deletions}</span>
          )}
        </button>

        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className="flex-1 text-xs">分支</span>
          <span className="max-w-[160px] truncate text-[11px] text-muted-foreground">
            {gitSummary?.repoStatus?.isRepo
              ? (gitSummary.repoStatus.branch ?? 'HEAD')
              : '非 Git 仓库'}
          </span>
        </div>

      </div>

      {(todos.length > 0 || nodes.length > 0) && (
        <div
          className="min-h-0 overflow-y-auto overscroll-contain scrollbar-none"
          data-session-floating-runtime-region
        >
          {todos.length > 0 && (
            <section
              className="mt-2 border-t border-border/55 pt-2"
              data-session-plan-progress="readonly"
            >
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">计划</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {completedCount} / {todos.length}
                </span>
              </div>
              <RuntimePlanList
                todos={visibleTodos}
                running={running}
                planActive={
                  planLifecycle == null
                  || planLifecycle.current?.status === 'active'
                }
                compact
              />
              {hasMoreTodos && (
                <button
                  type="button"
                  className="flex w-full items-center justify-center rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-accent/55 hover:text-foreground"
                  onClick={openAllPlans}
                  data-session-plan-view-all
                >
                  查看全部
                </button>
              )}
            </section>
          )}

          {nodes.length > 0 && (
            <section className="mt-2 border-t border-border/55 pt-2">
              <div className="flex items-center justify-between px-2 py-1.5">
                <h3 className="text-[11px] font-medium text-muted-foreground">
                  子智能体 · {nodes.length}
                </h3>
              </div>
              <RuntimeExecutionNodeList
                nodes={visibleNodes}
                isNodeRunning={(node) => (
                  isSessionExecutionNodeActivelyRunning(
                    node,
                    running,
                    node.transcriptSessionId
                      ? streamingStates.get(node.transcriptSessionId)?.running
                      : undefined,
                  )
                )}
                onOpenNode={openExecutionNode}
              />
              {hasMoreNodes && (
                <button
                  type="button"
                  className="flex w-full items-center justify-center rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-accent/55 hover:text-foreground"
                  onClick={openAllSubagents}
                  data-session-subagent-view-all
                >
                  查看全部
                </button>
              )}
            </section>
          )}
        </div>
      )}
    </aside>
  )
}
