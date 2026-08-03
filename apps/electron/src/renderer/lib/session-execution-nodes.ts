import type {
  AgentDelegationStatus,
  AgentRuntimeExecutionGraph,
  AgentRuntimeExecutionNode,
  AgentSessionMeta,
} from '@proma/shared'

export interface SessionExecutionNode extends AgentRuntimeExecutionNode {
  source: 'runtime' | 'delegation'
  /** 当前节点是否仍来自 CCB Runtime 的实时执行图，而不是右侧历史快照。 */
  liveRuntimeNode?: boolean
  /** Proma collaboration 子会话 ID；原生 CCB 节点不设置。 */
  transcriptSessionId?: string
  delegationId?: string
  /** Collaboration 子会话对应的 CCB Session Worker 实时状态。 */
  runtimeWorkerState?: AgentSessionMeta['runtimeWorkerState']
}

interface BuildSessionExecutionNodesInput {
  sessionId: string
  runtimeGraph?: AgentRuntimeExecutionGraph
  sessions: AgentSessionMeta[]
  /** 合并历史图时显式标记仍存在于当前实时执行图中的 CCB 节点。 */
  liveRuntimeNodeIds?: ReadonlySet<string>
}

export function mapDelegationStatus(
  status: AgentDelegationStatus | undefined,
): AgentRuntimeExecutionNode['status'] {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
    case 'interrupted':
      return 'stopped'
    case 'running':
    default:
      return 'running'
  }
}

/**
 * 判断节点是否应显示实时旋转状态。
 *
 * - CCB 原生节点跟随父会话运行状态。
 * - Collaboration 节点优先跟随子会话实时状态；Renderer 尚未收到流状态时，
 *   仅 CCB Worker 明确为 busy 才视为正在执行。
 * - 节点已完成、失败或停止时永远不显示旋转状态。
 */
export function isSessionExecutionNodeActivelyRunning(
  node: SessionExecutionNode,
  _parentSessionRunning: boolean,
  childSessionRunning?: boolean,
): boolean {
  if (node.status !== 'running') return false
  if (node.turnCompletionPolicy === 'detach') return false
  if (node.source === 'delegation') {
    if (childSessionRunning === true) return true
    if (node.runtimeWorkerState === 'busy' || node.runtimeWorkerState === 'starting') {
      return true
    }
    if (
      node.runtimeWorkerState === 'cold'
      || node.runtimeWorkerState === 'suspended'
      || node.runtimeWorkerState === 'crashed'
    ) {
      return false
    }
    // delegationStatus 是主进程维护的完整生命周期；Renderer 流状态可能在
    // 完成事件到达前短暂回到 false，不能因此把正在执行误标为“未执行”。
    return true
  }
  if (node.liveRuntimeNode !== true) return false
  if (
    node.runtimeWorkerState === 'cold'
    || node.runtimeWorkerState === 'suspended'
    || node.runtimeWorkerState === 'crashed'
  ) {
    return false
  }
  // CCB 原生后台 Agent 可以在父模型本轮文本结束后继续执行。只要节点仍在
  // Runtime 实时图中，就不能依赖 parentSessionRunning 把它降为“未执行”。
  return true
}

/**
 * 判断执行节点详情是否应持续显示 Agent Running。
 *
 * Proma Collaboration 子会话由 headless runner 执行，Renderer 流状态可能因
 * 窗口切换、事件到达时序或排队阶段暂时缺失；此时 delegationStatus 映射出的
 * node.status 才是完整生命周期状态。CCB 原生节点仍跟随父会话实时运行态。
 */
export function isSessionExecutionNodeDetailRunning(
  node: SessionExecutionNode,
  parentSessionRunning: boolean,
  childSessionRunning?: boolean,
): boolean {
  if (node.turnCompletionPolicy === 'detach') return false
  if (node.source === 'delegation') return node.status === 'running'
  return isSessionExecutionNodeActivelyRunning(
    node,
    parentSessionRunning,
    childSessionRunning,
  )
}

/**
 * 将 CCB 原生执行图与 Proma collaboration 子会话投影成同一套节点。
 * 两种来源使用不同 ID 前缀，避免同名或 UUID 偶然碰撞。
 */
