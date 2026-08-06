import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import {
  annotateCcbFinalAssistantMessage,
  applyCcbPartialAssistantEvent,
  createCcbPartialAssistantState,
  finalizeCcbPartialAssistantMessage,
} from './ccb-partial-assistant'

function streamEvent(event: Record<string, unknown>): SDKMessage {
  return {
    type: 'stream_event',
    event,
    session_id: 'desktop-session',
    parent_tool_use_id: null,
  }
}

describe('CCB 思考过程增量快照', () => {
  test('Given thinking block 已开始 When 收到首个 thinking_delta Then 立即生成可渲染快照', () => {
    let state = createCcbPartialAssistantState()
    state = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'message_start',
      message: { id: 'msg-1', model: 'grok-4.5' },
    })).state
    state = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    })).state

    const update = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: '先分析问题' },
    }))

    expect(update.message).toMatchObject({
      type: 'assistant',
      uuid: 'ccb-partial:msg-1:0',
      _partial: true,
      message: {
        id: 'msg-1',
        model: 'grok-4.5',
        content: [{ type: 'thinking', thinking: '先分析问题' }],
      },
    })
  })

  test('Given 已显示首段思考 When 收到后续 delta Then 使用同一 UUID 返回累计内容', () => {
    let state = createCcbPartialAssistantState()
    for (const event of [
      { type: 'message_start', message: { id: 'msg-2', model: 'grok-4.5' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '第一段' } },
    ]) {
      state = applyCcbPartialAssistantEvent(state, streamEvent(event)).state
    }

    const update = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: '，第二段' },
    }))

    expect(update.message).toMatchObject({
      uuid: 'ccb-partial:msg-2:0',
      message: {
        content: [{ type: 'thinking', thinking: '第一段，第二段' }],
      },
    })
  })

  test('Given text block 正在生成 When 收到 text_delta Then 同样生成文本增量快照', () => {
    let state = createCcbPartialAssistantState()
    for (const event of [
      { type: 'message_start', message: { id: 'msg-3', model: 'grok-4.5' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    ]) {
      state = applyCcbPartialAssistantEvent(state, streamEvent(event)).state
    }

    const update = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: '正在回答' },
    }))

    expect(update.message).toMatchObject({
      uuid: 'ccb-partial:msg-3:1',
      message: {
        content: [{ type: 'text', text: '正在回答' }],
      },
    })
  })

  test('Given CCB 错误地为正文重开空 thinking block When 收到 text_delta Then 按文本块继续渲染', () => {
    let state = createCcbPartialAssistantState()
    for (const event of [
      { type: 'message_start', message: { id: 'msg-deepseek', model: 'deepseek-v4-flash' } },
      { type: 'content_block_start', index: 2, content_block: { type: 'thinking', thinking: '', signature: '' } },
    ]) {
      state = applyCcbPartialAssistantEvent(state, streamEvent(event)).state
    }

    const update = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'text_delta', text: '正文继续输出' },
    }))

    expect(update.message).toMatchObject({
      uuid: 'ccb-partial:msg-deepseek:2',
      message: {
        content: [{ type: 'text', text: '正文继续输出' }],
      },
    })
  })

  test('Given 空 thinking block When 仅收到空 text_delta 后继续 thinking_delta Then 保持思考块类型', () => {
    let state = createCcbPartialAssistantState()
    for (const event of [
      { type: 'message_start', message: { id: 'msg-empty-text', model: 'deepseek-v4-flash' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '' } },
    ]) {
      state = applyCcbPartialAssistantEvent(state, streamEvent(event)).state
    }

    const update = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: '继续思考' },
    }))

    expect(update.message).toMatchObject({
      message: {
        content: [{ type: 'thinking', thinking: '继续思考' }],
      },
    })
  })

  test('Given Provider 省略 content_block_start When 直接收到 thinking_delta Then 仍生成思考快照', () => {
    let state = createCcbPartialAssistantState()
    state = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'message_start',
      message: { id: 'msg-4', model: 'grok-4.5' },
    })).state

    const update = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: '直接开始思考' },
    }))

    expect(update.message).toMatchObject({
      uuid: 'ccb-partial:msg-4:0',
      message: {
        content: [{ type: 'thinking', thinking: '直接开始思考' }],
      },
    })
  })

  test('Given 子代理产生思考 When 生成增量快照 Then 保留 parent_tool_use_id', () => {
    let state = createCcbPartialAssistantState()
    state = applyCcbPartialAssistantEvent(state, {
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: { id: 'msg-child', model: 'grok-4.5' },
      },
      session_id: 'desktop-session',
      parent_tool_use_id: 'tool-parent',
    }).state

    const update = applyCcbPartialAssistantEvent(state, {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: '子代理分析' },
      },
      session_id: 'desktop-session',
      parent_tool_use_id: 'tool-parent',
    })

    expect(update.message).toMatchObject({
      parent_tool_use_id: 'tool-parent',
      message: {
        content: [{ type: 'thinking', thinking: '子代理分析' }],
      },
    })
  })

  test('Given thinking block 已结束 When message_stop 后最终消息到达 Then 保留映射并标注内容块索引', () => {
    let state = createCcbPartialAssistantState()
    for (const event of [
      { type: 'message_start', message: { id: 'msg-final', model: 'grok-4.5' } },
      { type: 'content_block_start', index: 2, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'thinking_delta', thinking: '完整思考' } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_stop' },
    ]) {
      state = applyCcbPartialAssistantEvent(state, streamEvent(event)).state
    }

    const update = annotateCcbFinalAssistantMessage(state, assistantFinal(
      'runtime-final',
      'msg-final',
      { type: 'thinking', thinking: '完整思考' },
    ))

    expect(update.message).toMatchObject({
      uuid: 'runtime-final',
      _partialBlockIndex: 2,
    })
    expect(update.state.blocks.size).toBe(0)
  })

  test('Given 同一模型消息有两个同类型块 When 终态分片依次到达 Then 按内容和剩余索引精确标注', () => {
    let state = createCcbPartialAssistantState()
    for (const event of [
      { type: 'message_start', message: { id: 'msg-multi', model: 'grok-4.5' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '第一段' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_delta', index: 2, delta: { type: 'thinking_delta', thinking: '第二段' } },
      { type: 'content_block_stop', index: 2 },
    ]) {
      state = applyCcbPartialAssistantEvent(state, streamEvent(event)).state
    }

    const first = annotateCcbFinalAssistantMessage(state, assistantFinal(
      'runtime-final-1',
      'msg-multi',
      { type: 'thinking', thinking: '第一段' },
    ))
    const second = annotateCcbFinalAssistantMessage(first.state, assistantFinal(
      'runtime-final-2',
      'msg-multi',
      { type: 'thinking', thinking: '第二段' },
    ))

    expect(first.message).toMatchObject({ _partialBlockIndex: 0 })
    expect(second.message).toMatchObject({ _partialBlockIndex: 2 })
  })

  test('Given 用户中断且仍有未完成正文 When Turn 结束固化 Then 过程正文按序保留可落盘', () => {
    // 复现暂停丢正文场景：两条过程正文仍在 partial 中，CCB 不再补发最终消息
    let state = createCcbPartialAssistantState()
    for (const event of [
      { type: 'message_start', message: { id: 'msg-stop', model: 'deepseek-v4-flash' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '我来直接探索代码库分析登录流程。' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '登录逻辑集中在 lib/features/auth/。' } },
      // 注意：index 1 未收到 content_block_stop（暂停瞬间仍在流式输出）
    ]) {
      state = applyCcbPartialAssistantEvent(state, streamEvent(event)).state
    }

    const update = finalizeCcbPartialAssistantMessage(state)

    expect(update.message).toBeDefined()
    expect(update.message).toMatchObject({
      type: 'assistant',
      uuid: 'ccb-finalized:msg-stop',
    })
    // 不带 _partial：编排器必须把它当最终消息落盘
    expect((update.message as Record<string, unknown>)?._partial).toBeUndefined()
    const content = (update.message as { message?: { content?: Array<Record<string, unknown>> } })
      ?.message?.content ?? []
    expect(content).toEqual([
      { type: 'text', text: '我来直接探索代码库分析登录流程。' },
      { type: 'text', text: '登录逻辑集中在 lib/features/auth/。' },
    ])
    // 固化后清空，避免重复推送
    expect(update.state.blocks.size).toBe(0)
  })


  test('Given 过程正文仍在 partial When 下一条 message_start 到达 Then 先固化旧正文再重置', () => {
    // 复现 deepseek 拆消息：正文流式后直接开 tool_use 新消息，旧正文不得蒸发
    let state = createCcbPartialAssistantState()
    state = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'message_start',
      message: { id: 'msg-text', model: 'deepseek-v4-flash' },
    })).state
    state = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: '我来直接分析登录流程的代码。先看看项目结构' },
    })).state

    const update = applyCcbPartialAssistantEvent(state, streamEvent({
      type: 'message_start',
      message: { id: 'msg-tool', model: 'deepseek-v4-flash' },
    }))

    expect(update.message).toBeDefined()
    expect((update.message as Record<string, unknown>)?._partial).toBeUndefined()
    expect(update.message).toMatchObject({
      type: 'assistant',
      uuid: 'ccb-finalized:msg-text',
    })
    const content = (update.message as { message?: { content?: Array<Record<string, unknown>> } })
      ?.message?.content ?? []
    expect(content).toEqual([
      { type: 'text', text: '我来直接分析登录流程的代码。先看看项目结构' },
    ])
    // 新消息状态已重置，旧 blocks 不残留
    expect(update.state.messageId).toBe('msg-tool')
    expect(update.state.blocks.size).toBe(0)
  })

  test('Given 无 messageId 或无可见内容 When Turn 结束固化 Then 不伪造消息', () => {
    // 空状态（暂停时模型还没产出任何内容）
    expect(finalizeCcbPartialAssistantMessage(createCcbPartialAssistantState()).message)
      .toBeUndefined()

    // 只有空 thinking block（无可见内容）
    let state = createCcbPartialAssistantState()
    for (const event of [
      { type: 'message_start', message: { id: 'msg-empty', model: 'deepseek-v4-flash' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    ]) {
      state = applyCcbPartialAssistantEvent(state, streamEvent(event)).state
    }
    expect(finalizeCcbPartialAssistantMessage(state).message).toBeUndefined()
  })

  test('Given tool_use 流式块 When 增量输入 JSON Then 生成可渲染的工具快照', () => {
    let state = createCcbPartialAssistantState()
    let message: SDKMessage | undefined
    for (const event of [
      { type: 'message_start', message: { id: 'msg-tool', model: 'deepseek-v4-flash' } },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'call_read_1', name: 'Read', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"file_path":"' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '/tmp/a.dart"}' },
      },
    ]) {
      const update = applyCcbPartialAssistantEvent(state, streamEvent(event))
      state = update.state
      if (update.message) message = update.message
    }

    expect(message).toMatchObject({
      type: 'assistant',
      _partial: true,
      message: {
        content: [{
          type: 'tool_use',
          id: 'call_read_1',
          name: 'Read',
          input: { file_path: '/tmp/a.dart' },
        }],
      },
    })
    // 内部累积字段不应泄漏到消息 content
    expect((message as any).message.content[0]._inputJson).toBeUndefined()
  })

  test('Given tool_use 仍在 partial When Turn 结束固化 Then 保留工具调用块', () => {
    let state = createCcbPartialAssistantState()
    for (const event of [
      { type: 'message_start', message: { id: 'msg-tool-stop', model: 'deepseek-v4-flash' } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'call_glob_1', name: 'Glob', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"pattern":"**/*.dart"}' },
      },
    ]) {
      state = applyCcbPartialAssistantEvent(state, streamEvent(event)).state
    }

    const update = finalizeCcbPartialAssistantMessage(state)
    expect(update.message).toMatchObject({
      type: 'assistant',
      message: {
        id: 'msg-tool-stop',
        content: [{
          type: 'tool_use',
          id: 'call_glob_1',
          name: 'Glob',
          input: { pattern: '**/*.dart' },
        }],
      },
    })
  })
})

function assistantFinal(
  uuid: string,
  messageId: string,
  block: Record<string, unknown>,
): SDKMessage {
  return {
    type: 'assistant',
    uuid,
    parent_tool_use_id: null,
    message: {
      id: messageId,
      content: [block],
    },
  } as SDKMessage
}
