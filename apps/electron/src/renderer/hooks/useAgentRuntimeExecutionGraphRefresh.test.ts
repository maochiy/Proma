import { describe, expect, test } from 'bun:test'
import { AGENT_RUNTIME_EXECUTION_GRAPH_POLL_MS } from './useAgentRuntimeExecutionGraphRefresh'

describe('useAgentRuntimeExecutionGraphRefresh 轮询策略', () => {
  test('Given 默认配置 When 读取轮询间隔 Then 使用 2.5s 且慢于旧的 1s 轮询', () => {
    expect(AGENT_RUNTIME_EXECUTION_GRAPH_POLL_MS).toBe(2_500)
    expect(AGENT_RUNTIME_EXECUTION_GRAPH_POLL_MS).toBeGreaterThan(1_000)
  })
})
