import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentRuntimeExecutionGraph, AgentTurnChangeStats } from '@proma/shared'
import {
  agentRuntimeExecutionGraphsAtom,
  agentStreamingStatesAtom,
  agentTurnChangeStatsAtom,
} from '@/atoms/agent-atoms'
import {
  RuntimeTodoHoverProgress,
  shouldShowRuntimeTodoProgress,
} from './RuntimeTodoHoverProgress'

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
  /** 默认 true：计划入口只在会话执行中显示 */
  running?: boolean
  isCompacting?: boolean
  contextCompaction?: {
    status: 'running' | 'success' | 'noop' | 'failed'
  }
}): RuntimeTodoStore {
  const store = createStore()
  store.set(agentRuntimeExecutionGraphsAtom, new Map([[
    SESSION_ID,
    options?.graph ?? EXECUTION_GRAPH,
  ]]))
  if (options?.stats) {
    store.set(agentTurnChangeStatsAtom, new Map([[SESSION_ID, options.stats]]))
  }
  const running = options?.running ?? true
  store.set(agentStreamingStatesAtom, new Map([[
    SESSION_ID,
    {
      running,
      content: '',
      toolActivities: [],
      startedAt: options?.startedAt ?? (running ? Date.now() : undefined),
      ...(options?.isCompacting != null && { isCompacting: options.isCompacting }),
      ...(options?.contextCompaction && {
        contextCompaction: options.contextCompaction,
      }),
    },
  ]]))
  return store
}

