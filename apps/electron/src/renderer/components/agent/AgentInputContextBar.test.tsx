import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentInputContextBar } from './AgentInputContextBar'

function renderContextBar(): string {
  return renderToStaticMarkup(
    <AgentInputContextBar
      projectPicker={<button type="button">当前项目</button>}
      planProgress={<button type="button">第 3 / 6 步</button>}
    />,
  )
}

describe('AgentInputContextBar 输入区上下文栏', () => {
  test('Given 项目入口与计划入口同时显示 When 渲染上下文栏 Then 二者位于同一行且计划相对输入框居中', () => {
    const html = renderContextBar()

    expect(html).toContain('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]')
    expect(html).toContain('items-end')
    expect(html).toContain('justify-self-start')
    expect(html).toContain('justify-self-center')
    expect(html).toContain('当前项目')
    expect(html).toContain('第 3 / 6 步')
    expect(html).not.toContain('flex-col')
  })

  test('Given 计划入口暂时不存在 When 渲染上下文栏 Then 仍保留项目入口与输入框之间的稳定间距', () => {
    const html = renderToStaticMarkup(
      <AgentInputContextBar
        projectPicker={<button type="button">当前项目</button>}
        planProgress={null}
      />,
    )

    expect(html).toContain('mb-2')
    expect(html).toContain('min-h-9')
    expect(html).toContain('当前项目')
  })
})
