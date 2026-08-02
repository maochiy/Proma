import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { AgentRuntimeExecutionNode, AgentRuntimeTodoItem } from '@proma/shared'
import {
  agentFloatingPanelExecutionNodeStatesAtom,
  agentFloatingPanelPlanStatesAtom,
  agentRuntimeExecutionGraphsAtom,
  agentSidePanelRuntimeHistoryAtom,
  beginAgentFloatingPanelTurnAtom,
  mergeAgentRuntimeExecutionGraphAtom,
} from '@/atoms/agent-atoms'
import {
  advanceFloatingPanelPlanState,
  areFloatingPlanTodosCompleted,
  createFloatingPlanSignature,
  isFloatingExecutionNodeTerminal,
} from '@/lib/session-floating-runtime-lifecycle'

const COMPLETED_PLAN: AgentRuntimeTodoItem[] = [
  { id: '1', content: '完成实现', status: 'completed' },
  { id: '2', content: '完成验证', status: 'completed' },
]

describe('会话悬浮面板运行时生命周期', () => {
  test('Given 当前轮计划全部完成 When 本轮结束 Then 继续保留计划', () => {
    const store = createStore()
    store.set(agentFloatingPanelPlanStatesAtom, new Map([['session', {
      observedTurnEpoch: 100,
    }]]))
    store.set(agentRuntimeExecutionGraphsAtom, new Map([['session', {
      nodes: [],
      todos: COMPLETED_PLAN,
      updatedAt: 100,
    }]]))

    expect(store.get(agentFloatingPanelPlanStatesAtom).get('session')).toEqual({
      observedTurnEpoch: 100,
    })
  })

  test('Given 上一轮计划全部完成 When 新一轮开始 Then 按 Todo 签名屏蔽旧计划', () => {
    const next = advanceFloatingPanelPlanState({
      turnEpoch: 200,
      todos: COMPLETED_PLAN,
    })

    expect(next).toEqual({
      observedTurnEpoch: 200,
      suppressedCompletedPlanSignature: createFloatingPlanSignature(COMPLETED_PLAN),
    })
  })

  test('Given 上一轮计划仍有未完成项 When 新一轮开始 Then 继续显示原计划', () => {
    const todos: AgentRuntimeTodoItem[] = [
      { id: '1', content: '已完成', status: 'completed' },
      { id: '2', content: '继续处理', status: 'in_progress' },
      { id: '3', content: '等待执行', status: 'pending' },
    ]

    expect(areFloatingPlanTodosCompleted(todos)).toBe(false)
    expect(advanceFloatingPanelPlanState({
      turnEpoch: 200,
      todos,
    })).toEqual({
      observedTurnEpoch: 200,
      suppressedCompletedPlanSignature: undefined,
    })
  })

  test('Given 只有执行图时间变化 When Todo 内容和状态不变 Then 计划签名保持稳定', () => {
    expect(createFloatingPlanSignature(COMPLETED_PLAN)).toBe(
      createFloatingPlanSignature([...COMPLETED_PLAN].reverse()),
    )
  })

  test('Given 执行节点进入完成失败停止 When 判断生命周期 Then 都属于待关闭终态', () => {
    const node: AgentRuntimeExecutionNode = {
      id: 'node-1',
      kind: 'subagent',
      name: '检查实现',
      description: '检查实现',
      status: 'completed',
      transcriptAvailable: true,
    }

    expect(isFloatingExecutionNodeTerminal(node)).toBe(true)
    expect(isFloatingExecutionNodeTerminal({ ...node, status: 'failed' })).toBe(true)
    expect(isFloatingExecutionNodeTerminal({ ...node, status: 'stopped' })).toBe(true)
    expect(isFloatingExecutionNodeTerminal({ ...node, status: 'running' })).toBe(false)
    expect(isFloatingExecutionNodeTerminal({ ...node, status: 'queued' })).toBe(false)
  })

  test('Given 外部任务开始时没有旧计划 When 后台完成后首次打开 Then 当前轮完成计划不会被屏蔽', () => {
    const store = createStore()
    store.set(beginAgentFloatingPanelTurnAtom, {
      sessionId: 'external-session',
      epoch: 200,
    })
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'external-session',
      graph: {
        nodes: [],
        todos: COMPLETED_PLAN,
        updatedAt: 300,
      },
    })

    expect(
      store.get(agentFloatingPanelPlanStatesAtom)
        .get('external-session')
        ?.suppressedCompletedPlanSignature,
    ).toBeUndefined()
  })

  test('Given CCB 节点从运行进入完成后执行图立即重置 When 合并执行图 Then 终态快照仍保留', () => {
    const store = createStore()
    store.set(agentRuntimeExecutionGraphsAtom, new Map([['session', {
      nodes: [{
        id: 'ccb-node',
        kind: 'subagent',
        name: 'CCB 节点',
        description: '执行任务',
        status: 'running',
        transcriptAvailable: true,
      }],
      todos: [],
      updatedAt: 100,
    }]]))
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      graph: {
        nodes: [{
          id: 'ccb-node',
          kind: 'subagent',
          name: 'CCB 节点',
          description: '执行任务',
          status: 'completed',
          transcriptAvailable: true,
        }],
        todos: [],
        updatedAt: 101,
      },
    })
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      graph: {
        nodes: [],
        todos: [],
        updatedAt: 102,
      },
    })

    expect(
      store.get(agentFloatingPanelExecutionNodeStatesAtom)
        .get('session')
        ?.get('ccb-node')
        ?.node.status,
    ).toBe('completed')
    expect(
      store.get(agentSidePanelRuntimeHistoryAtom)
        .get('session')
        ?.nodes.find((node) => node.id === 'ccb-node')
        ?.status,
    ).toBe('completed')
  })

  test('Given CCB 实时图短暂清空后才返回终态 When 合并执行图 Then 仍按历史运行态捕获终态并逐条关闭', () => {
    const store = createStore()
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      graph: {
        runtimeSessionId: 'runtime',
        nodes: [{
          id: 'ccb-delayed-terminal',
          kind: 'subagent',
          description: '后台子智能体',
          status: 'running',
          transcriptAvailable: true,
        }],
        todos: [],
        updatedAt: 100,
      },
    })
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      graph: {
        runtimeSessionId: 'runtime',
        nodes: [],
        todos: [],
        updatedAt: 101,
      },
    })
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      graph: {
        runtimeSessionId: 'runtime',
        nodes: [{
          id: 'ccb-delayed-terminal',
          kind: 'subagent',
          description: '后台子智能体',
          status: 'completed',
          transcriptAvailable: true,
        }],
        todos: [],
        updatedAt: 102,
      },
    })

    expect(
      store.get(agentFloatingPanelExecutionNodeStatesAtom)
        .get('session')
        ?.get('ccb-delayed-terminal')
        ?.node.status,
    ).toBe('completed')
  })

  test('Given 计划和节点已经同步到右侧历史 When Runtime 清空执行图 Then 右侧完整列表仍保留数据', () => {
    const store = createStore()
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      graph: {
        nodes: [{
          id: 'history-node',
          kind: 'subagent',
          name: '历史子智能体',
          description: '完成历史任务',
          status: 'completed',
          transcriptAvailable: true,
        }],
        todos: COMPLETED_PLAN,
        updatedAt: 100,
      },
    })
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      graph: {
        nodes: [],
        todos: [],
        updatedAt: 101,
      },
    })

    const history = store.get(agentSidePanelRuntimeHistoryAtom).get('session')
    expect(history?.todos).toEqual(COMPLETED_PLAN)
    expect(history?.nodes.map((node) => node.name)).toEqual(['历史子智能体'])
  })

  test('Given 新一轮先收到空执行图 When 旧完成计划快照再次到达 Then 仍保持隐藏避免旧计划回闪', () => {
    const store = createStore()
    store.set(agentRuntimeExecutionGraphsAtom, new Map([['session', {
      nodes: [],
      todos: COMPLETED_PLAN,
      updatedAt: 100,
    }]]))
    store.set(beginAgentFloatingPanelTurnAtom, {
      sessionId: 'session',
      epoch: 200,
    })
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      graph: { nodes: [], todos: [], updatedAt: 201 },
    })
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      graph: { nodes: [], todos: COMPLETED_PLAN, updatedAt: 202 },
    })

    expect(
      store.get(agentFloatingPanelPlanStatesAtom)
        .get('session')
        ?.suppressedCompletedPlanSignature,
    ).toBe(createFloatingPlanSignature(COMPLETED_PLAN))
  })

  test('Given 上一轮完成计划已被屏蔽 When 收到状态不同的新计划 Then 解除旧签名并显示新计划', () => {
    const store = createStore()
    store.set(agentRuntimeExecutionGraphsAtom, new Map([['session', {
      nodes: [],
      todos: COMPLETED_PLAN,
      updatedAt: 100,
    }]]))
    store.set(beginAgentFloatingPanelTurnAtom, {
      sessionId: 'session',
      epoch: 200,
    })
    const nextPlan: AgentRuntimeTodoItem[] = [
      { id: '1', content: '完成实现', status: 'in_progress' },
      { id: '2', content: '完成验证', status: 'pending' },
    ]
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      graph: { nodes: [], todos: nextPlan, updatedAt: 201 },
    })

    expect(
      store.get(agentFloatingPanelPlanStatesAtom)
        .get('session')
        ?.suppressedCompletedPlanSignature,
    ).toBeUndefined()
    expect(
      store.get(agentRuntimeExecutionGraphsAtom)
        .get('session')
        ?.todos,
    ).toEqual(nextPlan)
  })

  test('Given 查询发起后 Runtime 已切换 When 旧查询返回 Then 不覆盖新 Runtime 执行图', () => {
    const store = createStore()
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      graph: {
        runtimeSessionId: 'runtime-new',
        nodes: [],
        todos: [],
        updatedAt: 1,
      },
    })
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId: 'session',
      baseRuntimeSessionId: null,
      graph: {
        runtimeSessionId: 'runtime-old',
        nodes: [],
        todos: COMPLETED_PLAN,
        updatedAt: 999,
      },
    })

    expect(
      store.get(agentRuntimeExecutionGraphsAtom)
        .get('session')
        ?.runtimeSessionId,
    ).toBe('runtime-new')
  })

  test('Given 新 Runtime 出现非空数据 When 同步右侧历史 Then 替换旧 Runtime 而不是无限合并', () => {
    const store = createStore()
    const sessionId = 'runtime-history-replacement'
    store.set(agentSidePanelRuntimeHistoryAtom, new Map([[sessionId, {
      runtimeSessionId: 'runtime-old',
      todos: [{ id: 'old-plan', content: '旧计划', status: 'completed' }],
      nodes: [{
        id: 'same-node',
        kind: 'subagent',
        name: '旧节点',
        description: '旧节点',
        status: 'completed',
        transcriptAvailable: true,
        source: 'runtime',
      }],
      updatedAt: 10,
    }]]))

    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId,
      graph: {
        runtimeSessionId: 'runtime-new',
        todos: [{ id: 'new-plan', content: '新计划', status: 'in_progress' }],
        nodes: [{
          id: 'same-node',
          kind: 'subagent',
          name: '新节点',
          description: '新节点',
          status: 'running',
          transcriptAvailable: true,
        }],
        updatedAt: 20,
      },
    })

    expect(store.get(agentSidePanelRuntimeHistoryAtom).get(sessionId)).toMatchObject({
      runtimeSessionId: 'runtime-new',
      todos: [{ id: 'new-plan' }],
      nodes: [{ id: 'same-node', name: '新节点' }],
    })
  })

  test('Given 多个子智能体依次完成 When 合并终态 Then 已完成节点各自保留且不会被后续节点批量覆盖', () => {
    const store = createStore()
    const sessionId = 'sequential-terminal-cleanup'
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId,
      graph: {
        runtimeSessionId: 'runtime',
        nodes: [
          {
            id: 'node-a',
            kind: 'subagent',
            name: '节点 A',
            description: '先完成',
            status: 'running',
            transcriptAvailable: true,
          },
          {
            id: 'node-b',
            kind: 'subagent',
            name: '节点 B',
            description: '后完成',
            status: 'running',
            transcriptAvailable: true,
          },
        ],
        todos: [],
        updatedAt: 100,
      },
    })
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId,
      graph: {
        runtimeSessionId: 'runtime',
        nodes: [
          {
            id: 'node-a',
            kind: 'subagent',
            name: '节点 A',
            description: '先完成',
            status: 'completed',
            transcriptAvailable: true,
          },
          {
            id: 'node-b',
            kind: 'subagent',
            name: '节点 B',
            description: '后完成',
            status: 'running',
            transcriptAvailable: true,
          },
        ],
        todos: [],
        updatedAt: 101,
      },
    })
    const firstTerminalState = store.get(agentFloatingPanelExecutionNodeStatesAtom)
      .get(sessionId)
      ?.get('node-a')
    expect(firstTerminalState?.node.status).toBe('completed')

    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId,
      graph: {
        runtimeSessionId: 'runtime',
        nodes: [
          {
            id: 'node-a',
            kind: 'subagent',
            name: '节点 A',
            description: '先完成',
            status: 'completed',
            transcriptAvailable: true,
          },
          {
            id: 'node-b',
            kind: 'subagent',
            name: '节点 B',
            description: '后完成',
            status: 'failed',
            transcriptAvailable: true,
          },
        ],
        todos: [],
        updatedAt: 102,
      },
    })

    const terminalStates = store.get(agentFloatingPanelExecutionNodeStatesAtom)
      .get(sessionId)
    expect(terminalStates?.get('node-a')).toBe(firstTerminalState)
    expect(terminalStates?.get('node-b')?.node.status).toBe('failed')
    expect(terminalStates?.size).toBe(2)
  })

  test('Given 同一执行图内多个子智能体同时完成 When 捕获终态 Then 关闭时间逐条错开', () => {
    const store = createStore()
    const sessionId = 'batched-terminal-cleanup'
    const runningNodes: AgentRuntimeExecutionNode[] = [
      {
        id: 'node-a',
        kind: 'subagent',
        description: '节点 A',
        status: 'running',
        transcriptAvailable: true,
      },
      {
        id: 'node-b',
        kind: 'subagent',
        description: '节点 B',
        status: 'running',
        transcriptAvailable: true,
      },
    ]
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId,
      graph: {
        runtimeSessionId: 'runtime',
        nodes: runningNodes,
        todos: [],
        updatedAt: 100,
      },
    })
    store.set(mergeAgentRuntimeExecutionGraphAtom, {
      sessionId,
      graph: {
        runtimeSessionId: 'runtime',
        nodes: runningNodes.map((node) => ({ ...node, status: 'completed' as const })),
        todos: [],
        updatedAt: 101,
      },
    })

    const terminalStates = store.get(agentFloatingPanelExecutionNodeStatesAtom)
      .get(sessionId)
    const firstExpiry = terminalStates?.get('node-a')?.expiresAt
    const secondExpiry = terminalStates?.get('node-b')?.expiresAt
    expect(firstExpiry).toBeNumber()
    expect(secondExpiry).toBeNumber()
    expect(secondExpiry!).toBeGreaterThan(firstExpiry!)
  })
})
