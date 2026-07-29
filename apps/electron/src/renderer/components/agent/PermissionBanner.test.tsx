import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PermissionRequest } from '@proma/shared'
import { allPendingPermissionRequestsAtom } from '@/atoms/agent-atoms'
import { PermissionBanner } from './PermissionBanner'

const SESSION_ID = 'permission-panel-test'

function renderPermissionBanner(): string {
  const request: PermissionRequest = {
    requestId: 'request-1',
    sessionId: SESSION_ID,
    toolName: 'Bash',
    toolInput: { command: 'rm -f proma-approval-test.txt' },
    description: '执行删除命令',
    command: 'rm -f proma-approval-test.txt',
    dangerLevel: 'dangerous',
  }
  const store = createStore()
  store.set(allPendingPermissionRequestsAtom, new Map([[SESSION_ID, [request]]]))

  return renderToStaticMarkup(
    <Provider store={store}>
      <PermissionBanner sessionId={SESSION_ID} />
    </Provider>,
  )
}

describe('PermissionBanner 审批面板', () => {
  test('宽度跟随输入区域且整体高度不固定', () => {
    const html = renderPermissionBanner()

    expect(html).toContain('w-full')
    expect(html).toContain('rounded-[20px]')
    expect(html).not.toContain('mx-4')
    expect(html).not.toContain('h-[120px]')
  })

  test('审批操作按允许、始终允许、拒绝纵向呈现', () => {
    const html = renderPermissionBanner()
    const allowIndex = html.indexOf('仅允许执行本次操作')
    const alwaysAllowIndex = html.indexOf('本次会话总是允许')
    const denyIndex = html.indexOf('拒绝本次操作')

    expect(allowIndex).toBeGreaterThan(-1)
    expect(alwaysAllowIndex).toBeGreaterThan(allowIndex)
    expect(denyIndex).toBeGreaterThan(alwaysAllowIndex)
    expect(html).toContain('flex flex-col gap-1')
  })

  test('关闭面板表示拒绝当前操作而不是终止 Agent', () => {
    const html = renderPermissionBanner()

    expect(html).toContain('title="拒绝当前操作"')
    expect(html).not.toContain('关闭并终止 Agent')
  })
})
