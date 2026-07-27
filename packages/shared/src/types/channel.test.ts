import { describe, expect, test } from 'bun:test'
import { isAgentCompatibleProvider } from './channel'

describe('Agent 渠道协议兼容性', () => {
  test.each([
    'anthropic-compatible',
    'custom',
    'opencode-go-openai',
    'openai-responses',
    'openai-codex',
    'google',
  ] as const)(
    'Given %s When 判断 CCB Agent 兼容性 Then 加入白名单',
    (provider) => {
      expect(isAgentCompatibleProvider(provider)).toBe(true)
    },
  )
})
