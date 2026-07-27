import { describe, expect, test } from 'bun:test'
import {
  buildQueuedMessageSendPayload,
  createAgentQueuedMessage,
  parseQueuedMessageMentions,
} from './agent-message-queue'

const SOURCE_SESSION_ID = 'b5839484-13e3-4ac3-9415-9cb05caa446d'
const OTHER_SESSION_ID = 'bc42070b-483f-4352-bba6-b3f8714b5af9'

describe('parseQueuedMessageMentions 会话 ID 引用', () => {
  test('Given 用户从会话菜单复制裸 ID When 粘贴到新会话 Then 识别为结构化会话引用', () => {
    const result = parseQueuedMessageMentions(
      `请读取会话 ${SOURCE_SESSION_ID}，然后继续完成剩余工作。`,
      [SOURCE_SESSION_ID, OTHER_SESSION_ID],
    )

    expect(result.mentionedSessionIds).toEqual([SOURCE_SESSION_ID])
    expect(result.cleanedText).toContain(SOURCE_SESSION_ID)
  })

  test('Given 文本只包含未知或不完整 ID When 解析引用 Then 不注入其他会话历史', () => {
    const result = parseQueuedMessageMentions(
      `排查 ${SOURCE_SESSION_ID.slice(0, -1)} 和 prefix${OTHER_SESSION_ID}`,
      [SOURCE_SESSION_ID, OTHER_SESSION_ID],
    )

    expect(result.mentionedSessionIds).toEqual([])
  })

  test('Given 同一会话同时使用 mention 和裸 ID When 解析引用 Then 自动去重', () => {
    const result = parseQueuedMessageMentions(
      `读取 &session:${SOURCE_SESSION_ID}，ID 是 ${SOURCE_SESSION_ID}`,
      [SOURCE_SESSION_ID],
    )

    expect(result.mentionedSessionIds).toEqual([SOURCE_SESSION_ID])
  })

  test('Given 队列消息含复制的会话 ID When 构建发送载荷 Then 保留可见原文并携带引用 ID', () => {
    const message = createAgentQueuedMessage(
      `根据 ${SOURCE_SESSION_ID} 继续执行`,
      'message-1',
      1,
    )

    const payload = buildQueuedMessageSendPayload(message, '', [SOURCE_SESSION_ID])

    expect(payload.rawText).toContain(SOURCE_SESSION_ID)
    expect(payload.sdkText).toContain(SOURCE_SESSION_ID)
    expect(payload.mentions.mentionedSessionIds).toEqual([SOURCE_SESSION_ID])
  })
})
