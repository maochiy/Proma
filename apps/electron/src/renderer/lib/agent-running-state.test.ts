import { describe, expect, test } from 'bun:test'
import type { AgentEvent } from '@proma/shared'
import type { AgentStreamState } from '@/atoms/agent-atoms'
import {
  reconcileAgentRunActivity,
  shouldSuppressAgentRunningIndicator,
} from './agent-running-state'

function createStreamState(overrides: Partial<AgentStreamState> = {}): AgentStreamState {
  return {
    running: false,
    content: '',
    toolActivities: [],
    ...overrides,
  }
}

describe('Agent 执行中状态恢复', () => {
  test('Given 内存状态已提前空闲 When 仍收到文本输出 Then 恢复为执行中', () => {
    const event: AgentEvent = {
      type: 'text_complete',
      text: '仍在继续执行',
      isIntermediate: false,
    }

    expect(reconcileAgentRunActivity(createStreamState(), event)).toMatchObject({
      running: true,
      backgroundWaiting: false,
    })
  })

  test('Given 后台等待态 When 收到任务进度 Then 恢复为执行中并退出等待态', () => {
    const event: AgentEvent = {
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tool-1',
      elapsedSeconds: 12,
    }

    expect(reconcileAgentRunActivity(
      createStreamState({ backgroundWaiting: true }),
      event,
    )).toMatchObject({
      running: true,
      backgroundWaiting: false,
    })
  })

  test('Given 会话已空闲 When 仅收到 usage 元数据 Then 不误恢复为执行中', () => {
    const state = createStreamState()
    const event: AgentEvent = {
      type: 'usage_update',
      usage: { inputTokens: 100 },
    }

    expect(reconcileAgentRunActivity(state, event)).toBe(state)
  })
})

describe('Agent 执行中指示器压缩判断', () => {
  test('Given 压缩仍在进行 When 判断指示器 Then 隐藏普通执行中状态', () => {
    expect(shouldSuppressAgentRunningIndicator({
      isCompacting: true,
      contextCompaction: { status: 'running' },
    })).toBe(true)
  })

  test('Given 压缩已完成但 Agent 继续执行 When 判断指示器 Then 恢复显示执行中状态', () => {
    expect(shouldSuppressAgentRunningIndicator({
      isCompacting: false,
      contextCompaction: { status: 'success' },
    })).toBe(false)
  })
})
