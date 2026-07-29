import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ExitPlanModeRequest } from '@proma/shared'
import { allPendingExitPlanRequestsAtom } from '@/atoms/agent-atoms'
import { ExitPlanModeBanner } from './ExitPlanModeBanner'

const SESSION_ID = 'plan-panel-test'

function renderExitPlanModeBanner(): string {
  const request: ExitPlanModeRequest = {
    requestId: 'plan-request-1',
    sessionId: SESSION_ID,
    toolInput: {},
    allowedPrompts: [
      { tool: 'Bash', prompt: '运行项目测试' },
    ],
  }
  const store = createStore()
  store.set(allPendingExitPlanRequestsAtom, new Map([[SESSION_ID, [request]]]))

  return renderToStaticMarkup(
    <Provider store={store}>
      <ExitPlanModeBanner sessionId={SESSION_ID} />
    </Provider>,
  )
}

describe('ExitPlanModeBanner 计划审批面板', () => {
  test('使用与权限审批相同的输入框卡片尺寸', () => {
    const html = renderExitPlanModeBanner()

    expect(html).toContain('w-full')
    expect(html).toContain('rounded-[20px]')
    expect(html).not.toContain('mx-4')
  })

  test('三个计划操作使用纵向审批列表样式', () => {
    const html = renderExitPlanModeBanner()
    const approveIndex = html.indexOf('批准并完全自动执行')
    const denyIndex = html.indexOf('拒绝计划')
    const feedbackIndex = html.indexOf('提供修改意见')

    expect(approveIndex).toBeGreaterThan(-1)
    expect(denyIndex).toBeGreaterThan(approveIndex)
    expect(feedbackIndex).toBeGreaterThan(denyIndex)
    expect(html).toContain('flex flex-col gap-1')
    expect(html).toContain('rounded-xl px-3 py-2.5')
  })

  test('关闭面板表示拒绝计划而不是终止 Agent', () => {
    const html = renderExitPlanModeBanner()

    expect(html).toContain('title="拒绝当前计划"')
    expect(html).not.toContain('关闭并终止 Agent')
  })
})
