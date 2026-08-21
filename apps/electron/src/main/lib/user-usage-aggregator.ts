/**
 * 个人用量汇总纯函数
 *
 * 从 Agent JSONL / Chat 元数据提取 Token、连续天数、常用模型等统计。
 * 不读写磁盘，便于单测。
 */

import type {
  UserUsageDay,
  UserUsageModel,
  UserUsageSkill,
  UserUsageStats,
  UserUsageSummary,
} from '../../types'

/** 一次模型请求（优先 SDK result，必要时回退 assistant usage） */
export interface UsageQuery {
  sessionId: string
  createdAt: number
  durationMs: number
  fastMode: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  models: UsageQueryModel[]
}

export interface UsageQueryModel {
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface UsageSkillUse {
  name: string
  createdAt: number
}

export interface UsageSessionSpan {
  id: string
  createdAt: number
  updatedAt: number
}

export interface AggregateUserUsageInput {
  queries: UsageQuery[]
  skillUses: UsageSkillUse[]
  sessions: UsageSessionSpan[]
  chatCount: number
  now?: Date
  resolveModelName?: (modelId: string) => string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asFiniteNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function asPositiveNumber(value: unknown): number {
  const parsed = asFiniteNumber(value)
  return parsed > 0 ? parsed : 0
}

export function sumUsageTokens(parts: {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}): number {
  return (
    (parts.inputTokens ?? 0)
    + (parts.outputTokens ?? 0)
    + (parts.cacheReadTokens ?? 0)
    + (parts.cacheCreationTokens ?? 0)
  )
}

export function localDayKey(value: Date | number): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDayKey(value: string): Date | null {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

export function createEmptyUserUsageSummary(now: Date = new Date()): UserUsageSummary {
  return {
    checkedAt: now.getTime(),
    stats: {
      totalTokens: 0,
      peakDayTokens: 0,
      peakDay: '',
      longestChatDurationMs: 0,
      currentStreakDays: 0,
      longestStreakDays: 0,
      requests: 0,
      chatCount: 0,
      agentSessionCount: 0,
      fastModeRate: 0,
      skillsExplored: 0,
      skillUses: 0,
    },
    days: [],
    models: [],
    skills: [],
  }
}

export function computeStreaks(
  activeDays: Iterable<string>,
  today: Date = new Date(),
): { currentStreakDays: number; longestStreakDays: number } {
  const unique = new Set(Array.from(activeDays).filter((day) => parseDayKey(day)))
  const sorted = Array.from(unique).sort()
  let longest = 0
  let run = 0
  let previous: Date | null = null
  for (const key of sorted) {
    const date = parseDayKey(key)
    if (!date) continue
    if (previous && (date.getTime() - previous.getTime()) === 86_400_000) {
      run += 1
    } else {
      run = 1
    }
    if (run > longest) longest = run
    previous = date
  }

  const todayKey = localDayKey(today)
  let current = 0
  if (unique.has(todayKey)) {
    const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    while (unique.has(localDayKey(cursor))) {
      current += 1
      cursor.setDate(cursor.getDate() - 1)
    }
  }

  return { currentStreakDays: current, longestStreakDays: longest }
}

function looksLikeResultLine(line: string): boolean {
  return line.includes('"type":"result"') || line.includes('"type": "result"')
}

function looksLikeSkillLine(line: string): boolean {
  return line.includes('"name":"Skill"') || line.includes('"name": "Skill"')
}

function looksLikeLegacyAssistantLine(line: string): boolean {
  return line.includes('"role":"assistant"') || line.includes('"role": "assistant"')
}

export function isUsageRelatedLine(line: string): boolean {
  return looksLikeResultLine(line) || looksLikeSkillLine(line) || looksLikeLegacyAssistantLine(line)
}

function readTokenBag(value: unknown): {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
} {
  if (!isRecord(value)) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
  }
  return {
    inputTokens: asPositiveNumber(value.input_tokens ?? value.inputTokens),
    outputTokens: asPositiveNumber(value.output_tokens ?? value.outputTokens),
    cacheReadTokens: asPositiveNumber(
      value.cache_read_input_tokens ?? value.cacheReadInputTokens ?? value.cacheReadTokens,
    ),
    cacheCreationTokens: asPositiveNumber(
      value.cache_creation_input_tokens ?? value.cacheCreationInputTokens ?? value.cacheCreationTokens,
    ),
  }
}

function isFastMode(value: unknown): boolean {
  if (value == null || value === false) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized !== '' && normalized !== 'off' && normalized !== 'false' && normalized !== 'none' && normalized !== '0'
}

function createdAtOf(record: Record<string, unknown>, fallback = 0): number {
  const direct = asPositiveNumber(record._createdAt ?? record.createdAt)
  if (direct > 0) return direct
  return fallback
}

function extractSkillName(input: unknown): string {
  if (typeof input === 'string' && input.trim()) return input.trim()
  if (!isRecord(input)) return ''
  const raw = input.skill ?? input.name ?? input.skill_name ?? input.skillName
  return typeof raw === 'string' ? raw.trim() : ''
}

function extractSkillUses(record: Record<string, unknown>, createdAt: number): UsageSkillUse[] {
  const message = isRecord(record.message) ? record.message : record
  const content = message.content
  if (!Array.isArray(content)) return []
  const uses: UsageSkillUse[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type !== 'tool_use') continue
    if (String(block.name || '') !== 'Skill') continue
    const name = extractSkillName(block.input)
    if (!name) continue
    uses.push({ name, createdAt })
  }
  return uses
}

function queryFromResult(record: Record<string, unknown>, sessionId: string): UsageQuery | null {
  if (record.type !== 'result') return null
  if (record.isSyntheticCompactionResult === true) return null
  const usage = readTokenBag(record.usage)
  const createdAt = createdAtOf(record)
  const durationMs = asPositiveNumber(record.duration_ms ?? record.durationMs ?? record._durationMs)
  const models: UsageQueryModel[] = []
  if (isRecord(record.modelUsage)) {
    for (const [modelId, modelUsage] of Object.entries(record.modelUsage)) {
      if (!modelId) continue
      const bag = readTokenBag(modelUsage)
      models.push({ modelId, ...bag })
    }
  }
  if (models.length === 0) {
    const modelId = String(record._channelModelId || record.model || '').trim() || 'unknown'
    models.push({ modelId, ...usage })
  }
  return {
    sessionId,
    createdAt,
    durationMs,
    fastMode: isFastMode(record.fast_mode_state ?? record.fastMode),
    ...usage,
    models,
  }
}

function queryFromLegacyAssistant(record: Record<string, unknown>, sessionId: string): UsageQuery | null {
  if (record.role !== 'assistant') return null
  if (!isRecord(record.usage)) return null
  const usage = readTokenBag(record.usage)
  if (sumUsageTokens(usage) <= 0 && asPositiveNumber(record.usage.costUsd) <= 0) return null
  const modelId = String(record.model || record._channelModelId || '').trim() || 'unknown'
  return {
    sessionId,
    createdAt: createdAtOf(record),
    durationMs: asPositiveNumber(record.durationMs ?? record.duration_ms),
    fastMode: false,
    ...usage,
    models: [{ modelId, ...usage }],
  }
}

export interface ParsedUsageRecords {
  queries: UsageQuery[]
  fallbackQueries: UsageQuery[]
  skillUses: UsageSkillUse[]
}

/**
 * 从会话 JSONL 行提取用量。result 优先；无 result 时回退旧版 assistant.usage。
 */
export function parseUsageRecords(lines: Iterable<string>, sessionId: string): ParsedUsageRecords {
  const queries: UsageQuery[] = []
  const fallbackQueries: UsageQuery[] = []
  const skillUses: UsageSkillUse[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const maybeResult = looksLikeResultLine(line)
    const maybeSkill = looksLikeSkillLine(line)
    const maybeLegacy = looksLikeLegacyAssistantLine(line)
    if (!maybeResult && !maybeSkill && !maybeLegacy) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(parsed)) continue

    if (maybeResult) {
      const query = queryFromResult(parsed, sessionId)
      if (query) queries.push(query)
    } else if (maybeLegacy) {
      const query = queryFromLegacyAssistant(parsed, sessionId)
      if (query) fallbackQueries.push(query)
    }

    if (maybeSkill) {
      skillUses.push(...extractSkillUses(parsed, createdAtOf(parsed)))
    }
  }

