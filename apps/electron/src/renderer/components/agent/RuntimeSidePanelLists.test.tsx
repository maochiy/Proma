import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentSessionMeta } from '@proma/shared'
import {
  agentRuntimeExecutionGraphsAtom,
  agentSessionsAtom,
  agentSidePanelRuntimeHistoryAtom,
  agentStreamingStatesAtom,
} from '@/atoms/agent-atoms'
import { RuntimeExecutionPanel } from './RuntimeExecutionPanel'
import { RuntimePlanPanel } from './RuntimePlanPanel'

const SESSION_ID = 'runtime-side-list-test'

describe('右侧计划与子智能体列表', () => {
  test('Given Runtime 图已清空但历史仍存在 When 打开计划 Tab Then 显示完整只读计划和实时状态', () => {
    const store = createStore()
    store.set(agentRuntimeExecutionGraphsAtom, new Map([[SESSION_ID, {
      nodes: [],
      todos: [],
      updatedAt: 20,
    }]]))
    store.set(agentSidePanelRuntimeHistoryAtom, new Map([[SESSION_ID, {
      todos: [
        { id: '1', content: '已完成步骤', status: 'completed' },
        { id: '2', content: '当前步骤', status: 'in_progress' },
        { id: '3', content: '后续步骤', status: 'pending' },
      ],
      nodes: [],
      updatedAt: 10,
    }]]))
    store.set(agentStreamingStatesAtom, new Map([[SESSION_ID, {
      running: true,
      content: '',
      toolActivities: [],
    }]]))

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <RuntimePlanPanel sessionId={SESSION_ID} />
      </Provider>,
    )

    expect(html).toContain('data-runtime-plan-panel')
    expect(html).toContain('scrollbar-none')
    expect(html).toContain('overflow-y-auto')
    expect(html).toContain('已完成步骤')
    expect(html).toContain('执行完成')
    expect(html).toContain('执行中')
    expect(html).toContain('未执行')
    expect(html).not.toContain('<button')
  })

  test('Given CCB 历史节点与 Collaboration 节点 When 打开子智能体 Tab Then 完整展示并可点击查看详情', () => {
    const store = createStore()
    const childSession: AgentSessionMeta = {
      id: 'child-session',
      title: 'Proma 子会话',
      parentSessionId: SESSION_ID,
      sourceDelegationId: 'delegation-1',
      delegationStatus: 'completed',
      createdAt: 10,
      updatedAt: 20,
    }
    store.set(agentRuntimeExecutionGraphsAtom, new Map([[SESSION_ID, {
      nodes: [],
      todos: [],
      updatedAt: 30,
    }]]))
    store.set(agentSidePanelRuntimeHistoryAtom, new Map([[SESSION_ID, {
      todos: [],
      nodes: [{
        id: 'ccb-node',
        kind: 'subagent',
        name: 'CCB 原生节点',
        description: '原生执行节点',
        status: 'running',
        transcriptAvailable: true,
        source: 'runtime',
      }],
      updatedAt: 20,
    }]]))
    store.set(agentSessionsAtom, [childSession])
    store.set(agentStreamingStatesAtom, new Map([
      [SESSION_ID, {
        running: true,
        content: '',
        toolActivities: [],
      }],
      [childSession.id, {
        running: false,
        content: '',
        toolActivities: [],
      }],
    ]))

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <RuntimeExecutionPanel
          sessionId={SESSION_ID}
          onOpenNode={() => undefined}
        />
      </Provider>,
    )

    expect(html).toContain('data-runtime-subagent-panel')
    expect(html).toContain('scrollbar-none')
    expect(html).toContain('overflow-y-auto')
    expect(html).toContain('CCB 原生节点')
    expect(html).toContain('Proma 子会话')
    expect(html).toContain('未执行')
    expect(html).toContain('执行完成')
    expect(html).toContain('data-execution-node-id="ccb-node"')
    expect(html).toContain('data-execution-node-id="delegation:child-session"')
  })
})