export function buildSessionExecutionNodes({
  sessionId,
  runtimeGraph,
  sessions,
  liveRuntimeNodeIds,
}: BuildSessionExecutionNodesInput): SessionExecutionNode[] {
  const parentRuntimeWorkerState = sessions.find(
    (session) => session.id === sessionId,
  )?.runtimeWorkerState
  const runtimeNodes: SessionExecutionNode[] = (runtimeGraph?.nodes ?? []).map((node) => ({
    ...node,
    source: 'runtime',
    liveRuntimeNode: liveRuntimeNodeIds?.has(node.id) ?? true,
    runtimeWorkerState: parentRuntimeWorkerState,
  }))

  const delegationNodes: SessionExecutionNode[] = sessions
    .filter((session) => session.parentSessionId === sessionId && !!session.sourceDelegationId)
    .map((session) => {
      const status = mapDelegationStatus(session.delegationStatus)
      return {
        id: `delegation:${session.id}`,
        kind: 'subagent',
        name: session.title,
        description: session.delegationGoal ?? session.title,
        status,
        startedAt: session.createdAt,
        completedAt: status === 'running' ? undefined : session.updatedAt,
        transcriptAvailable: true,
        model: session.modelId,
        agentType: session.delegationRole,
        source: 'delegation',
        transcriptSessionId: session.id,
        delegationId: session.sourceDelegationId,
        runtimeWorkerState: session.runtimeWorkerState,
      }
    })

  return [...runtimeNodes, ...delegationNodes].sort((left, right) => {
    const leftStartedAt = left.startedAt ?? 0
    const rightStartedAt = right.startedAt ?? 0
    if (leftStartedAt !== rightStartedAt) return leftStartedAt - rightStartedAt
    return (left.name ?? left.description).localeCompare(
      right.name ?? right.description,
      'zh-CN',
    )
  })
}

interface DelegationToolResult {
  delegations?: Array<{
    delegationId?: unknown
    childSessionId?: unknown
  }>
}

/** 从 collaboration 工具结果中提取本次创建/查询到的委派标识。 */
export function extractDelegationReferences(resultText: string | undefined): {
  delegationIds: Set<string>
  childSessionIds: Set<string>
} {
  const delegationIds = new Set<string>()
  const childSessionIds = new Set<string>()
  if (!resultText) return { delegationIds, childSessionIds }

  try {
    const parsed = JSON.parse(resultText) as DelegationToolResult
    for (const delegation of parsed.delegations ?? []) {
      if (typeof delegation.delegationId === 'string') {
        delegationIds.add(delegation.delegationId)
      }
      if (typeof delegation.childSessionId === 'string') {
        childSessionIds.add(delegation.childSessionId)
      }
    }
  } catch {
    // 非 JSON 或旧版本文本结果：由调用输入标题和父会话关系继续兜底匹配。
  }

  return { delegationIds, childSessionIds }
}

/** 从 delegate_agent(s) 输入中提取任务标题，供工具结果尚未返回时匹配子会话。 */
export function extractDelegationTitles(input: Record<string, unknown>): Set<string> {
  const titles = new Set<string>()
  if (typeof input.title === 'string') titles.add(input.title)
  if (Array.isArray(input.items)) {
    for (const item of input.items) {
      if (!item || typeof item !== 'object') continue
      const title = (item as Record<string, unknown>).title
      if (typeof title === 'string') titles.add(title)
    }
  }
  return titles
}

interface CollaborationDelegationResult {
  status?: unknown
}

interface CollaborationToolResult {
  delegations?: unknown
}

/** 将 collaboration 大段结构化结果压缩为会话正文中的一句状态摘要。 */
export function summarizeCollaborationDelegations(
  resultText: string | undefined,
): string | undefined {
  if (!resultText) return undefined

  try {
    const parsed = JSON.parse(resultText) as CollaborationToolResult
    if (!Array.isArray(parsed.delegations)) return undefined

    const delegations = parsed.delegations.filter(
      (item): item is CollaborationDelegationResult => (
        !!item && typeof item === 'object'
      ),
    )
    if (delegations.length === 0) return '当前没有协作委派'

    const counts = {
      completed: 0,
      running: 0,
      failed: 0,
      stopped: 0,
    }
    for (const delegation of delegations) {
      if (delegation.status === 'completed') counts.completed += 1
      else if (delegation.status === 'running') counts.running += 1
      else if (delegation.status === 'failed') counts.failed += 1
      else if (
        delegation.status === 'cancelled'
        || delegation.status === 'interrupted'
        || delegation.status === 'stopped'
      ) {
        counts.stopped += 1
      }
    }

    const statusParts: string[] = []
    if (counts.completed > 0) statusParts.push(`${counts.completed} 个已完成`)
    if (counts.running > 0) statusParts.push(`${counts.running} 个执行中`)
    if (counts.failed > 0) statusParts.push(`${counts.failed} 个失败`)
    if (counts.stopped > 0) statusParts.push(`${counts.stopped} 个已停止`)

    const prefix = `共 ${delegations.length} 个委派`
    return statusParts.length > 0
      ? `${prefix}：${statusParts.join('，')}`
      : prefix
  } catch {
    return undefined
  }
}
