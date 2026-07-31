import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentRuntimeExecutionGraph } from '@proma/shared'
import { agentRuntimeExecutionGraphsAtom } from '@/atoms/agent-atoms'
import { RuntimeTodoHoverProgress } from './RuntimeTodoHoverProgress'

const SESSION_ID = 'runtime-plan-card-test'

const EXECUTION_GRAPH: AgentRuntimeExecutionGraph = {
  nodes: [],
  todos: [
    {
      id: 'todo-1',
      content: '定位登录、认证、用户状态相关代码',
      status: 'in_progress',
    },
    {
      id: 'todo-2',
      content: '追踪渲染进程到主进程的完整调用链',
      status: 'pending',
    },
    {
      id: 'todo-3',
      content: '总结流程、状态持久化及风险点',
      status: 'pending',
    },
  ],
  updatedAt: 1,
}

function renderRuntimeTodoHoverProgress(): string {
  const store = createStore()
  store.set(agentRuntimeExecutionGraphsAtom, new Map([[SESSION_ID, EXECUTION_GRAPH]]))

  return renderToStaticMarkup(
    <Provider store={store}>
      <RuntimeTodoHoverProgress sessionId={SESSION_ID} />
    </Provider>,
  )
}

describe('RuntimeTodoHoverProgress 计划进度卡片', () => {
  test('Given 运行时存在计划 When 渲染计划入口 Then 入口居中且宽度随内容变化', () => {
    const html = renderRuntimeTodoHoverProgress()

    expect(html).toContain('mx-auto mb-2 w-fit')
    expect(html).toContain('inline-flex h-9')
    expect(html).toContain('第 1 / 3 步')
    expect(html).not.toContain('group relative z-30 mx-auto mb-2 w-full')
  })

  test('Given 入口与面板同时渲染 When 检查视觉样式 Then 使用相同的不透明卡片背景、圆角与阴影', () => {
    const html = renderRuntimeTodoHoverProgress()

    expect(html.match(/bg-card/g)).toHaveLength(2)
    expect(html.match(/rounded-\[14px\]/g)).toHaveLength(2)
    expect(html.match(/shadow-md/g)).toHaveLength(2)
    expect(html).not.toContain('bg-popover/98')
    expect(html).not.toContain('backdrop-blur')
  })

  test('Given 计划内容长度不同 When 渲染悬浮面板 Then 面板按内容自适应且入口显示浅蓝色进度圆圈', () => {
    const html = renderRuntimeTodoHoverProgress()

    expect(html).toContain('group relative')
    expect(html).toContain('pb-2')
    expect(html).toContain('group-hover:pointer-events-auto')
    expect(html).toContain('w-max max-w-[min(420px,calc(100vw-3rem))]')
    expect(html).not.toContain('w-[min(390px,calc(100vw-3rem))]')
    expect(html).toContain('text-sky-200 dark:text-sky-400/75')
    expect(html).toContain('定位登录、认证、用户状态相关代码')
  })
})
