import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentRuntimeExecutionGraph, AgentTurnChangeStats } from '@proma/shared'
import {
  agentRuntimeExecutionGraphsAtom,
  agentStreamingStatesAtom,
  agentTurnChangeStatsAtom,
} from '@/atoms/agent-atoms'
import { RuntimeTodoHoverProgress } from './RuntimeTodoHoverProgress'

const SESSION_ID = 'runtime-plan-card-test'
type RuntimeTodoStore = ReturnType<typeof createStore>

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

function createRuntimeTodoStore(options?: {
  graph?: AgentRuntimeExecutionGraph
  stats?: AgentTurnChangeStats
  startedAt?: number
}): RuntimeTodoStore {
  const store = createStore()
  store.set(agentRuntimeExecutionGraphsAtom, new Map([[
    SESSION_ID,
    options?.graph ?? EXECUTION_GRAPH,
  ]]))
  if (options?.stats) {
    store.set(agentTurnChangeStatsAtom, new Map([[SESSION_ID, options.stats]]))
  }
  if (options?.startedAt != null) {
    store.set(agentStreamingStatesAtom, new Map([[
      SESSION_ID,
      {
        running: true,
        content: '',
        toolActivities: [],
        startedAt: options.startedAt,
      },
    ]]))
  }
  return store
}

function renderRuntimeTodoHoverProgress(options?: {
  graph?: AgentRuntimeExecutionGraph
  stats?: AgentTurnChangeStats
  startedAt?: number
}): string {
  const store = createRuntimeTodoStore(options)
  return renderRuntimeTodoHoverProgressWithStore(store)
}

function renderRuntimeTodoHoverProgressWithStore(store: RuntimeTodoStore): string {
  return renderToStaticMarkup(
    <Provider store={store}>
      <RuntimeTodoHoverProgress sessionId={SESSION_ID} />
    </Provider>,
  )
}

