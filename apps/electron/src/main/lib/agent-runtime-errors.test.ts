import { describe, expect, test } from 'bun:test'
import { extractErrorDetails, mapSDKErrorToTypedError } from './agent-runtime-errors'

describe('CCB 上游错误解析', () => {
  test('Given status_code=400 文本 When 提取错误 Then 保留真实上游原因', () => {
    const result = extractErrorDetails({
      error: { message: 'status_code=400, Input required: specify "prompt" or "messages"' },
    })

    expect(result.detailedMessage).toBe('Input required: specify "prompt" or "messages"')
    expect(result.originalError).toContain('status_code=400')
  })

  test('Given API Error JSON When 提取错误 Then 提取 error.message', () => {
    const result = extractErrorDetails({
      message: {
        content: [{
          type: 'text',
          text: 'API Error: 400 {"error":{"message":"Input required: specify \\"prompt\\" or \\"messages\\""}}',
        }],
      },
    })

    expect(result.detailedMessage).toContain('Input required')
  })

  test('Given 400 请求参数错误 When 映射错误 Then 不自动重试并指向模型配置', () => {
    const result = mapSDKErrorToTypedError(
      'unknown_error',
      'status_code=400, Input required: specify "prompt" or "messages"',
      'status_code=400, Input required: specify "prompt" or "messages"',
    )

    expect(result.code).toBe('invalid_request')
    expect(result.canRetry).toBe(false)
    expect(result.message).toContain('Input required')
    expect(result.actions.some((action) => action.action === 'select_model')).toBe(true)
  })
})
