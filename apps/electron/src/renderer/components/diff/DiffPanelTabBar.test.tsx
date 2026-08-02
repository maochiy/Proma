import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createAgentExecutionNodeTab,
  currentAgentSessionIdAtom,
} from '@/atoms/agent-atoms'
import {
  AGENT_SIDE_PANEL_TAB_LABELS,
  DiffPanelTabBar,
} from './DiffPanelTabBar'

describe('DiffPanelTabBar 右侧动态 Tab 栏', () => {
  test('Given 只打开一个执行节点 Tab When 渲染 Then 节点标题正确且加号紧邻 Tabs', () => {
    const store = createStore()
    const nodeTab = createAgentExecutionNodeTab('node-1')
    store.set(currentAgentSessionIdAtom, 'session-1')

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <DiffPanelTabBar
          activeTab={nodeTab}
          openTabs={[nodeTab]}
          availableTabs={['session', 'workspace', 'changes', 'plan', 'execution']}
          onTabChange={() => undefined}
          onTabClose={() => undefined}
          onTabAdd={() => undefined}
          onTabReorder={() => undefined}
          getTabLabel={() => '布局分析'}
        />
      </Provider>,
    )

    expect(html).toContain('布局分析')
    expect(html).toContain('w-fit')
    expect(html).toContain('w-[120px]')
    expect(html).toContain('aria-label="打开其他功能"')
    expect(html).toContain('ml-1')
    expect(AGENT_SIDE_PANEL_TAB_LABELS.plan).toBe('计划')
    expect(AGENT_SIDE_PANEL_TAB_LABELS.execution).toBe('子智能体')
  })
})