describe('RuntimeTodoHoverProgress 计划进度卡片', () => {
  test('Given 运行时存在计划 When 渲染计划入口 Then 入口居中且宽度随内容变化', () => {
    const html = renderRuntimeTodoHoverProgress()

    expect(html).toContain('group relative z-30 w-fit')
    expect(html).toContain('inline-flex h-9')
    expect(html).toContain('第 1 / 3 步')
    expect(html).not.toContain('mb-2')
    expect(html).not.toContain('group relative z-30 w-full')
  })

  test('Given 入口与面板同时渲染 When 检查视觉样式 Then 使用相同的不透明卡片背景、圆角与阴影', () => {
    const html = renderRuntimeTodoHoverProgress()

    expect(html.match(/bg-card/g)).toHaveLength(2)
    expect(html.match(/rounded-\[14px\]/g)).toHaveLength(2)
    expect(html.match(/shadow-md/g)).toHaveLength(2)
    expect(html).not.toContain('bg-popover/98')
    expect(html).not.toContain('backdrop-blur')
  })

  test('Given 计划内容长度不同 When 渲染悬浮面板 Then 面板按内容自适应且入口显示浅蓝色完成度圆环', () => {
    const html = renderRuntimeTodoHoverProgress()

    expect(html).toContain('group relative')
    expect(html).toContain('pb-2')
    expect(html).toContain('group-hover:pointer-events-auto')
    expect(html).toContain('w-max max-w-[min(420px,calc(100vw-3rem))]')
    expect(html).not.toContain('w-[min(390px,calc(100vw-3rem))]')
    expect(html).toContain('data-plan-progress="0"')
    expect(html).toContain('stroke-sky-100 dark:stroke-sky-900/70')
    expect(html).toContain('stroke-sky-400')
    expect(html).toContain('定位登录、认证、用户状态相关代码')
  })

  test('Given 五步计划已完成四步 When 渲染计划入口 Then 蓝色圆环按百分之八十填充', () => {
    const html = renderRuntimeTodoHoverProgress({
      graph: {
        nodes: [],
        todos: [
          { id: 'todo-1', content: '步骤一', status: 'completed' },
          { id: 'todo-2', content: '步骤二', status: 'completed' },
          { id: 'todo-3', content: '步骤三', status: 'completed' },
          { id: 'todo-4', content: '步骤四', status: 'completed' },
          { id: 'todo-5', content: '步骤五', status: 'in_progress' },
        ],
        updatedAt: 2,
      },
    })

    expect(html).toContain('第 5 / 5 步')
    expect(html).toContain('data-plan-progress="80"')
    expect(html).toContain('stroke-dasharray="80 100"')
    expect(html).toContain('计划完成度 80%')
  })

  test('Given Todo 返回顺序与实际完成进度不同 When 渲染计划入口 Then 当前步数按完成数量推进而不依赖数组位置', () => {
    const html = renderRuntimeTodoHoverProgress({
      graph: {
        nodes: [],
        todos: [
          { id: 'todo-3', content: '步骤三', status: 'in_progress' },
          { id: 'todo-1', content: '步骤一', status: 'completed' },
          { id: 'todo-2', content: '步骤二', status: 'completed' },
          { id: 'todo-4', content: '步骤四', status: 'pending' },
        ],
        updatedAt: 3,
      },
    })

    expect(html).toContain('第 3 / 4 步')
    expect(html).toContain('data-plan-progress="50"')
  })

  test('Given 计划状态和总数发生变化 When Jotai 执行图更新后重新渲染 Then 入口分子与分母同步更新', () => {
    const store = createRuntimeTodoStore()
    const initialHtml = renderRuntimeTodoHoverProgressWithStore(store)

    expect(initialHtml).toContain('第 1 / 3 步')

    store.set(agentRuntimeExecutionGraphsAtom, new Map([[
      SESSION_ID,
      {
        nodes: [],
        todos: [
          { id: 'todo-1', content: '步骤一', status: 'completed' },
          { id: 'todo-2', content: '步骤二', status: 'in_progress' },
          { id: 'todo-3', content: '步骤三', status: 'pending' },
          { id: 'todo-4', content: '步骤四', status: 'pending' },
        ],
        updatedAt: 4,
      },
    ]]))

    const updatedHtml = renderRuntimeTodoHoverProgressWithStore(store)
    expect(updatedHtml).toContain('第 2 / 4 步')
    expect(updatedHtml).toContain('data-plan-progress="25"')
  })

  test('Given 所有计划均已完成 When 渲染计划入口 Then 蓝色圆环显示百分之百', () => {
    const html = renderRuntimeTodoHoverProgress({
      graph: {
        nodes: [],
        todos: [
          { id: 'todo-1', content: '步骤一', status: 'completed' },
          { id: 'todo-2', content: '步骤二', status: 'completed' },
        ],
        updatedAt: 5,
      },
    })

    expect(html).toContain('第 2 / 2 步')
    expect(html).toContain('data-plan-progress="100"')
    expect(html).toContain('stroke-dasharray="100 100"')
  })

  test('Given 计划包含四种步骤状态 When 渲染悬浮面板 Then 状态图标和执行说明分别显示', () => {
    const html = renderRuntimeTodoHoverProgress({
      graph: {
        nodes: [],
        todos: [
          {
            id: 'todo-completed',
            content: '确认入口视觉',
            status: 'completed',
          },
          {
            id: 'todo-running',
            content: '实现入口进度圆环',
            status: 'in_progress',
            activeForm: '正在实现入口进度圆环',
          },
          {
            id: 'todo-pending',
            content: '补充自动化测试',
            status: 'pending',
          },
          {
            id: 'todo-blocked',
            content: '等待上游接口',
            status: 'blocked',
          },
        ],
        updatedAt: 6,
      },
    })

    expect(html).toContain('data-plan-status-icon="completed"')
    expect(html).toContain('aria-label="已完成"')
    expect(html).toContain('data-plan-status-icon="in_progress"')
    expect(html).toContain('animate-spin')
    expect(html).toContain('text-sky-500')
    expect(html).toContain('执行中 · 正在实现入口进度圆环')
    expect(html).toContain('data-plan-status-icon="pending"')
    expect(html).toContain('aria-label="等待中"')
    expect(html).toContain('data-plan-status-icon="blocked"')
    expect(html).toContain('aria-label="已阻塞"')
  })

  test('Given 本轮尚无文件改动 When 渲染计划入口 Then 不显示改动统计', () => {
    const html = renderRuntimeTodoHoverProgress({
      startedAt: 100,
      stats: {
        startedAt: 100,
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        updatedAt: 101,
      },
    })

    expect(html).not.toContain('个文件已更改')
    expect(html).not.toContain('text-emerald-500')
    expect(html).not.toContain('text-red-500')
  })

  test('Given 本轮已有文件改动 When 渲染计划入口 Then 显示文件数和增删行数', () => {
    const html = renderRuntimeTodoHoverProgress({
      startedAt: 200,
      stats: {
        startedAt: 200,
        filesChanged: 3,
        additions: 128,
        deletions: 24,
        updatedAt: 201,
      },
    })

    expect(html).toContain('3 个文件已更改')
    expect(html).toContain('text-emerald-500')
    expect(html).toContain('+128')
    expect(html).toContain('text-red-500')
    expect(html).toContain('-24')
  })

  test('Given 页面仍保留上一轮统计 When 新一轮已经开始 Then 不显示旧统计', () => {
    const html = renderRuntimeTodoHoverProgress({
      startedAt: 301,
      stats: {
        startedAt: 300,
        filesChanged: 2,
        additions: 8,
        deletions: 3,
        updatedAt: 302,
      },
    })

    expect(html).not.toContain('个文件已更改')
    expect(html).not.toContain('text-emerald-500')
    expect(html).not.toContain('text-red-500')
  })

  test('Given 本轮只有二进制或重命名文件变化 When 增删行数为零 Then 只显示文件数', () => {
    const html = renderRuntimeTodoHoverProgress({
      startedAt: 400,
      stats: {
        startedAt: 400,
        filesChanged: 1,
        additions: 0,
        deletions: 0,
        updatedAt: 401,
      },
    })

    expect(html).toContain('1 个文件已更改')
    expect(html).not.toContain('text-emerald-500')
    expect(html).not.toContain('text-red-500')
  })
})
