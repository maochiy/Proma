import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentWorkspace } from '@proma/shared'
import { AgentProjectPicker } from './AgentProjectPicker'

const WORKSPACE: AgentWorkspace = {
  id: 'project-a',
  name: 'Proma',
  slug: 'proma',
  path: '/projects/proma',
  canonicalPath: '/projects/proma',
  createdAt: 1,
  updatedAt: 1,
}

describe('AgentProjectPicker 输入区项目入口', () => {
  test('Given 项目入口显示在输入框上方 When 渲染入口 Then 左边缘与输入框精确对齐', () => {
    const html = renderToStaticMarkup(
      <AgentProjectPicker
        workspaces={[WORKSPACE]}
        workspaceId={WORKSPACE.id}
        onSelect={() => undefined}
        onAdd={async () => true}
      />,
    )

    expect(html).toContain('class="flex min-w-0 items-center"')
    expect(html).not.toContain('px-0.5')
  })
})
