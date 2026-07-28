import { describe, expect, test } from 'bun:test'
import {
  createFallbackTitle,
  createRuntimeSessionProjectionTitle,
  hasRuntimePromptContext,
  sanitizeGeneratedTitle,
  stripRuntimePromptContext,
} from './title-generation'

describe('标题生成辅助逻辑', () => {
  test('Given ChatGPT OAuth 无标题适配器 When 本地兜底 Then 使用首个有效行并限制长度', () => {
    const title = createFallbackTitle('\n\n## 帮我修复 OpenAI OAuth 标题生成失败的问题\n更多细节')

    expect(title).toBe('帮我修复 OpenAI OAuth 标题')
  })

  test('Given 用户输入包含多行 When 本地兜底 Then 不把后续说明拼入标题', () => {
    expect(createFallbackTitle('# 修复登录页\n补充：只改样式')).toBe('修复登录页')
  })

  test('Given 模型返回带引号标题 When 清理 Then 去除包裹符号并限制长度', () => {
    const title = sanitizeGeneratedTitle('「OpenAI OAuth 标题修复」')

    expect(title).toBe('OpenAI OAuth 标题修复')
  })

  test('Given CCB Transcript 标题包含 Proma 动态上下文 When 投影到侧边栏 Then 只显示用户任务', () => {
    const raw = [
      '**当前时间: Tuesday, July 28, 2026 at 01:10 PM GMT+8**',
      '<workspace_state>',
      '工作区: zmn-expert-flutter',
      '</workspace_state>',
      '<working_directory>/Volumes/code/code/zmn/zmn-expert-flutter</working_directory>',
      '请只回复 OK',
    ].join('\n')

    expect(hasRuntimePromptContext(raw)).toBe(true)
    expect(stripRuntimePromptContext(raw)).toBe('请只回复 OK')
    expect(createRuntimeSessionProjectionTitle(raw)).toBe('请只回复 OK')
  })
})
