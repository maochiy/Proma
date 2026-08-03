import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildAssistantTurnRenderItems, buildProcessGroupToolNames, projectOrphanThinkingAsText } from './ProcessBlockGroup'
import { ProcessBlockGroup } from './ProcessBlockGroup'
import type { SDKContentBlock } from '@proma/shared'

const tool = (id: string, name = 'Read'): SDKContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input: {},
})

const thinking = (text = '分析中'): SDKContentBlock => ({
  type: 'thinking',
  thinking: text,
})

const text = (value: string): SDKContentBlock => ({
  type: 'text',
  text: value,
})

describe('Agent 过程块折叠分组', () => {
  test('given continuous thinking and tools before final text when grouping then folds them into one process group', () => {
    const items = buildAssistantTurnRenderItems([
      thinking(),
      tool('tool-1'),
      tool('tool-2'),
      text('最终输出'),
    ])

    expect(items).toHaveLength(2)
    expect(items[0]?.type).toBe('process-group')
    expect(items[1]?.type).toBe('block')
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0, 1, 2])
    }
  })

  test('given intermediate text between tool runs when grouping then keeps only final output outside process group', () => {
    const items = buildAssistantTurnRenderItems([
      tool('tool-1'),
      text('中间说明'),
      tool('tool-2'),
      text('最终输出'),
    ])

    expect(items.map((item) => item.type)).toEqual(['process-group', 'block'])
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0, 1, 2])
    }
    if (items[1]?.type === 'block') {
      expect(items[1].item.index).toBe(3)
    }
  })

  test('given streaming turn with trailing text when grouping then keeps the whole turn inside process group', () => {
    const items = buildAssistantTurnRenderItems([
      tool('tool-1'),
      text('可能还是中间说明'),
    ], { isStreaming: true })

    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe('process-group')
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0, 1])
    }
  })

  test('given streaming turn with completed tools before trailing text when grouping then keeps final output outside process group', () => {
    const items = buildAssistantTurnRenderItems([
      tool('tool-1'),
      text('最终输出'),
    ], { isStreaming: true, completedToolResultIds: new Set(['tool-1']) })

    expect(items.map((item) => item.type)).toEqual(['process-group', 'block'])
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0])
    }
    if (items[1]?.type === 'block') {
      expect(items[1].item.index).toBe(1)
    }
  })

  test('given completed turn when grouping then keeps final output outside process group', () => {
    const items = buildAssistantTurnRenderItems([
      tool('tool-1'),
      text('最终输出'),
    ])

    expect(items.map((item) => item.type)).toEqual(['process-group', 'block'])
    expect(items[0]?.type).toBe('process-group')
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0])
    }
  })

  test('given pure text streaming turn when grouping then keeps text as normal output', () => {
    const items = buildAssistantTurnRenderItems([
      text('普通回答'),
    ], { isStreaming: true })

    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe('block')
  })

  test('given process only turn when grouping then keeps the whole turn expanded after completion', () => {
    const items = buildAssistantTurnRenderItems([
      thinking(),
      tool('tool-1'),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe('process-group')
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0, 1])
    }
  })

  test('given trailing blank text when grouping then does not treat it as visible final output', () => {
    const items = buildAssistantTurnRenderItems([
      thinking(),
      tool('tool-1'),
      text('   '),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe('process-group')
  })

  test('given completed process-only group when rendering history then keeps details visible', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ProcessBlockGroup,
        {
          blocks: [thinking(), tool('tool-1')],
          isMessageTail: true,
          children: React.createElement('span', null, '过程详情'),
        },
      ),
    )

    expect(html).toContain('过程详情')
  })

  test('given completed process group with final output when rendering history then starts collapsed', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ProcessBlockGroup,
        {
          blocks: [thinking(), tool('tool-1')],
          isMessageTail: false,
          children: React.createElement('span', null, '过程详情'),
        },
      ),
    )

    expect(html).not.toContain('过程详情')
  })

  test('given streaming turn with only thinking before trailing text when grouping then keeps the whole turn inside process group', () => {
    // 仅有 thinking + 尾部 text 时，工具调用可能稍后才出现，
    // 不应把这段尾部 text 提前外置——避免后续完成瞬间从外部又跳回过程组。
    const items = buildAssistantTurnRenderItems([
      thinking(),
      text('暂时的回答片段'),
    ], { isStreaming: true, completedToolResultIds: new Set() })

    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe('process-group')
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0, 1])
    }
  })

  test('given repeated tools when building capability icons then returns unique tool names in order', () => {
    const toolNames = buildProcessGroupToolNames([
      tool('tool-1', 'Grep'),
      thinking(),
      tool('tool-2', 'Read'),
      tool('tool-3', 'Grep'),
      tool('tool-4', 'Bash'),
    ])

    expect(toolNames).toEqual(['Grep', 'Read', 'Bash'])
  })

  test('given completed turn with only thinking when projecting then promotes last thinking to visible text', () => {
    const blocks = projectOrphanThinkingAsText([
      thinking('中间推理'),
      tool('tool-1'),
      thinking('最终答复：根因是 duplicate event_id'),
    ])

    expect(blocks.map((block) => block.type)).toEqual(['thinking', 'tool_use', 'text'])
    expect(blocks[2]).toEqual({
      type: 'text',
      text: '最终答复：根因是 duplicate event_id',
    })

    const items = buildAssistantTurnRenderItems(blocks)
    expect(items.map((item) => item.type)).toEqual(['process-group', 'block'])
    if (items[1]?.type === 'block') {
      expect(items[1].item.block).toEqual({
        type: 'text',
        text: '最终答复：根因是 duplicate event_id',
      })
    }
  })

  test('given streaming thinking-only turn when projecting then keeps thinking untouched', () => {
    const blocks = projectOrphanThinkingAsText([
      thinking('还在推理中的最终答复草稿'),
    ], { isStreaming: true })

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('thinking')
  })

  test('given turn already has text when projecting then does not promote thinking', () => {
    const blocks = projectOrphanThinkingAsText([
      thinking('过程'),
      text('正常最终输出'),
    ])

    expect(blocks.map((block) => block.type)).toEqual(['thinking', 'text'])
  })

  test('given pure thinking turn when projecting then promotes only the last thinking', () => {
    const blocks = projectOrphanThinkingAsText([
      thinking('第一步'),
      thinking('第二步最终答案'),
    ])

    expect(blocks.map((block) => block.type)).toEqual(['thinking', 'text'])
    expect(blocks[1]).toEqual({ type: 'text', text: '第二步最终答案' })
  })
})
