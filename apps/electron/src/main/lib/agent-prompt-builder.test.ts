import { describe, expect, test } from 'bun:test'
import { buildSystemPrompt } from './agent-prompt-builder'

describe('Agent 系统提示词', () => {
  test('Given CCB 并行工具批次为 fail-fast When 构建系统提示词 Then 提醒模型处理探测退出码与 zsh 通配符', () => {
    const prompt = buildSystemPrompt({
      sessionId: 'session-id',
      permissionMode: 'default',
    })

    expect(prompt).toContain('并行工具批次采用 fail-fast')
    expect(prompt).toContain('grep ... || true')
    expect(prompt).toContain('在 zsh 中引用')
  })
})
