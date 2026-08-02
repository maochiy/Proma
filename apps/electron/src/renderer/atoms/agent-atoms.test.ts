import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import {
  agentDiffPanelTabAtom,
  agentSidePanelTabsAtom,
  applyAgentEvent,
  fileBrowserAutoRevealAtom,
  markAgentFileModifiedAtom,
  recentlyModifiedPathsAtom,
  type AgentStreamState,
} from './agent-atoms'

function createStreamState(overrides: Partial<AgentStreamState> = {}): AgentStreamState {
  return {
    running: true,
    content: '',
    toolActivities: [],
    inputTokens: 180_000,
    outputTokens: 2_000,
    cacheReadTokens: 160_000,
    cacheCreationTokens: 18_000,
    contextWindow: 200_000,
    ...overrides,
  }
}

describe('Agent 上下文压缩状态', () => {
  test('given Pi 手动压缩提供预估 token when 压缩完成 then 显示预估值并清除旧明细', () => {
    const result = applyAgentEvent(createStreamState(), {
      type: 'compact_complete',
      status: 'success',
      estimatedTokensAfter: 32_000,
    })

    expect(result).toMatchObject({
      isCompacting: false,
      inputTokens: 32_000,
      contextWindow: 200_000,
      contextUsageIsEstimated: true,
    })
    expect(result.outputTokens).toBeUndefined()
    expect(result.cacheReadTokens).toBeUndefined()
    expect(result.cacheCreationTokens).toBeUndefined()
  })

  test('given 压缩后的预估值 when 当前压缩操作的收尾 result 没有 usage then 保留预估状态', () => {
    const compacted = applyAgentEvent(createStreamState(), {
      type: 'compact_complete',
      status: 'success',
      estimatedTokensAfter: 32_000,
    })
    const result = applyAgentEvent(compacted, { type: 'complete' })

    expect(result).toMatchObject({
      inputTokens: 32_000,
      contextUsageIsEstimated: true,
    })
  })

  test('given 压缩后的预估值 when 收到零 token result then 保留预估状态', () => {
    const compacted = applyAgentEvent(createStreamState(), {
      type: 'compact_complete',
      status: 'success',
      estimatedTokensAfter: 32_000,
    })
    const result = applyAgentEvent(compacted, {
      type: 'complete',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    })

    expect(result).toMatchObject({
      inputTokens: 32_000,
      contextUsageIsEstimated: true,
    })
  })

  test('given 压缩后的预估值 when 下一轮收到真实 usage then 用真实值覆盖预估状态', () => {
    const compacted = applyAgentEvent(createStreamState(), {
      type: 'compact_complete',
      status: 'success',
      estimatedTokensAfter: 32_000,
    })
    const result = applyAgentEvent(compacted, {
      type: 'usage_update',
      usage: {
        inputTokens: 36_000,
        cacheReadTokens: 30_000,
        outputTokens: 800,
      },
    })

    expect(result).toMatchObject({
      inputTokens: 36_000,
      cacheReadTokens: 30_000,
      outputTokens: 800,
      contextUsageIsEstimated: false,
    })
  })

  test('given 压缩后的预估值 when 下一轮仅在 result 返回 usage then 用真实值覆盖预估状态', () => {
    const compacted = applyAgentEvent(createStreamState(), {
      type: 'compact_complete',
      status: 'success',
      estimatedTokensAfter: 32_000,
    })
    const result = applyAgentEvent(compacted, {
      type: 'complete',
      usage: {
        inputTokens: 40_000,
        cacheReadTokens: 34_000,
      },
    })

    expect(result).toMatchObject({
      inputTokens: 40_000,
      cacheReadTokens: 34_000,
      contextUsageIsEstimated: false,
    })
  })

  test('given 没有 Pi 预估 token 的压缩完成事件 when 处理 then 保持既有上下文用量', () => {
    const result = applyAgentEvent(createStreamState(), { type: 'compact_complete', status: 'success' })

    expect(result).toMatchObject({
      isCompacting: false,
      inputTokens: 180_000,
    })
    expect(result.contextUsageIsEstimated).toBeUndefined()
  })
})

describe('Agent 文件修改展示状态', () => {
  test('Given 右侧没有打开文件 Tab When Agent 修改文件 Then 只记录标记且不创建 Tab 或定位文件', () => {
    const store = createStore()
    const sessionId = 'agent-file-write-session'
    const path = '/tmp/project/src/new-file.ts'

    store.set(markAgentFileModifiedAtom, {
      sessionId,
      path,
      modifiedAt: 123,
    })

    expect(store.get(recentlyModifiedPathsAtom).get(sessionId)?.get(path)).toBe(123)
    expect(store.get(agentSidePanelTabsAtom).get(sessionId)).toBeUndefined()
    expect(store.get(agentDiffPanelTabAtom).get(sessionId)).toBeUndefined()
    expect(store.get(fileBrowserAutoRevealAtom)).toBeNull()
  })

  test('Given 用户已打开其他文件 Tab When Agent 修改文件 Then 不切换 Tab 且不覆盖用户定位状态', () => {
    const store = createStore()
    const sessionId = 'agent-file-write-session'
    const manualReveal = {
      sessionId,
      path: '/tmp/project/src/manual.ts',
      ts: 100,
    }
    store.set(agentSidePanelTabsAtom, new Map([[sessionId, ['workspace']]]))
    store.set(agentDiffPanelTabAtom, new Map([[sessionId, 'workspace']]))
    store.set(fileBrowserAutoRevealAtom, manualReveal)

    store.set(markAgentFileModifiedAtom, {
      sessionId,
      path: '/tmp/project/src/generated.ts',
      modifiedAt: 123,
    })

    expect(store.get(agentSidePanelTabsAtom).get(sessionId)).toEqual(['workspace'])
    expect(store.get(agentDiffPanelTabAtom).get(sessionId)).toBe('workspace')
    expect(store.get(fileBrowserAutoRevealAtom)).toEqual(manualReveal)
  })
})
