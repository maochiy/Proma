/**
 * OpenSwitch 搜索客户端 BDD 测试
 *
 * 通过临时修改全局 fetch 拦截请求，验证请求格式与响应归一化。
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { searchOpenSwitch } from './openswitch-search-client'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(String(input), init ?? {})
  }) as typeof fetch
}

describe('searchOpenSwitch', () => {
  test('按 OpenSwitch 搜索接口格式发起请求（Bearer Key + JSON body）', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit = {}
    mockFetch((url, init) => {
      capturedUrl = url
      capturedInit = init
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    })

    await searchOpenSwitch('sk-test-key', { query: 'OpenAI latest news', maxResults: 5 })

    expect(capturedUrl).toBe('https://ais.xiudarepair.com/v1/search')
    expect(capturedInit.method).toBe('POST')
    const headers = capturedInit.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test-key')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(String(capturedInit.body))
    expect(body.query).toBe('OpenAI latest news')
    expect(body.max_results).toBe(5)
  })

  test('max_results 超出范围时收敛到 1-10', async () => {
    let capturedBody: Record<string, unknown> = {}
    mockFetch((_url, init) => {
      capturedBody = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    })

    await searchOpenSwitch('sk-key', { query: 'q', maxResults: 99 })
    expect(capturedBody.max_results).toBe(10)
  })

  test('归一化服务端响应字段（snake_case → 内部结构）', async () => {
    mockFetch(() => new Response(JSON.stringify({
      answer: '概要内容',
      response_time: 0.42,
      request_id: 'req-1',
      results: [
        { title: '标题', url: 'https://example.com', content: '摘要', score: 0.95 },
        // 字段别名容错
        { name: '别名标题', link: 'https://example.org', snippet: '别名摘要' },
        // 无 URL 的条目被丢弃
        { title: '无链接' },
      ],
    }), { status: 200 }))

    const result = await searchOpenSwitch('sk-key', { query: 'q' })

    expect(result.answer).toBe('概要内容')
    expect(result.responseTime).toBe(0.42)
    expect(result.requestId).toBe('req-1')
    expect(result.results).toHaveLength(2)
    expect(result.results[0]).toMatchObject({
      title: '标题', url: 'https://example.com', content: '摘要', score: 0.95,
    })
    expect(result.results[1]).toMatchObject({
      title: '别名标题', url: 'https://example.org', content: '别名摘要',
    })
  })

  test('归一化 OpenSwitch 实际包装格式 data.results[].text/url', async () => {
    mockFetch(() => new Response(JSON.stringify({
      success: true,
      data: {
        query: 'OpenAI latest news',
        results: [
          {
            text: 'OpenAI AI News — Latest Updates\n\nSome body content here',
            url: 'https://aiweekly.co/ai-news-today/openai-news',
          },
          {
            text: 'OpenAI News | OpenAI',
            url: 'https://openai.com/news',
          },
        ],
      },
    }), { status: 200 }))

    const result = await searchOpenSwitch('sk-key', { query: 'OpenAI latest news' })
    expect(result.results).toHaveLength(2)
    expect(result.results[0]?.url).toBe('https://aiweekly.co/ai-news-today/openai-news')
    expect(result.results[0]?.title).toBe('OpenAI AI News')
    expect(result.results[0]?.content).toContain('Some body content here')
    expect(result.results[1]?.title).toBe('OpenAI News | OpenAI')
  })

  test('HTTP 错误抛出带状态码的异常', async () => {
    mockFetch(() => new Response('Unauthorized', { status: 401 }))

    await expect(searchOpenSwitch('sk-bad', { query: 'q' })).rejects.toThrow('401')
  })

  test('空 query 直接抛错，不发起请求', async () => {
    let called = false
    mockFetch(() => {
      called = true
      return new Response('{}', { status: 200 })
    })

    await expect(searchOpenSwitch('sk-key', { query: '   ' })).rejects.toThrow('query 不能为空')
    expect(called).toBe(false)
  })
})
