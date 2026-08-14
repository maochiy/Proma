import { describe, expect, test } from 'bun:test'
import {
  clickBrowserElement,
  readBrowserPage,
  typeBrowserElement,
} from './browser-page-reader'
import type { BrowserReadableElement } from './browser-page-reader'

interface FakeFrame {
  name: string
  url: string
  origin: string
  parent: FakeFrame | null
  isDestroyed(): boolean
  executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
}

describe('内置浏览器页面读取器', () => {
  test('Given 主页面和跨域 iframe When 读取 Then 合并正文并生成 frame 级元素引用', async () => {
    const main: FakeFrame = {
      name: '',
      url: 'https://example.com',
      origin: 'https://example.com',
      parent: null,
      isDestroyed: () => false,
      executeJavaScript: async () => ({
        title: '示例',
        text: '主页面内容',
        elements: [{ ref: 'f0e1', role: 'link', name: '帮助', tag: 'a' }],
      }),
    }
    const child: FakeFrame = {
      name: 'login',
      url: 'https://identity.example.com',
      origin: 'https://identity.example.com',
      parent: main,
      isDestroyed: () => false,
      executeJavaScript: async () => ({
        title: '',
        text: '登录表单',
        elements: [{ ref: 'f1e1', role: 'textbox', name: '账号', tag: 'input', editable: true }],
      }),
    }
    const contents = {
      getURL: () => 'https://example.com',
      getTitle: () => '示例',
      mainFrame: { framesInSubtree: [main, child] },
    }

    const result = await readBrowserPage(contents as never)

    expect(result.snapshot.text).toBe('主页面内容\n登录表单')
    expect(result.snapshot.elements.map((element) => element.ref)).toEqual(['f0e1', 'f1e1'])
    expect(result.elementFrames.get('f1e1')?.url).toBe(child.url)
    expect(result.snapshot.frames[1]).toMatchObject({
      frameUrl: 'https://identity.example.com',
      isMainFrame: false,
      elementCount: 1,
    })
    expect(result.snapshot.frames[1]).not.toHaveProperty('elements')
  })

  test('Given 普通元素没有 tabindex When 生成读取脚本 Then 不把缺失属性按 tabindex=0 处理', async () => {
    let script = ''
    const frame: FakeFrame = {
      name: '',
      url: 'https://example.com',
      origin: 'https://example.com',
      parent: null,
      isDestroyed: () => false,
      executeJavaScript: async (value) => {
        script = value
        return { title: '示例', text: '', elements: [] }
      },
    }
    const contents = {
      getURL: () => frame.url,
      getTitle: () => '示例',
      mainFrame: { framesInSubtree: [frame] },
    }

    await readBrowserPage(contents as never)

    expect(script).toContain("element.hasAttribute('tabindex')")
    expect(script).not.toContain("const tabIndex = Number(element.getAttribute('tabindex'));\n      if (Number.isFinite")
  })

  test('Given 页面包含大量交互元素 When 读取 Then 对模型输出保留固定数量且 frame 不重复携带元素', async () => {
    const elements: BrowserReadableElement[] = Array.from({ length: 120 }, (_, index) => ({
      ref: `f0e${index + 1}`,
      role: 'interactive',
      name: '',
      tag: 'div',
    }))
    elements[119] = {
      ref: 'f0e120',
      role: 'textbox',
      name: '审核账号',
      tag: 'input',
      editable: true,
    }
    const frame: FakeFrame = {
      name: '',
      url: 'https://example.com/large',
      origin: 'https://example.com',
      parent: null,
      isDestroyed: () => false,
      executeJavaScript: async () => ({ title: '大型页面', text: '', elements }),
    }
    const contents = {
      getURL: () => frame.url,
      getTitle: () => '大型页面',
      mainFrame: { framesInSubtree: [frame] },
    }

    const result = await readBrowserPage(contents as never)

    expect(result.snapshot.elements).toHaveLength(80)
    expect(result.snapshot.elements).toContainEqual(expect.objectContaining({
      ref: 'f0e120',
      role: 'textbox',
    }))
    expect(result.snapshot.frames[0]).toMatchObject({ elementCount: 120 })
    expect(result.snapshot.frames[0]).not.toHaveProperty('elements')
    expect(result.elementFrames.size).toBe(80)
  })

  test('Given 密码输入框 When 读取脚本生成 Then 不把密码值暴露到页面状态', async () => {
    let script = ''
    const frame: FakeFrame = {
      name: '',
      url: 'https://example.com/login',
      origin: 'https://example.com',
      parent: null,
      isDestroyed: () => false,
      executeJavaScript: async (value) => {
        script = value
        return { title: '登录', text: '', elements: [] }
      },
    }
    const contents = {
      getURL: () => frame.url,
      getTitle: () => '登录',
      mainFrame: { framesInSubtree: [frame] },
    }

    await readBrowserPage(contents as never)

    expect(script).toContain("type === 'password'")
    expect(script).toContain("const value = isPassword ? ''")
  })

  test('Given 可点击元素引用 When 点击 Then 先显示不拦截页面事件的 Agent 鼠标轨迹再执行点击', async () => {
    let script = ''
    const frame: FakeFrame = {
      name: '',
      url: 'https://example.com',
      origin: 'https://example.com',
      parent: null,
      isDestroyed: () => false,
      executeJavaScript: async (value) => {
        script = value
        return { ok: true }
      },
    }

    const result = await clickBrowserElement(frame as never, 'f0e1')

    expect(result.ok).toBe(true)
    expect(script).toContain('data-proma-agent-pointer')
    expect(script).toMatch(/pointerEvents:\s*["']none["']/)
    expect(script).toContain('await pointer.click(rect)')
    expect(script.indexOf('await pointer.click(rect)')).toBeLessThan(script.indexOf('element.click();'))
  })

  test('Given 可输入元素引用 When 输入 Then 显示鼠标移动和输入焦点反馈', async () => {
    let script = ''
    const frame: FakeFrame = {
      name: '',
      url: 'https://example.com/login',
      origin: 'https://example.com',
      parent: null,
      isDestroyed: () => false,
      executeJavaScript: async (value) => {
        script = value
        return { ok: true }
      },
    }

    const result = await typeBrowserElement(frame as never, 'f0e1', 'user@example.com')

    expect(result.ok).toBe(true)
    expect(script).toContain('await pointer.type(rect)')
    expect(script).toContain('prefers-reduced-motion: reduce')
    expect(script.indexOf('await pointer.type(rect)')).toBeLessThan(script.indexOf('const nextValue'))
  })

  test('Given 元素不可用 When 操作 Then 在播放成功轨迹前直接返回 disabled', async () => {
    let script = ''
    const frame: FakeFrame = {
      name: '',
      url: 'https://example.com',
      origin: 'https://example.com',
      parent: null,
      isDestroyed: () => false,
      executeJavaScript: async (value) => {
        script = value
        return { ok: false, reason: 'disabled' }
      },
    }

    await clickBrowserElement(frame as never, 'f0e1')

    expect(script.indexOf("reason: 'disabled'")).toBeLessThan(script.indexOf('await pointer.click(rect)'))
  })
})
