import { describe, expect, test } from 'bun:test'
import { Provider, createStore } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  AgentRuntimeSubagentTranscript,
  SDKAssistantMessage,
  SDKMessage,
} from '@proma/shared'
import {
  agentExecutionNodeTranscriptCacheAtom,
  agentStreamingStatesAtom,
  liveMessagesMapAtom,
} from '@/atoms/agent-atoms'
import type { SessionExecutionNode } from '@/lib/session-execution-nodes'
import {
  mergeRuntimeExecutionTranscriptMessages,
  RuntimeExecutionNodePanel,
} from './RuntimeExecutionNodePanel'

function createAssistantMessage(
  uuid: string,
  text: string,
  options?: {
    partial?: boolean
    messageId?: string
    stopReason?: string
  },
): SDKAssistantMessage {
  return {
    type: 'assistant',
    uuid,
    parent_tool_use_id: null,
    ...(options?.partial ? { _partial: true } : {}),
    message: {
      id: options?.messageId ?? uuid,
      content: [{ type: 'text', text }],
      model: 'test-model',
      stop_reason: options?.stopReason,
    },
  } as SDKAssistantMessage
}

describe('RuntimeExecutionNodePanel 子智能体执行记录', () => {
  test('Given 打开执行节点 Tab When 首次渲染 Then 展示委派任务、状态和执行过程加载区', () => {
    const node: SessionExecutionNode = {
      id: 'delegation:child-session',
      kind: 'subagent',
      name: '分析会话悬浮面板',
      description: '检查会话悬浮面板实现',
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

    expect(html).toContain('委派的任务')
    expect(html).toContain(node.description)
    expect(html).toContain('状态')
    expect(html).toContain(node.name!)
    expect(html).toContain('已完成')
    expect(html).toContain('执行过程')
    expect(html).toContain('正在加载执行记录')
    expect(html).not.toContain('正在加载最终回复')
    expect(html).toContain('title="使用 test-model"')
    expect(html).not.toContain('>test-model<')
  })

  test('Given 子智能体仍在运行且已有实时活动 When 打开详情 Tab Then 使用统一 Turn 规则展示当前内容而非等待最终回复', () => {
    const node: SessionExecutionNode = {
      id: 'delegation:running-child',
      kind: 'subagent',
      name: '持续执行任务',
      description: '验证运行状态',
      status: 'running',
      startedAt: Date.now() - 2_000,
      transcriptAvailable: true,
      model: 'claude-sonnet-4',
      source: 'delegation',
      transcriptSessionId: 'running-child',
    }
    const cacheKey = `parent-session:${node.id}`
    const transcript: AgentRuntimeSubagentTranscript = {
      executionNodeId: node.id,
      messages: [{
        type: 'user',
        parent_tool_use_id: null,
        uuid: 'child-prompt',
        message: {
          content: [{ type: 'text', text: '验证运行状态' }],
        },
      }],
    }
    const store = createStore()
    store.set(
      agentExecutionNodeTranscriptCacheAtom,
      new Map([[cacheKey, transcript]]),
    )
    store.set(
      liveMessagesMapAtom,
      new Map([[
        'running-child',
        [createAssistantMessage(
          'child-running',
          '正在检查认证配置。',
          { partial: true, stopReason: 'tool_use' },
        )],
      ]]),
    )
    store.set(
      agentStreamingStatesAtom,
      new Map([[
        'running-child',
        {
          running: true,
          content: '',
          toolActivities: [],
          model: 'claude-sonnet-4',
          startedAt: Date.now() - 2_000,
        },
      ]]),
    )

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <RuntimeExecutionNodePanel
          cacheKey={cacheKey}
          sessionId="parent-session"
          sessionPath={null}
          node={node}
          running
        />
      </Provider>,
    )

    expect(html).toContain('正在运行')
    expect(html).toContain('正在检查认证配置')
    expect(html).toContain('执行过程')
    expect(html).not.toContain('正在加载最终回复')
    expect(html).toContain('title="使用 claude-sonnet-4"')
    expect(html).not.toContain('>claude-sonnet-4<')
    expect(html).not.toContain('Agent Running')
  })

  test('Given CCB Transcript 已包含发送提示词和助手活动 When 打开详情 Tab Then 展示委派任务并使用统一执行记录渲染', () => {
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
      }, createAssistantMessage(
        'ccb-running',
        '正在审查项目文件。',
        { stopReason: 'tool_use' },
      )],
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
    expect(html).toContain('委派的任务')
    expect(html).toContain('执行过程')
    expect(html).toContain('正在审查项目文件')
    expect(html).not.toContain('&quot;type&quot;')
    expect(html).not.toContain('节点摘要不应代替发送提示词')
  })

  test('Given 子智能体已完成 When Transcript 含活动和最终正文 Then 显示完整活动及最终回答且不显示模型名', () => {
    const node: SessionExecutionNode = {
      id: 'delegation:completed-child',
      kind: 'subagent',
      name: '认证审计',
      description: '检查认证配置',
      status: 'completed',
      transcriptAvailable: true,
      source: 'delegation',
      transcriptSessionId: 'completed-child',
      model: 'test-model',
    }
    const cacheKey = `parent-session:${node.id}`
    const transcript: AgentRuntimeSubagentTranscript = {
      executionNodeId: node.id,
      messages: [
        {
          type: 'user',
          parent_tool_use_id: null,
          uuid: 'prompt',
          message: {
            content: [{ type: 'text', text: '检查认证配置' }],
          },
        },
        createAssistantMessage(
          'process',
          '正在读取渠道配置。',
          { stopReason: 'tool_use' },
        ),
        createAssistantMessage(
          'final',
          '审计完成：认证配置有效。',
          { stopReason: 'end_turn' },
        ),
      ],
    }
    const store = createStore()
    store.set(
      agentExecutionNodeTranscriptCacheAtom,
      new Map([[cacheKey, transcript]]),
    )

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <RuntimeExecutionNodePanel
          cacheKey={cacheKey}
          sessionId="parent-session"
          sessionPath={null}
          node={node}
          running={false}
        />
      </Provider>,
    )

    expect(html).toContain('正在读取渠道配置')
    expect(html).toContain('审计完成：认证配置有效')
    expect(html).toContain('最终回复')
    expect(html).toContain('title="使用 test-model"')
    expect(html).not.toContain('>test-model<')
    expect(html).not.toContain('正在加载最终回复')
  })

  test('Given 子智能体已完成但 Transcript 没有最终正文 When 节点提供摘要 Then 执行过程和结束摘要同时显示', () => {
    const node: SessionExecutionNode = {
      id: 'delegation:summary-child',
      kind: 'subagent',
      name: '认证摘要',
      description: '检查认证配置',
      status: 'completed',
      transcriptAvailable: true,
      summary: '已完成认证链路检查，发现 2 个需要关注的边界。',
      source: 'delegation',
      transcriptSessionId: 'summary-child',
    }
    const cacheKey = `parent-session:${node.id}`
    const transcript: AgentRuntimeSubagentTranscript = {
      executionNodeId: node.id,
      messages: [
        {
          type: 'user',
          parent_tool_use_id: null,
          uuid: 'prompt',
          message: {
            content: [{ type: 'text', text: '检查认证配置' }],
          },
        },
        createAssistantMessage(
          'process',
          '正在读取认证服务。',
          { stopReason: 'tool_use' },
        ),
      ],
    }
    const store = createStore()
    store.set(
      agentExecutionNodeTranscriptCacheAtom,
      new Map([[cacheKey, transcript]]),
    )

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <RuntimeExecutionNodePanel
          cacheKey={cacheKey}
          sessionId="parent-session"
          sessionPath={null}
          node={node}
          running={false}
        />
      </Provider>,
    )

    expect(html).toContain('执行过程')
    expect(html).toContain('正在读取认证服务')
    expect(html).toContain('执行摘要')
    expect(html).toContain('已完成认证链路检查')
    expect(html).not.toContain('最终回复')
  })

  test('Given 子智能体已结束但没有最终正文或摘要 When 打开详情 Then 只保留执行过程且不显示空响应占位', () => {
    const node: SessionExecutionNode = {
      id: 'delegation:no-summary-child',
      kind: 'subagent',
      name: '中断的审计',
      description: '检查认证配置',
      status: 'completed',
      transcriptAvailable: true,
      source: 'delegation',
      transcriptSessionId: 'no-summary-child',
    }
    const cacheKey = `parent-session:${node.id}`
    const transcript: AgentRuntimeSubagentTranscript = {
      executionNodeId: node.id,
      messages: [
        {
          type: 'user',
          parent_tool_use_id: null,
          uuid: 'prompt',
          message: {
            content: [{ type: 'text', text: '检查认证配置' }],
          },
        },
        createAssistantMessage(
          'process',
          '正在读取认证服务。',
          { stopReason: 'tool_use' },
        ),
      ],
    }
    const store = createStore()
    store.set(
      agentExecutionNodeTranscriptCacheAtom,
      new Map([[cacheKey, transcript]]),
    )

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <RuntimeExecutionNodePanel
          cacheKey={cacheKey}
          sessionId="parent-session"
          sessionPath={null}
          node={node}
          running={false}
        />
      </Provider>,
    )

    expect(html).toContain('执行过程')
    expect(html).toContain('正在读取认证服务')
    expect(html).not.toContain('暂无最终响应')
    expect(html).not.toContain('最终回复')
    expect(html).not.toContain('执行摘要')
  })

  test('Given 持久化消息和实时 partial 重叠 When 合并 Transcript Then 同 UUID 只保留最新快照', () => {
    const persisted = [
      createAssistantMessage(
        'same-message',
        '旧的活动内容',
        { partial: true, messageId: 'model-message' },
      ),
    ]
    const live = [
      createAssistantMessage(
        'same-message',
        '最新活动内容',
        { partial: true, messageId: 'model-message' },
      ),
    ]

    const merged = mergeRuntimeExecutionTranscriptMessages(
      persisted as SDKMessage[],
      live as SDKMessage[],
    )

    expect(merged).toHaveLength(1)
    expect(JSON.stringify(merged)).toContain('最新活动内容')
    expect(JSON.stringify(merged)).not.toContain('旧的活动内容')
  })
})
