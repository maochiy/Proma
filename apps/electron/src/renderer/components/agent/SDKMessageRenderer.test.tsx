import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  SDKAssistantMessage,
  SDKContentBlock,
  SDKToolUseBlock,
} from '@proma/shared'
import type { AssistantTurn } from '@proma/session-core'
import {
  agentRuntimeExecutionGraphsAtom,
  agentSessionsAtom,
} from '@/atoms/agent-atoms'
import { AssistantTurnRenderer } from './SDKMessageRenderer'

describe('AssistantTurnRenderer 流式活动折叠', () => {
  test('Given 多条 stop_reason=tool_use 的思考和过程文本 When 流式渲染 Then 旧活动收起且只显示最新过程', () => {
    const firstThinking: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'thinking-1',
      parent_tool_use_id: null,
      message: {
        stop_reason: 'tool_use',
        content: [{
          type: 'thinking',
          thinking: '先搜索登录入口。',
        }],
      },
    }
    const firstProcessText: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'process-text-1',
      parent_tool_use_id: null,
      message: {
        stop_reason: 'tool_use',
        content: [{
          type: 'text',
          text: '主源码目录确实有登录相关实现。让我并行读取核心文件。',
        }],
      },
    }
    const secondThinking: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'thinking-2',
      parent_tool_use_id: null,
      message: {
        stop_reason: 'tool_use',
        content: [{
          type: 'thinking',
          thinking: '继续检查 IPC 和 preload。',
        }],
      },
    }
    const latestProcessText: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'process-text-2',
      parent_tool_use_id: null,
      message: {
        stop_reason: 'tool_use',
        content: [{
          type: 'text',
          text: '现在看 IPC 桥接、preload 和 App 路由。',
        }],
      },
    }
    const assistantMessages = [
      firstThinking,
      firstProcessText,
      secondThinking,
      latestProcessText,
    ]
    const turn: AssistantTurn = {
      type: 'assistant-turn',
      assistantMessages,
      turnMessages: assistantMessages,
      model: 'deepseek-v4-flash',
    }

    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <AssistantTurnRenderer
          turn={turn}
          allMessages={assistantMessages}
          sessionId="process-session"
          turnId="process-turn"
          isStreaming
          isLatestAssistantTurn
          runningStartedAt={Date.now() - 4_200}
        />
      </Provider>,
    )

    // 超过约 1 秒：「已处理」常驻；过程正文固定全部露出
    expect(html).toContain('已处理')
    expect(html).toContain('现在看 IPC 桥接、preload 和 App 路由。')
    expect(html).toContain('主源码目录确实有登录相关实现')
    // 正文替换思考后，下方新增「正在思考」
    // 旧思考摘要只在新思考折叠的 prior 里（收起 DOM 仍可能存在），不作为独立表面行
    expect(html).toContain('正在思考')
    expect(html).not.toContain('已完成思考')
    // 两段过程正文 + 一行新的正在思考（prior 内的历史思考另算 data-agent-activity）
    const surfaceProcessCount = (html.match(/data-agent-activity="process-text"/g) ?? []).length
    expect(surfaceProcessCount).toBe(2)
    const firstProcess = html.indexOf('主源码目录确实有登录相关实现')
    const secondProcess = html.indexOf('现在看 IPC 桥接、preload 和 App 路由。')
    // 标题「正在思考」在过程正文之后
    const thinkingTitleIdx = html.indexOf('>正在思考<')
    expect(firstProcess).toBeGreaterThanOrEqual(0)
    expect(secondProcess).toBeGreaterThan(firstProcess)
    expect(thinkingTitleIdx).toBeGreaterThan(secondProcess)
  })

  test('Given 父流已结束但子智能体仍运行 When 渲染最新 Turn Then 只展示最新子智能体活动且不伪造已处理顶栏', () => {
    const agentTool: SDKToolUseBlock = {
      type: 'tool_use',
      id: 'agent-tool-1',
      name: 'Agent',
      input: {
        name: 'Explore',
        prompt: '检查登录流程',
      },
    }
    const blocks: SDKContentBlock[] = [
      {
        type: 'thinking',
        thinking: '先分析登录入口。',
      },
      {
        type: 'text',
        text: '我先定位登录入口，再创建子智能体。',
      },
      agentTool,
    ]
    const assistantMessage: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      parent_tool_use_id: null,
      message: {
        content: blocks,
      },
    }
    const turn: AssistantTurn = {
      type: 'assistant-turn',
      assistantMessages: [assistantMessage],
      turnMessages: [assistantMessage],
      model: 'gpt-5.6-sol',
    }
    const store = createStore()
    store.set(agentRuntimeExecutionGraphsAtom, new Map([[
      'parent-session',
      {
        runtimeSessionId: 'runtime-session',
        nodes: [{
          id: 'runtime-agent-1',
          kind: 'subagent',
          name: 'Explore',
          description: '检查登录流程',
          status: 'running',
          startedAt: Date.now() - 3_200,
          toolUseId: agentTool.id,
          transcriptAvailable: true,
          model: 'gpt-5.6-sol',
        }],
        todos: [],
        updatedAt: Date.now(),
      },
    ]]))

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <AssistantTurnRenderer
          turn={turn}
          allMessages={[assistantMessage]}
          sessionId="parent-session"
          turnId="turn-1"
          isLatestAssistantTurn
          runningStartedAt={Date.now() - 3_200}
        />
      </Provider>,
    )

    // 最终正文未开始：整轮「已处理」常驻；过程正文固定 + 最新子智能体活动
    expect(html).toContain('Explore')
    expect(html).toContain('正在运行')
    expect(html).toContain('已处理')
    expect(html).not.toContain('已完成思考')
    // 过程正文固定显示，不因工具出现而消失
    expect(html).toContain('我先定位登录入口')
    expect(html).toContain('已创建子智能体')
  })


  test('Given 流式开局尚无任何 block When 渲染超过 1 秒 Then 顶栏已处理且下方仍有正在思考', () => {
    const turn: AssistantTurn = {
      type: 'assistant-turn',
      assistantMessages: [],
      turnMessages: [],
      model: 'deepseek-v4-flash',
    }

    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <AssistantTurnRenderer
          turn={turn}
          allMessages={[]}
          sessionId="empty-stream-session"
          turnId="empty-stream-turn"
          isStreaming
          isLatestAssistantTurn
          runningStartedAt={Date.now() - 2_500}
        />
      </Provider>,
    )

    expect(html).toContain('已处理')
    expect(html).toContain('正在思考')
    expect(html).toContain('data-agent-activity="thinking"')
  })

  test('Given 正常结束且已有最终正文 When 渲染 Then 不显示已处理只显示正文', () => {
    const thinkingMsg: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'thinking-done',
      parent_tool_use_id: null,
      message: {
        content: [{
          type: 'thinking',
          thinking: '已经分析完成。',
        }],
      },
    }
    const answerMsg: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'answer-done',
      parent_tool_use_id: null,
      message: {
        content: [{
          type: 'text',
          text: '这是最终回答正文。',
        }],
      },
    }
    const result = {
      type: 'result' as const,
      subtype: 'success',
      result: '这是最终回答正文。',
      _durationMs: 12_000,
    }
    const turn: AssistantTurn = {
      type: 'assistant-turn',
      assistantMessages: [thinkingMsg, answerMsg],
      turnMessages: [thinkingMsg, answerMsg, result],
      model: 'claude-sonnet-4',
    }

    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <AssistantTurnRenderer
          turn={turn}
          allMessages={[thinkingMsg, answerMsg, result]}
          sessionId="done-session"
          turnId="done-turn"
          isLatestAssistantTurn
        />
      </Provider>,
    )

    expect(html).toContain('这是最终回答正文。')
    expect(html).not.toContain('已处理')
    expect(html).not.toContain('已经分析完成')
    expect(html).not.toContain('已完成思考')
  })

  test('Given collaboration 委派工具已返回但子会话仍运行 When 父流结束 Then 委派活动继续作为当前最新活动显示', () => {
    const delegationTool: SDKToolUseBlock = {
      type: 'tool_use',
      id: 'delegation-tool-1',
      name: 'mcp__collaboration__delegate_agents',
      input: {
        items: [{
          title: '检查登录流程',
          prompt: '检查登录流程',
        }],
      },
    }
    const assistantMessage: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-collaboration',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'thinking',
            thinking: '先分析再委派。',
          },
          delegationTool,
        ],
      },
    }
    const toolResultMessage = {
      type: 'user' as const,
      uuid: 'delegation-result',
      message: {
        content: [{
          type: 'tool_result' as const,
          tool_use_id: delegationTool.id,
          content: JSON.stringify({
            delegations: [{
              delegationId: 'delegation-1',
              childSessionId: 'child-session-1',
            }],
          }),
        }],
      },
    }
    const turn: AssistantTurn = {
      type: 'assistant-turn',
      assistantMessages: [assistantMessage],
      turnMessages: [assistantMessage, toolResultMessage],
      model: 'gpt-5.6-sol',
    }
    const store = createStore()
    store.set(agentRuntimeExecutionGraphsAtom, new Map())
    store.set(agentSessionsAtom, [{
      id: 'child-session-1',
      title: '检查登录流程',
      parentSessionId: 'parent-session',
      sourceDelegationId: 'delegation-1',
      delegationStatus: 'running',
      runtimeWorkerState: 'busy',
      createdAt: Date.now() - 4_200,
      updatedAt: Date.now(),
    }])

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <AssistantTurnRenderer
          turn={turn}
          allMessages={[assistantMessage, toolResultMessage]}
          sessionId="parent-session"
          turnId="turn-collaboration"
          isLatestAssistantTurn
          runningStartedAt={Date.now() - 4_200}
        />
      </Provider>,
    )

    // 最终正文未开始时：整轮「已处理」常驻 + 当前委派活动
    expect(html).toContain('已处理')
    expect(html).not.toContain('已完成思考')
    expect(html).toContain('检查登录流程')
    expect(html).toContain('正在运行')
    expect(html).toMatch(/正在(调用子智能体|COLLABORATION \/ delegate_agents)/)
  })


  test('Given 停止且无 assistant 内容 When 渲染 Then 只显示停止文案不显示正在思考', () => {
    const interrupted = {
      type: 'result' as const,
      subtype: 'interrupted' as const,
      usage: { input_tokens: 0, output_tokens: 0 },
      _stoppedByUser: true,
      _durationMs: 3475,
      _createdAt: Date.now(),
    }
    const turn: AssistantTurn = {
      type: 'assistant-turn',
      assistantMessages: [],
      turnMessages: [interrupted as any],
      model: 'deepseek-v4-flash',
    }

    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <AssistantTurnRenderer
          turn={turn}
          allMessages={[interrupted as any]}
          sessionId="stop-empty-session"
          turnId="stop-empty-turn"
          stoppedByUser
          isLatestAssistantTurn
          fallbackDurationMs={3475}
        />
      </Provider>,
    )

    expect(html).toContain('后停止了')
    expect(html).not.toContain('正在思考')
    expect(html).not.toContain('data-agent-activity="thinking"')
  })

  test('Given 多条过程正文后用户暂停 When 渲染 Then 旧过程正文仍在且按序显示', () => {
    const firstProcess: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'pause-process-1',
      parent_tool_use_id: null,
      message: {
        stop_reason: 'tool_use',
        content: [{ type: 'text', text: '第一段固定穿插说明。' }],
      },
    }
    const secondProcess: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'pause-process-2',
      parent_tool_use_id: null,
      message: {
        stop_reason: 'tool_use',
        content: [{ type: 'text', text: '第二段固定穿插说明。' }],
      },
    }
    const thinkingMsg: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'pause-thinking',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'thinking', thinking: '暂停前还在思考。' }],
      },
    }
    const result = {
      type: 'result' as const,
      subtype: 'interrupted',
      _durationMs: 15_000,
      _stoppedByUser: true,
    }
    const assistantMessages = [firstProcess, secondProcess, thinkingMsg]
    const turn: AssistantTurn = {
      type: 'assistant-turn',
      assistantMessages,
      turnMessages: [...assistantMessages, result],
      model: 'claude-sonnet-4',
    }

    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <AssistantTurnRenderer
          turn={turn}
          allMessages={[...assistantMessages, result]}
          sessionId="pause-process-session"
          turnId="pause-process-turn"
          stoppedByUser
          isLatestAssistantTurn
        />
      </Provider>,
    )

    expect(html).toContain('你在')
    expect(html).toContain('后停止了')
    // 暂停后两段过程正文都还在，不能被藏掉
    expect(html).toContain('第一段固定穿插说明')
    expect(html).toContain('第二段固定穿插说明')
    const firstIdx = html.indexOf('第一段固定穿插说明')
    const secondIdx = html.indexOf('第二段固定穿插说明')
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(secondIdx).toBeGreaterThan(firstIdx)
    // 两条过程正文 + 停止后的思考阶段行
    expect(html.match(/data-agent-activity=/g)?.length).toBe(3)
  })

  test('Given 用户停止且已有思考与工具 When 渲染 Then 显示停止文案且默认只露最新一行', () => {
    const thinkingMsg: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'stop-thinking',
      parent_tool_use_id: null,
      message: {
        content: [{
          type: 'thinking',
          thinking: '先搜索再读取。',
        }],
      },
    }
    const toolMsg: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'stop-tool',
      parent_tool_use_id: null,
      message: {
        content: [{
          type: 'tool_use',
          id: 'bash-stop-1',
          name: 'Bash',
          input: { command: 'ls' },
        }],
      },
    }
    const processMsg: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'stop-process',
      parent_tool_use_id: null,
      message: {
        stop_reason: 'tool_use',
        content: [{
          type: 'text',
          text: '已创建探索子智能体，正在等待结果。',
        }],
      },
    }
    const result = {
      type: 'result' as const,
      subtype: 'interrupted',
      _durationMs: 27_000,
      _stoppedByUser: true,
    }
    const assistantMessages = [thinkingMsg, toolMsg, processMsg]
    const turn: AssistantTurn = {
      type: 'assistant-turn',
      assistantMessages,
      turnMessages: [...assistantMessages, result],
      model: 'claude-sonnet-4',
    }

    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <AssistantTurnRenderer
          turn={turn}
          allMessages={[...assistantMessages, result]}
          sessionId="stop-session"
          turnId="stop-turn"
          stoppedByUser
          isLatestAssistantTurn
        />
      </Provider>,
    )

    expect(html).toContain('你在')
    expect(html).toContain('后停止了')
    // 收起态只露最新一行（过程叙述是最后一条活动）
    expect(html).toContain('已创建探索子智能体')
    // 旧思考/工具不堆叠显示
    expect(html).not.toContain('先搜索再读取')
    expect(html).not.toContain('已完成思考')
  })
})
