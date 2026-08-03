import { describe, expect, test } from 'bun:test'
import type {
  AgentRuntimeExecutionGraph,
  AgentSessionMeta,
  SDKMessage,
} from '@proma/shared'
import {
  buildSessionExecutionNodes,
  extractDelegationReferences,
  isSessionExecutionNodeDetailRunning,
  isSessionExecutionNodeActivelyRunning,
  mapDelegationStatus,
  summarizeCollaborationDelegations,
} from './session-execution-nodes'

const PARENT_ID = 'parent-session'

function createDelegatedSession(
  id: string,
  status: AgentSessionMeta['delegationStatus'],
  runtimeWorkerState?: AgentSessionMeta['runtimeWorkerState'],
): AgentSessionMeta {
  return {
    id,
    title: `子会话 ${id}`,
    parentSessionId: PARENT_ID,
    sourceDelegationId: `task-${id}`,
    delegationRole: 'explore',
    delegationStatus: status,
    delegationGoal: `分析 ${id}`,
    modelId: 'test-model',
    runtimeWorkerState,
    createdAt: 10,
    updatedAt: 20,
  }
}

describe('会话统一执行节点投影', () => {
  test('Given CCB 原生节点和 collaboration 子会话 When 构建节点 Then 两种来源同时保留', () => {
    const runtimeGraph: AgentRuntimeExecutionGraph = {
      nodes: [{
        id: 'ccb-node',
        kind: 'teammate',
        name: 'CCB 节点',
        status: 'running',
        description: '原生执行节点',
        transcriptAvailable: true,
      }],
      todos: [],
      updatedAt: 1,
    }

    const nodes = buildSessionExecutionNodes({
      sessionId: PARENT_ID,
      runtimeGraph,
      sessions: [createDelegatedSession('child-1', 'completed')],
    })

    expect(nodes).toHaveLength(2)
    expect(nodes.map((node) => node.source)).toEqual(['runtime', 'delegation'])
    expect(nodes[1]?.id).toBe('delegation:child-1')
    expect(nodes[1]?.transcriptSessionId).toBe('child-1')
    expect(nodes[1]?.name).toBe('子会话 child-1')
  })

  test('Given collaboration 状态 When 映射 Then 终止状态不会继续显示运行中', () => {
    expect(mapDelegationStatus('running')).toBe('running')
    expect(mapDelegationStatus('completed')).toBe('completed')
    expect(mapDelegationStatus('failed')).toBe('failed')
    expect(mapDelegationStatus('cancelled')).toBe('stopped')
    expect(mapDelegationStatus('interrupted')).toBe('stopped')
  })

  test('Given CCB 实时节点与 Collaboration 节点 When 父流状态短暂结束 Then 仍保持真实执行状态', () => {
    const runtimeNode = buildSessionExecutionNodes({
      sessionId: PARENT_ID,
      runtimeGraph: {
        nodes: [{
          id: 'ccb-running',
          kind: 'subagent',
          description: 'CCB 运行节点',
          status: 'running',
          transcriptAvailable: true,
        }],
        todos: [],
        updatedAt: 1,
      },
      sessions: [],
    })[0]!
    const delegationNode = buildSessionExecutionNodes({
      sessionId: PARENT_ID,
      sessions: [createDelegatedSession('child-running', 'running')],
    })[0]!

    expect(isSessionExecutionNodeActivelyRunning(runtimeNode, true)).toBe(true)
    expect(isSessionExecutionNodeActivelyRunning(runtimeNode, false)).toBe(true)
    expect(isSessionExecutionNodeActivelyRunning(
      delegationNode,
      true,
      true,
    )).toBe(true)
    expect(isSessionExecutionNodeActivelyRunning(
      delegationNode,
      true,
      false,
    )).toBe(true)
  })

  test('Given CCB 节点只来自历史快照 When 状态仍为 running Then 不无限显示执行中', () => {
    const historyNode = buildSessionExecutionNodes({
      sessionId: PARENT_ID,
      runtimeGraph: {
        nodes: [{
          id: 'history-running',
          kind: 'subagent',
          description: '历史节点',
          status: 'running',
          transcriptAvailable: true,
        }],
        todos: [],
        updatedAt: 1,
      },
      sessions: [],
      liveRuntimeNodeIds: new Set(),
    })[0]!

    expect(historyNode.liveRuntimeNode).toBe(false)
    expect(isSessionExecutionNodeActivelyRunning(historyNode, true)).toBe(false)
  })

  test('Given 长期监控节点仍在运行 When 父模型已经结束 Then 不投影为活跃执行节点', () => {
    const monitorNode = buildSessionExecutionNodes({
      sessionId: PARENT_ID,
      runtimeGraph: {
        nodes: [{
          id: 'monitor-running',
          kind: 'shell',
          description: '监控推送日志',
          status: 'running',
          transcriptAvailable: false,
          turnCompletionPolicy: 'detach',
        }],
        todos: [],
        updatedAt: 1,
      },
      sessions: [],
    })[0]!

    expect(isSessionExecutionNodeActivelyRunning(monitorNode, true)).toBe(false)
    expect(isSessionExecutionNodeDetailRunning(monitorNode, true)).toBe(false)
  })

  test('Given Collaboration 缺少 Renderer 流状态 When 委派生命周期仍在运行 Then 非终止 Worker 状态保持执行中', () => {
    const busyNode = buildSessionExecutionNodes({
      sessionId: PARENT_ID,
      sessions: [createDelegatedSession('child-busy', 'running', 'busy')],
    })[0]!
    const coldNode = buildSessionExecutionNodes({
      sessionId: PARENT_ID,
      sessions: [createDelegatedSession('child-cold', 'running', 'cold')],
    })[0]!
    const readyNode = buildSessionExecutionNodes({
      sessionId: PARENT_ID,
      sessions: [createDelegatedSession('child-ready', 'running', 'ready')],
    })[0]!

    expect(isSessionExecutionNodeActivelyRunning(busyNode, false)).toBe(true)
    expect(isSessionExecutionNodeActivelyRunning(coldNode, true)).toBe(false)
    expect(isSessionExecutionNodeActivelyRunning(readyNode, true)).toBe(true)
    expect(busyNode.runtimeWorkerState).toBe('busy')
  })

  test('Given Proma 子智能体委派仍为 running When Renderer 流状态暂时为空闲 Then 详情仍显示运行中', () => {
    const delegationNode = buildSessionExecutionNodes({
      sessionId: PARENT_ID,
      sessions: [createDelegatedSession('child-running', 'running', 'cold')],
    })[0]!
    const completedNode = buildSessionExecutionNodes({
      sessionId: PARENT_ID,
      sessions: [createDelegatedSession('child-completed', 'completed', 'ready')],
    })[0]!

    expect(isSessionExecutionNodeDetailRunning(
      delegationNode,
      false,
      false,
    )).toBe(true)
    expect(isSessionExecutionNodeDetailRunning(
      completedNode,
      true,
      true,
    )).toBe(false)
  })

  test('Given CCB 执行图被重置 When 重新投影节点 Then 不保留旧执行节点', () => {
    const nodes = buildSessionExecutionNodes({
      sessionId: PARENT_ID,
      runtimeGraph: {
        nodes: [],
        todos: [],
        updatedAt: 2,
      },
      sessions: [],
    })

    expect(nodes).toEqual([])
  })

  test('Given delegate_agents JSON 结果 When 解析 Then 得到委派与子会话 ID', () => {
    const result = extractDelegationReferences(JSON.stringify({
      delegations: [{
        delegationId: 'delegation-1',
        childSessionId: 'child-1',
      }],
    }))

    expect([...result.delegationIds]).toEqual(['delegation-1'])
    expect([...result.childSessionIds]).toEqual(['child-1'])
  })

  test('Given list_delegations 大段结果 When 摘要 Then 只返回数量和状态', () => {
    const summary = summarizeCollaborationDelegations(JSON.stringify({
      maxRunningDelegations: 50,
      runningCount: 1,
      delegations: [
        { title: '节点一', status: 'completed', goal: '很长的任务详情' },
        { title: '节点二', status: 'running', resultSummary: '很长的执行结果' },
        { title: '节点三', status: 'failed', error: '失败详情' },
      ],
    }))

    expect(summary).toBe('共 3 个委派：1 个已完成，1 个执行中，1 个失败')
    expect(summary).not.toContain('很长')
  })
})
