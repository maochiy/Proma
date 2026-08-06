/**
 * 联网搜索服务 BDD 测试
 *
 * 覆盖：结果格式化、本地 WebFetch HTML 提取、未登录时搜索失败。
 * electron 通过 mock 隔离，避免依赖真实 Electron 运行时。
 */

import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const tempHome = mkdtempSync(join(tmpdir(), 'proma-web-search-test-'))
process.env.HOME = tempHome
process.env.PROMA_DEV = '1'

mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => join(tempHome, 'Library', 'Application Support'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf-8'),
  },
  clipboard: { writeText: () => undefined },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  shell: { openExternal: async () => undefined },
}))

const realFetch = globalThis.fetch
let searchWeb: typeof import('./web-search-service').searchWeb
let fetchWebPage: typeof import('./web-search-service').fetchWebPage
let formatFetchResults: typeof import('./web-search-service').formatFetchResults
let formatSearchResults: typeof import('./web-search-service').formatSearchResults
let isWebSearchAvailable: typeof import('./web-search-service').isWebSearchAvailable

beforeAll(async () => {
  const mod = await import('./web-search-service')
  searchWeb = mod.searchWeb
  fetchWebPage = mod.fetchWebPage
  formatFetchResults = mod.formatFetchResults
  formatSearchResults = mod.formatSearchResults
  isWebSearchAvailable = mod.isWebSearchAvailable
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('formatSearchResults', () => {
  test('Given 搜索结果 When 格式化 Then 包含概要与编号结果', () => {
    const text = formatSearchResults({
      answer: 'OpenAI 发布了新模型',
      results: [
        { title: 'News A', url: 'https://a.example.com', content: 'content A', score: 0.9 },
        { title: 'News B', url: 'https://b.example.com', content: 'content B' },
      ],
    })

    expect(text).toContain('**概要：** OpenAI 发布了新模型')
    expect(text).toContain('1. [News A](https://a.example.com)')
    expect(text).toContain('2. [News B](https://b.example.com)')
    expect(text).toContain('score: 0.900')
  })

  test('Given 空结果 When 格式化 Then 提示未找到', () => {
    expect(formatSearchResults({ results: [] })).toContain('未找到相关结果')
  })
})

describe('formatFetchResults', () => {
  test('Given 抓取成功 When 格式化 Then 输出 URL 与正文', () => {
    const text = formatFetchResults({
      results: [{ url: 'https://example.com', rawContent: 'Hello world' }],
    })
    expect(text).toContain('# https://example.com')
    expect(text).toContain('Hello world')
  })

  test('Given 超长正文 When 格式化 Then 截断并提示', () => {
    const long = 'x'.repeat(30_000)
    const text = formatFetchResults({
      results: [{ url: 'https://example.com', rawContent: long }],
    }, { maxChars: 1000 })
    expect(text).toContain('已截断至 1000 字符')
    expect(text.length).toBeLessThan(long.length)
  })
})

describe('fetchWebPage', () => {
  test('Given HTML 页面 When 抓取 Then 提取正文并剥离脚本', async () => {
    globalThis.fetch = (async () => new Response(
      `<html><head><style>.a{}</style><script>alert(1)</script></head>
       <body><h1>标题</h1><p>段落内容</p><a href="https://x.com">链接</a></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )) as unknown as typeof fetch

    const data = await fetchWebPage({ url: 'https://example.com/page' })
    expect(data.results).toHaveLength(1)
    const content = data.results[0]?.rawContent ?? ''
    expect(content).toContain('# 标题')
    expect(content).toContain('段落内容')
    expect(content).toContain('[链接](https://x.com)')
    expect(content).not.toContain('alert(1)')
    expect(content).not.toContain('.a{}')
  })

  test('Given 无效 URL When 抓取 Then 返回失败结果', async () => {
    const data = await fetchWebPage({ url: 'ftp://bad.example' })
    expect(data.results).toHaveLength(0)
    expect(data.failedResults?.[0]?.error).toContain('仅支持 http/https')
  })
})

describe('searchWeb 可用性', () => {
  test('Given 未登录 OpenSwitch When 判断可用 Then 返回 false', () => {
    expect(isWebSearchAvailable()).toBe(false)
  })

  test('Given 未登录 OpenSwitch When 搜索 Then 抛出登录提示', async () => {
    await expect(searchWeb({ query: 'test' })).rejects.toThrow('登录 OpenSwitch')
  })
})
