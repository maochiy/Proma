import { describe, expect, test } from 'bun:test'
import {
  aggregateUserUsage,
  computeStreaks,
  localDayKey,
  parseUsageRecords,
  selectSessionQueries,
  sumUsageTokens,
} from './user-usage-aggregator'

function dayDate(day: string, hour = 12): Date {
  const parts = day.split('-').map(Number)
  const year = parts[0] ?? 0
  const month = parts[1] ?? 1
  const date = parts[2] ?? 1
  return new Date(year, month - 1, date, hour)
}

describe('user-usage-aggregator', () => {
  test('given SDK result usage when 汇总 then 按 result 累计真实 Token 且按模型拆分', () => {
    const lines = [
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        duration_ms: 12_000,
        fast_mode_state: 'off',
        _createdAt: dayDate('2026-06-30').getTime(),
        _channelModelId: 'grok-4.5',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 40,
          cache_creation_input_tokens: 10,
        },
        modelUsage: {
          'grok-4.5': {
            inputTokens: 80,
            outputTokens: 15,
            cacheReadInputTokens: 40,
            cacheCreationInputTokens: 10,
          },
          'deepseek-v4-flash': {
            inputTokens: 20,
            outputTokens: 5,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        parent_tool_use_id: null,
        _createdAt: dayDate('2026-06-30').getTime(),
        message: {
          model: 'grok-4.5',
          usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 },
          content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'brainstorming' } }],
        },
      }),
    ]

    const records = parseUsageRecords(lines, 'session-a')
    const queries = selectSessionQueries(records)
    const summary = aggregateUserUsage({
      queries,
      skillUses: records.skillUses,
      sessions: [{ id: 'session-a', createdAt: dayDate('2026-06-30').getTime(), updatedAt: dayDate('2026-06-30', 13).getTime() }],
      chatCount: 2,
      now: dayDate('2026-06-30'),
      resolveModelName: (id) => id === 'grok-4.5' ? 'Grok 4.5' : id,
    })

    expect(queries).toHaveLength(1)
    expect(summary.stats.totalTokens).toBe(170)
    expect(summary.stats.requests).toBe(1)
    expect(summary.stats.peakDayTokens).toBe(170)
    expect(summary.stats.peakDay).toBe('2026-06-30')
    expect(summary.stats.skillsExplored).toBe(1)
    expect(summary.stats.skillUses).toBe(1)
    expect(summary.models.map((item) => item.modelId)).toEqual(['grok-4.5', 'deepseek-v4-flash'])
    expect(summary.models[0]?.modelName).toBe('Grok 4.5')
    expect(summary.models[0]?.requests).toBe(1)
  })

  test('given 合成压缩 result when 解析 then 忽略该条用量', () => {
    const lines = [
      JSON.stringify({
        type: 'result',
        isSyntheticCompactionResult: true,
        _createdAt: dayDate('2026-06-30').getTime(),
        usage: { input_tokens: 999, output_tokens: 1 },
      }),
    ]
    const records = parseUsageRecords(lines, 'session-a')
    expect(selectSessionQueries(records)).toHaveLength(0)
  })

  test('given 旧版 assistant.usage 且没有 result when 汇总 then 回退统计 Token', () => {
    const lines = [
      JSON.stringify({
        role: 'assistant',
        model: 'gpt-5.6-sol',
        createdAt: dayDate('2026-07-01').getTime(),
        durationMs: 8000,
        usage: { inputTokens: 50, outputTokens: 10 },
      }),
    ]
    const records = parseUsageRecords(lines, 'session-b')
    const summary = aggregateUserUsage({
      queries: selectSessionQueries(records),
      skillUses: [],
      sessions: [{ id: 'session-b', createdAt: 1, updatedAt: 2 }],
      chatCount: 0,
      now: dayDate('2026-07-01'),
    })
    expect(summary.stats.totalTokens).toBe(60)
    expect(summary.stats.requests).toBe(1)
    expect(summary.models[0]?.modelId).toBe('gpt-5.6-sol')
  })

  test('given 连续活跃日且今天无用量 when 计算连续天数 then 当前为 0 且最长保留历史', () => {
    const streaks = computeStreaks(
      ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-10'],
      dayDate('2026-06-12'),
    )
    expect(streaks.currentStreakDays).toBe(0)
    expect(streaks.longestStreakDays).toBe(3)
  })

  test('given 今天也有用量 when 计算连续天数 then 从今天往回计', () => {
    const streaks = computeStreaks(
      ['2026-06-28', '2026-06-29', '2026-06-30'],
      dayDate('2026-06-30'),
    )
    expect(streaks.currentStreakDays).toBe(3)
    expect(streaks.longestStreakDays).toBe(3)
  })

  test('given 同一会话多次请求 when 汇总 then 最长聊天时长取活动跨度', () => {
    const start = dayDate('2026-06-30', 8).getTime()
    const end = dayDate('2026-06-30', 19).getTime()
    const summary = aggregateUserUsage({
      queries: [
        {
          sessionId: 'session-a',
          createdAt: start,
          durationMs: 20_000,
          fastMode: false,
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          models: [{ modelId: 'grok-4.5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }],
        },
        {
          sessionId: 'session-a',
          createdAt: end,
          durationMs: 30_000,
          fastMode: true,
          inputTokens: 2,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          models: [{ modelId: 'grok-4.5', inputTokens: 2, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 }],
        },
      ],
      skillUses: [],
      sessions: [{ id: 'session-a', createdAt: start, updatedAt: end }],
      chatCount: 0,
      now: dayDate('2026-06-30', 19),
    })
    expect(summary.stats.longestChatDurationMs).toBe(end - start)
    expect(summary.stats.fastModeRate).toBe(0.5)
    expect(localDayKey(start)).toBe('2026-06-30')
    expect(sumUsageTokens({ inputTokens: 2, outputTokens: 3, cacheReadTokens: 4, cacheCreationTokens: 5 })).toBe(14)
  })
})
