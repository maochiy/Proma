/**
 * 个人用量服务
 *
 * 扫描本地 Agent 会话 JSONL 与 Chat 对话索引，汇总 Token / 连续天数 / 常用模型。
 * Chat 消息目前不持久化 usage，Token 口径以 Agent result 为准。
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { listChannels } from './channel-manager'
import { listConversations } from './conversation-manager'
import { listAgentSessions } from './agent-session-manager'
import { getAgentSessionMessagesPath, getAgentSessionsIndexPath, getConversationsIndexPath } from './config-paths'
import {
  aggregateUserUsage,
  createEmptyUserUsageSummary,
  isUsageRelatedLine,
  parseUsageRecords,
  selectSessionQueries,
  type UsageQuery,
  type UsageSessionSpan,
  type UsageSkillUse,
} from './user-usage-aggregator'
import type { UserUsageSummary } from '../../types'

interface UsageCache {
  key: string
  summary: UserUsageSummary
}

let cache: UsageCache | null = null

function fileStamp(filePath: string): string {
  if (!existsSync(filePath)) return 'missing'
  try {
    const stat = statSync(filePath)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return 'error'
  }
}

function cacheKey(): string {
  return `${fileStamp(getAgentSessionsIndexPath())}|${fileStamp(getConversationsIndexPath())}`
}

function buildModelNameMap(): Map<string, string> {
  const names = new Map<string, string>()
  for (const channel of listChannels()) {
    for (const model of channel.models || []) {
      if (!model.id) continue
      names.set(model.id, model.name || model.id)
    }
  }
  return names
}

async function readUsageRelatedLines(filePath: string): Promise<string[]> {
  if (!existsSync(filePath)) return []
  const lines: string[] = []
  const stream = createReadStream(filePath, { encoding: 'utf-8' })
  const reader = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of reader) {
    if (line && isUsageRelatedLine(line)) lines.push(line)
  }
  return lines
}

export async function getUserUsageSummary(now: Date = new Date()): Promise<UserUsageSummary> {
  const key = cacheKey()
  if (cache && cache.key === key && (now.getTime() - cache.summary.checkedAt) < 15_000) {
    return cache.summary
  }

  try {
    const sessions = listAgentSessions().filter((session) => !session.draft)
    const conversations = listConversations()
    const modelNames = buildModelNameMap()
    const queries: UsageQuery[] = []
    const skillUses: UsageSkillUse[] = []
    const sessionSpans: UsageSessionSpan[] = sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }))

    for (const session of sessions) {
      const filePath = getAgentSessionMessagesPath(session.id)
      try {
        const lines = await readUsageRelatedLines(filePath)
        const records = parseUsageRecords(lines, session.id)
        queries.push(...selectSessionQueries(records))
        skillUses.push(...records.skillUses)
      } catch (error) {
        console.error(`[个人用量] 读取会话失败 (${session.id}):`, error)
      }
    }

    const summary = aggregateUserUsage({
      queries,
      skillUses,
      sessions: sessionSpans,
      chatCount: conversations.length,
      now,
      resolveModelName: (modelId) => modelNames.get(modelId) || modelId,
    })

    cache = { key, summary }
    return summary
  } catch (error) {
    console.error('[个人用量] 汇总失败:', error)
    return createEmptyUserUsageSummary(now)
  }
}

export function invalidateUserUsageSummaryCache(): void {
  cache = null
}