  return { queries, fallbackQueries, skillUses }
}

export function selectSessionQueries(records: ParsedUsageRecords): UsageQuery[] {
  return records.queries.length > 0 ? records.queries : records.fallbackQueries
}

function longestSessionDurationMs(queries: UsageQuery[], sessions: UsageSessionSpan[]): number {
  const bounds = new Map<string, { min: number; max: number; durationMs: number }>()
  for (const query of queries) {
    if (!query.sessionId) continue
    const createdAt = query.createdAt > 0 ? query.createdAt : 0
    const current = bounds.get(query.sessionId)
    if (!current) {
      bounds.set(query.sessionId, {
        min: createdAt || Number.POSITIVE_INFINITY,
        max: createdAt,
        durationMs: query.durationMs,
      })
      continue
    }
    if (createdAt > 0 && createdAt < current.min) current.min = createdAt
    if (createdAt > current.max) current.max = createdAt
    current.durationMs += query.durationMs
  }

  let longest = 0
  for (const [sessionId, span] of bounds) {
    const wallClock = Number.isFinite(span.min) && span.max > span.min ? span.max - span.min : 0
    const generation = span.durationMs
    const sessionMeta = sessions.find((item) => item.id === sessionId)
    const metaSpan = sessionMeta && sessionMeta.updatedAt > sessionMeta.createdAt
      ? sessionMeta.updatedAt - sessionMeta.createdAt
      : 0
    // 优先用会话内活动跨度；没有时间戳时退回单次请求 duration 合计。
    const candidate = Math.max(wallClock, generation > 0 && wallClock === 0 ? generation : 0, wallClock === 0 ? metaSpan : 0)
    if (candidate > longest) longest = candidate
  }
  return longest
}

