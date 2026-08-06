import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentRunningIndicator } from './AgentRunningIndicator'

describe('AgentRunningIndicator 执行中模型图标', () => {
  test('Given 会话正在使用明确模型 When 渲染执行中状态 Then 显示对应模型图标与已处理+正在思考', () => {
    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <AgentRunningIndicator
          startedAt={Date.now() - 2_000}
          model="claude-sonnet-4"
        />
      </Provider>,
    )

    expect(html).toContain('alt="模型"')
    expect(html).toContain('已处理 2 秒')
    expect(html).toContain('data-agent-status-divider="true"')
    // ≥1s 顶栏已处理后，下方仍要有「正在思考」活动行
    expect(html).toContain('data-agent-activity="thinking"')
    expect(html).toContain('正在思考')
    expect(html).toContain('agent-status-shimmer')
    // 开局占位纯淡入，不再用 max-height 撑开
    expect(html).toContain('agent-activity-fade-in')
    expect(html).not.toContain('agent-processing-enter')
    expect(html).not.toContain('animate-spin')
  })

  test('Given 执行节点未返回模型 When 渲染执行中状态 Then 使用默认模型图标回退并显示正在思考', () => {
    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <AgentRunningIndicator />
      </Provider>,
    )

    expect(html).toContain('正在思考')
    expect(html).toContain('data-agent-activity="thinking"')
    expect(html).toContain('agent-status-shimmer')
  })
})
