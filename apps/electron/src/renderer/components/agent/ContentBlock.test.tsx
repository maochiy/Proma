import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  SDKMessage,
  SDKToolUseBlock,
} from '@proma/shared'
import { ContentBlock } from './ContentBlock'

describe('ContentBlock Collaboration 结果摘要', () => {
  test('Given list_delegations 返回完整委派数据 When 渲染正文 Then 只显示一句状态摘要', () => {
    const block: SDKToolUseBlock = {
      type: 'tool_use',
      id: 'list-delegations',
      name: 'mcp__collaboration__list_delegations',
      input: {},
    }
    const messages: SDKMessage[] = [{
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({
            maxRunningDelegations: 50,
            runningCount: 1,
            delegations: [
              {
                title: '节点一',
                status: 'completed',
                goal: '不应显示的完整任务说明',
                resultSummary: '不应显示的完整执行结果',
              },
              {
                title: '节点二',
                status: 'running',
              },
            ],
          }),
        }],
      },
    }]

    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <ContentBlock
          block={block}
          allMessages={messages}
          sessionId="parent-session"
        />
      </Provider>,
    )

    expect(html).toContain('共 2 个委派：1 个已完成，1 个执行中')
    expect(html).not.toContain('不应显示的完整任务说明')
    expect(html).not.toContain('不应显示的完整执行结果')
  })

  test('Given 并行批次中的兄弟工具先失败 When 当前工具收到级联取消 Then 显示已取消而非真实执行错误', () => {
    const block: SDKToolUseBlock = {
      type: 'tool_use',
      id: 'cancelled-bash',
      name: 'Bash',
      input: {
        command: 'adb shell run-as com.zmn.expert.android ...',
        description: '检查绑定账户状态',
      },
    }
    const messages: SDKMessage[] = [{
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: block.id,
          content: '<tool_use_error>Cancelled: parallel tool call Bash(adb devices -l …) errored</tool_use_error>',
          is_error: true,
        }],
      },
    }]

    const html = renderToStaticMarkup(
      <Provider store={createStore()}>
        <ContentBlock
          block={block}
          allMessages={messages}
        />
      </Provider>,
    )

    expect(html).toContain('已取消')
    expect(html).toContain('text-muted-foreground/45')
    expect(html).not.toContain('text-destructive/70')
  })
})
