import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type {
  AgentRuntimePlanSessionState,
  AgentRuntimeTodoItem,
} from '@proma/shared'
import {
  agentFloatingPanelPlanStatesAtom,
  agentRuntimeExecutionGraphsAtom,
  agentRuntimePlanLifecycleAtom,
  agentSessionsAtom,
  agentStreamingStatesAtom,
} from '@/atoms/agent-atoms'
import { createRuntimePlanIdentity } from '@/lib/runtime-plan-lifecycle'
import { createFloatingPlanSignature } from '@/lib/session-floating-runtime-lifecycle'
import { RuntimePlanPanel } from './RuntimePlanPanel'
import { RuntimeTodoHoverProgress } from './RuntimeTodoHoverProgress'
import { SessionFloatingPanel } from './SessionFloatingPanel'

const SESSION_ID = 'runtime-plan-lifecycle-views'
const TODOS: AgentRuntimeTodoItem[] = [
  { id: '1', content: '历史计划步骤', status: 'in_progress' },
]

function renderViews(
  state: AgentRuntimePlanSessionState,
  running: boolean = true,
  legacySuppressed: boolean = false,
): {
  todoPill: string
  floatingPanel: string
  planPanel: string
} {
  const store = createStore()
  store.set(agentRuntimeExecutionGraphsAtom, new Map([[SESSION_ID, {
    nodes: [],
    todos: TODOS,
    updatedAt: 1,
  }]]))
  store.set(agentRuntimePlanLifecycleAtom, new Map([[SESSION_ID, state]]))
  if (legacySuppressed) {
    store.set(agentFloatingPanelPlanStatesAtom, new Map([[SESSION_ID, {
      turnEpoch: 100,
      suppressedCompletedPlanSignature: createFloatingPlanSignature(TODOS),
    }]]))
  }
  store.set(agentSessionsAtom, [])
  store.set(agentStreamingStatesAtom, new Map([[SESSION_ID, {
    running,
    content: '',
    toolActivities: [],
    startedAt: 100,
  }]]))

  const render = (node: ReactNode): string => renderToStaticMarkup(
    <Provider store={store}>{node}</Provider>,
  )
  return {
    todoPill: render(<RuntimeTodoHoverProgress sessionId={SESSION_ID} />),
    floatingPanel: render(
      <SessionFloatingPanel sessionId={SESSION_ID} sessionPath={null} />,
    ),
    planPanel: render(<RuntimePlanPanel sessionId={SESSION_ID} />),
  }
}

describe('计划生命周期展示', () => {
  test('Given 本轮停止且计划未完成 When 渲染计划入口 Then 输入框 pill 消失、右侧计划显示待继续且悬浮面板不重复显示', () => {
    const views = renderViews({
      turnEpoch: 100,
      current: {
        id: createRuntimePlanIdentity(TODOS),
        todos: TODOS,
        status: 'interrupted',
        visible: true,
        createdAt: 1,
        updatedAt: 2,
        interruptedAt: 2,
        expiresAt: 3_000,
      },
      archived: [],
    }, false)

    expect(views.todoPill).not.toContain('历史计划步骤')
    expect(views.todoPill).not.toContain('待继续')
    expect(views.planPanel).toContain('历史计划步骤')
    expect(views.planPanel).toContain('待继续')
    expect(views.planPanel).not.toContain('animate-spin')
    expect(views.floatingPanel).not.toContain('历史计划步骤')
    expect(views.floatingPanel).not.toContain('待继续')
  })

  test('Given 下一轮未明确继续旧计划 When 渲染计划入口 Then 全部隐藏旧计划', () => {
    const views = renderViews({
      turnEpoch: 100,
      current: {
        id: createRuntimePlanIdentity(TODOS),
        todos: TODOS,
        status: 'interrupted',
        visible: false,
        createdAt: 1,
        updatedAt: 2,
        interruptedAt: 2,
        expiresAt: 3_000,
      },
      archived: [],
    })

    for (const html of Object.values(views)) {
      expect(html).not.toContain('历史计划步骤')
      expect(html).not.toContain('执行中')
    }
  })

  test('Given 模型明确继续旧计划 When 渲染计划入口 Then 输入框和右侧计划恢复显示且悬浮面板不重复显示', () => {
    const views = renderViews({
      turnEpoch: 100,
      current: {
        id: createRuntimePlanIdentity(TODOS),
        todos: TODOS,
        status: 'active',
        visible: true,
        createdAt: 1,
        updatedAt: 2,
        lastActivatedTurnEpoch: 100,
      },
      archived: [],
    })

    for (const html of [views.todoPill, views.planPanel]) {
      expect(html).toContain('历史计划步骤')
      expect(html).toContain('执行中')
    }
    expect(views.floatingPanel).not.toContain('历史计划步骤')
    expect(views.floatingPanel).not.toContain('执行中')
  })

  test('Given 旧悬浮签名仍残留 When 生命周期计划可见 Then 不影响输入框和右侧计划且悬浮面板仍不重复显示', () => {
    const views = renderViews({
      turnEpoch: 100,
      current: {
        id: createRuntimePlanIdentity(TODOS),
        todos: TODOS,
        status: 'active',
        visible: true,
        createdAt: 1,
        updatedAt: 2,
        lastActivatedTurnEpoch: 100,
      },
      archived: [],
    }, true, true)

    for (const html of [views.todoPill, views.planPanel]) {
      expect(html).toContain('历史计划步骤')
      expect(html).toContain('执行中')
    }
    expect(views.floatingPanel).not.toContain('历史计划步骤')
    expect(views.floatingPanel).not.toContain('执行中')
  })
})