function renderRuntimeTodoHoverProgress(options?: {
  graph?: AgentRuntimeExecutionGraph
  stats?: AgentTurnChangeStats
  startedAt?: number
  running?: boolean
  isCompacting?: boolean
  contextCompaction?: {
    status: 'running' | 'success' | 'noop' | 'failed'
  }
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


  test('Given 多个任务并行执行且尚未完成 When 渲染计划入口 Then 当前步按已完成加执行中计数', () => {
    const html = renderRuntimeTodoHoverProgress({
      graph: {
        nodes: [],
        todos: [
          { id: '1', content: '步骤一', status: 'pending' },
          { id: '2', content: '步骤二', status: 'in_progress' },
          { id: '3', content: '步骤三', status: 'in_progress' },
          { id: '4', content: '步骤四', status: 'pending' },
          { id: '5', content: '步骤五', status: 'in_progress' },
          { id: '6', content: '步骤六', status: 'pending' },
        ],
        updatedAt: 7,
      },
    })

    // 0 completed + 3 in_progress => 第 3 / 6 步，而不是卡在第 1 / 6 步
    expect(html).toContain('第 3 / 6 步')
    expect(html).not.toContain('第 1 / 6 步')
    expect(html).not.toContain('项进行中')
    expect(html).toContain('data-plan-progress="0"')
  })

  test('Given 主计划已有完成项且多任务并行 When 渲染计划入口 Then 当前步等于已完成加执行中', () => {
    const html = renderRuntimeTodoHoverProgress({
      graph: {
        nodes: [],
        todos: [
          { id: '1', content: '核对计划与代码基线', status: 'completed' },
          { id: '2', content: '重命名并扩展插件协议', status: 'completed' },
          { id: '3', content: '接入三端原生推送来电', status: 'in_progress' },
          { id: '4', content: '接通 Flutter 业务链路', status: 'in_progress' },
          { id: '5', content: '验证配置构建和通话场景', status: 'in_progress' },
          { id: '6', content: 'Inspect approved plan and renamed plugin', status: 'completed' },
          { id: '81', content: '实现 HarmonyOS 推送与来电通知', status: 'in_progress' },
          { id: '82', content: '实现 iOS 阿里云推送与 LCK', status: 'in_progress' },
          { id: '83', content: '实现 Android 推送与来电通知', status: 'in_progress' },
        ],
        updatedAt: 8,
      },
    })

    // 3 completed + 6 in_progress => 第 9 / 9 步
    expect(html).toContain('第 9 / 9 步')
    expect(html).toContain('data-plan-progress="33"')
    expect(html).not.toContain('第 1 / 6 步')
    expect(html).not.toContain('项进行中')
    // 按数字 ID 稳定排序后，完成项会排在前面显示
    expect(html.indexOf('核对计划与代码基线')).toBeLessThan(html.indexOf('实现 Android 推送与来电通知'))
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

  test('Given 计划仍有 Todo 且正在手动压缩 When 渲染计划入口 Then 不显示入口与悬浮面板', () => {
    const html = renderRuntimeTodoHoverProgress({
      isCompacting: true,
      contextCompaction: { status: 'running' },
    })

    expect(html).toBe('')
    expect(html).not.toContain('第 1 / 3 步')
    expect(html).not.toContain('定位登录、认证、用户状态相关代码')
  })

  test('Given 计划仍有 Todo 且仅 contextCompaction 为 running When 渲染计划入口 Then 同样隐藏', () => {
    const html = renderRuntimeTodoHoverProgress({
      isCompacting: false,
      contextCompaction: { status: 'running' },
    })

    expect(html).toBe('')
    expect(html).not.toContain('第 ')
  })

  test('Given 压缩已结束且会话仍在执行 When 渲染计划入口 Then 恢复显示第 X / Y 步', () => {
    const html = renderRuntimeTodoHoverProgress({
      running: true,
      isCompacting: false,
      contextCompaction: { status: 'success' },
    })

    expect(html).toContain('第 1 / 3 步')
    expect(html).toContain('定位登录、认证、用户状态相关代码')
  })

  test('Given 计划仍有 Todo 且会话已执行结束 When 渲染计划入口 Then 整块入口与面板都隐藏', () => {
    const html = renderRuntimeTodoHoverProgress({
      running: false,
      isCompacting: false,
    })

    expect(html).toBe('')
    expect(html).not.toContain('第 ')
    expect(html).not.toContain('执行中')
    expect(html).not.toContain('定位登录、认证、用户状态相关代码')
  })

  test('Given 会话执行中且任务仍是 in_progress When 渲染计划面板 Then 显示执行中是正常的', () => {
    const html = renderRuntimeTodoHoverProgress({
      running: true,
      graph: {
        nodes: [],
        todos: [
          { id: '1', content: '已完成项', status: 'completed' },
          { id: '2', content: '仍在做的项', status: 'in_progress', activeForm: '正在做' },
          { id: '3', content: '未开始项', status: 'pending' },
        ],
        updatedAt: 9,
      },
    })

    expect(html).toContain('第 2 / 3 步')
    expect(html).toContain('data-plan-status-icon="in_progress"')
    expect(html).toContain('执行中 · 正在做')
    expect(html).toContain('data-plan-status-icon="completed"')
    expect(html).toContain('data-plan-status-icon="pending"')
  })

  test('Given shouldShowRuntimeTodoProgress 可见性规则 When 判断执行态与压缩态 Then 仅执行中且非压缩时显示', () => {
    const todos = EXECUTION_GRAPH.todos

    // 无 streamState / 未 running：视为会话已停，隐藏
    expect(shouldShowRuntimeTodoProgress(todos)).toBe(false)
    expect(shouldShowRuntimeTodoProgress(todos, { running: true })).toBe(true)
    expect(shouldShowRuntimeTodoProgress([])).toBe(false)
    expect(shouldShowRuntimeTodoProgress(todos, {
      running: false,
    })).toBe(false)
    expect(shouldShowRuntimeTodoProgress(todos, {
      running: true,
      isCompacting: true,
    })).toBe(false)
    expect(shouldShowRuntimeTodoProgress(todos, {
      running: true,
      contextCompaction: { status: 'running' },
    })).toBe(false)
    expect(shouldShowRuntimeTodoProgress(todos, {
      running: true,
      isCompacting: false,
      contextCompaction: { status: 'success' },
    })).toBe(true)
    expect(shouldShowRuntimeTodoProgress(todos, {
      running: true,
      isCompacting: false,
      contextCompaction: { status: 'failed' },
    })).toBe(true)
  })
})
