import { describe, expect, test } from 'bun:test'
import { Provider, createStore } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentRuntimeSubagentTranscript } from '@proma/shared'
import { agentExecutionNodeTranscriptCacheAtom } from '@/atoms/agent-atoms'
import type { SessionExecutionNode } from '@/lib/session-execution-nodes'
import { RuntimeExecutionNodePanel } from './RuntimeExecutionNodePanel'

describe('RuntimeExecutionNodePanel 执行节点会话正文', () => {
  test('Given 打开 CCB 或 Collaboration 执行节点 Tab When 首次渲染 Then 不固定展示节点摘要消息', () => {
    const node: SessionExecutionNode = {
      id: 'delegation:child-session',
      kind: 'subagent',
      name: '分析会话悬浮面板',
      description: '这是一段不应固定显示在正文顶部的完整节点创建说明',
      status: 'completed',
      transcriptAvailable: true,
      source: 'delegation',
      transcriptSessionId: 'child-session',
      model: 'test-model',
      agentType: 'explore',
    }

    const html = renderToStaticMarkup(
      <RuntimeExecutionNodePanel
        sessionId="parent-session"
        sessionPath={null}
        node={node}
        running={false}
      />,
    )

    expect(html).toContain('正在读取执行节点会话')
    expect(html).not.toContain(node.name)
    expect(html).not.toContain(node.description)
    expect(html).not.toContain('test-model')
    expect(html).not.toContain('explore')
  })

  test('Given 子智能体仍在运行 When 打开详情 Tab Then 始终显示 Agent Running', () => {
    const node: SessionExecutionNode = {
      id: 'delegation:running-child',
      kind: 'subagent',
      name: '持续执行任务',
      description: '验证运行状态',
      status: 'running',
      startedAt: Date.now() - 2_000,
      transcriptAvailable: true,
      source: 'delegation',
      transcriptSessionId: 'running-child',
    }

    const html = renderToStaticMarkup(
      <RuntimeExecutionNodePanel
        sessionId="parent-session"
        sessionPath={null}
        node={node}
        running
      />,
    )

    expect(html).toContain('正在读取执行节点会话')
    expect(html).toContain('Agent Running')
  })

  test('Given CCB Transcript 已包含发送提示词 When 打开详情 Tab Then 按主会话用户消息显示且不显示 JSON', () => {
    const node: SessionExecutionNode = {
      id: 'ccb-agent-1',
      kind: 'subagent',
      name: '检查项目',
      description: '节点摘要不应代替发送提示词',
      status: 'running',
      transcriptAvailable: true,
      source: 'runtime',
    }
    const cacheKey = `parent-session:${node.id}`
    const transcript: AgentRuntimeSubagentTranscript = {
      executionNodeId: node.id,
      messages: [{
        type: 'user',
        parent_tool_use_id: null,
        uuid: 'ccb-prompt',
        message: {
          content: [{
            type: 'text',
            text: '请完整检查当前项目，并返回关键问题。',
          }],
        },
      }],
    }
    const store = createStore()
    store.set(
      agentExecutionNodeTranscriptCacheAtom,
      new Map([[cacheKey, transcript]]),
    )

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <RuntimeExecutionNodePanel
          sessionId="parent-session"
          sessionPath={null}
          node={node}
          running
        />
      </Provider>,
    )

    expect(html).toContain('请完整检查当前项目，并返回关键问题。')
    expect(html).not.toContain('&quot;type&quot;')
    expect(html).not.toContain(node.description)
  })
})
