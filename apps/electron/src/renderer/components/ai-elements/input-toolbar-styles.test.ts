import { describe, expect, test } from 'bun:test'
import { inputCardClass } from './input-toolbar-styles'

describe('输入框容器圆角', () => {
  test('应强制保留 Codex 风格的 20px 大圆角', () => {
    expect(inputCardClass).toContain('!rounded-[20px]')
  })
})
