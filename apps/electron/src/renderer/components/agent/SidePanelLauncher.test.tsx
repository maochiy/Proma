import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidePanelLauncher } from './SidePanel'

describe('SidePanelLauncher 右侧功能区启动页', () => {
  test('Given 用户手动打开右侧功能区 When 渲染启动页 Then 显示文件功能与交互终端入口', () => {
    const html = renderToStaticMarkup(
      <SidePanelLauncher onOpenTab={() => undefined} />,
    )

    expect(html).toContain('items-center justify-center')
    expect(html).toContain('会话文件')
    expect(html).toContain('工作区文件')
    expect(html).toContain('文件改动')
    expect(html).toContain('在当前会话目录打开交互式 Shell')
    expect(html).not.toContain('>执行<')
    expect(html).not.toContain('>问答<')
    expect(html).not.toContain('border')
  })
})
