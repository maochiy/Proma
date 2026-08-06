import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import {
  backfillMissingToolUsesForUserMessage,
  collectKnownToolUseIds,
  inferToolUseFromResult,
} from './tool-use-backfill'

function toolResultMessage(
  toolUseId: string,
  content: string,
): SDKMessage {
  return {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
    },
  } as SDKMessage
}

describe('tool-use-backfill', () => {
  test('Given Glob 文本结果 When 推断 Then 投影为 Glob', () => {
    expect(inferToolUseFromResult('call-1', {
      contentText: 'Found 40 files limit: 40\nlib/a.dart\nlib/b.dart',
    })).toMatchObject({
      type: 'tool_use',
      id: 'call-1',
      name: 'Glob',
    })
  })

  test('Given ls 文本结果 When 推断 Then 投影为 Bash', () => {
    expect(inferToolUseFromResult('call-2', {
      contentText: 'total 4936\ndrwxr-xr-x  54 qianmeng  staff  1836 Aug  5 16:38 .',
    })).toMatchObject({
      id: 'call-2',
      name: 'Bash',
    })
  })

  test('Given 带行号源码 When 推断 Then 投影为 Read', () => {
    expect(inferToolUseFromResult('call-3', {
      contentText: "1\timport 'package:flutter/material.dart';\n2\t",
    })).toMatchObject({
      id: 'call-3',
      name: 'Read',
    })
  })

  test('Given tool_result 缺失 tool_use When 回填 Then 在结果前合成 assistant(tool_use)', () => {
    const known = new Set<string>()
    const user = toolResultMessage(
      'call_ddc66609548642318b0e2ba7',
      'Found 40 files limit: 40\nlib/core/network/api_client.dart',
    )
    const backfilled = backfillMissingToolUsesForUserMessage(user, known)

    expect(backfilled).toHaveLength(1)
    expect(backfilled[0]).toMatchObject({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'call_ddc66609548642318b0e2ba7',
          name: 'Glob',
        }],
      },
      _syntheticToolUse: true,
    })
    expect(known.has('call_ddc66609548642318b0e2ba7')).toBe(true)
  })

  test('Given tool_use 已存在 When 回填 Then 不重复合成', () => {
    const known = collectKnownToolUseIds([
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [{
            type: 'tool_use',
            id: 'call-existing',
            name: 'Read',
            input: {},
          }],
        },
      } as SDKMessage,
    ])
    const user = toolResultMessage('call-existing', "1\tprint('hi')")
    expect(backfillMissingToolUsesForUserMessage(user, known)).toEqual([])
  })

  test('Given 会话 7bc5d165 模式：多 tool_result 无 tool_use When 批量回填 Then 每个 id 各补一条', () => {
    const known = new Set<string>()
    const ids = [
      'call_ddc66609548642318b0e2ba7',
      'call_9cc503b3500b46d1b6976aa6',
      'call_53af6a1f325a4108a75624d0',
    ]
    const synthesized = ids.flatMap((id, index) => {
      const content = index === 1
        ? 'total 10\ndrwxr-xr-x  3 user staff 96 .'
        : index === 0
          ? 'Found 2 files\na.dart\nb.dart'
          : 'lib/a.dart\nlib/b.dart'
      return backfillMissingToolUsesForUserMessage(
        toolResultMessage(id, content),
        known,
      )
    })

    expect(synthesized).toHaveLength(3)
    expect(synthesized.map((message) => {
      const content = (message as {
        message?: { content?: Array<{ id?: string; name?: string }> }
      }).message?.content?.[0]
      return { id: content?.id, name: content?.name }
    })).toEqual([
      { id: ids[0], name: 'Glob' },
      { id: ids[1], name: 'Bash' },
      { id: ids[2], name: 'Glob' },
    ])
  })
})