export function aggregateUserUsage(input: AggregateUserUsageInput): UserUsageSummary {
  const now = input.now ?? new Date()
  const resolveModelName = input.resolveModelName ?? ((modelId: string) => modelId)
  const queries = input.queries
  const byDay = new Map<string, UserUsageDay>()
  const byModel = new Map<string, UserUsageModel>()
  let totalTokens = 0
  let fastModeCount = 0

  for (const query of queries) {
    const tokens = sumUsageTokens(query)
    totalTokens += tokens
    if (query.fastMode) fastModeCount += 1
    const createdAt = query.createdAt > 0 ? query.createdAt : now.getTime()
    const day = localDayKey(createdAt)
    if (day) {
      const dayRow = byDay.get(day) || { day, tokens: 0, requests: 0 }
      dayRow.tokens += tokens
      dayRow.requests += 1
      byDay.set(day, dayRow)
    }

    for (const model of query.models) {
      const modelId = model.modelId || 'unknown'
      const modelTokens = sumUsageTokens(model) || tokens
      const current = byModel.get(modelId) || {
        modelId,
        modelName: resolveModelName(modelId) || modelId,
        requests: 0,
        tokens: 0,
        lastUsedAt: 0,
      }
      current.requests += 1
      current.tokens += modelTokens
      if (createdAt > current.lastUsedAt) current.lastUsedAt = createdAt
      if (!current.modelName || current.modelName === modelId) {
        current.modelName = resolveModelName(modelId) || modelId
      }
      byModel.set(modelId, current)
    }
  }

  const days = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
  const peakDay = days.reduce<UserUsageDay>(
    (peak, row) => (row.tokens > peak.tokens ? row : peak),
    { day: '', tokens: 0, requests: 0 },
  )
  const streaks = computeStreaks(days.filter((row) => row.tokens > 0 || row.requests > 0).map((row) => row.day), now)

  const skillMap = new Map<string, UserUsageSkill>()
  for (const skill of input.skillUses) {
    const name = skill.name.trim()
    if (!name) continue
    const current = skillMap.get(name) || { name, uses: 0, lastUsedAt: 0 }
    current.uses += 1
    if (skill.createdAt > current.lastUsedAt) current.lastUsedAt = skill.createdAt
    skillMap.set(name, current)
  }
  const skills = Array.from(skillMap.values()).sort((a, b) => b.uses - a.uses || b.lastUsedAt - a.lastUsedAt)

  const stats: UserUsageStats = {
    totalTokens,
    peakDayTokens: peakDay.tokens,
    peakDay: peakDay.day,
    longestChatDurationMs: longestSessionDurationMs(queries, input.sessions),
    currentStreakDays: streaks.currentStreakDays,
    longestStreakDays: streaks.longestStreakDays,
    requests: queries.length,
    chatCount: input.chatCount,
    agentSessionCount: input.sessions.length,
    fastModeRate: queries.length > 0 ? fastModeCount / queries.length : 0,
    skillsExplored: skills.length,
    skillUses: skills.reduce((sum, item) => sum + item.uses, 0),
  }

  return {
    checkedAt: now.getTime(),
    stats,
    days,
    models: Array.from(byModel.values()).sort((a, b) => b.requests - a.requests || b.tokens - a.tokens),
    skills,
  }
}
