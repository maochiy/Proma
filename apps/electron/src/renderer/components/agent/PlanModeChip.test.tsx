import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlanModeChip } from './PlanModeChip'

describe('PlanModeChip 独立计划模式入口', () => {
  test('Given 计划模式已启用 When 渲染输入区工具栏 Then 显示计划且可独立关闭', () => {
    const html = renderToStaticMarkup(<PlanModeChip onClose={() => undefined} />)

    expect(html).toContain('计划')
    expect(html).toContain('aria-label="关闭计划模式"')
  })

  test('Given 鼠标未移入 When 显示计划 Chip Then 灯泡与关闭图标共用位置避免布局抖动', () => {
    const html = renderToStaticMarkup(<PlanModeChip onClose={() => undefined} />)

    expect(html).toContain('relative size-3.5')
    expect(html).toContain('group-hover:opacity-0')
    expect(html).toContain('group-hover:opacity-100')
  })
})
