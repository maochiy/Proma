import { describe, expect, test } from 'bun:test'
import { buildProfileActivity } from './profile-activity'
import { formatChineseApproxNumber, formatDurationMs, formatPercent, toProfileHandle, toProfileInitials } from './profile-format'

describe('profile-activity', () => {
  test('given 某日有用量 when 构建每日热力图 then 该日格子有对应 level 与文案', () => {
    const now = new Date(2026, 5, 30)
    const result = buildProfileActivity(
      [{ day: '2026-06-30', tokens: 170_000_000 }],
      'daily',
      now,
      formatChineseApproxNumber,
    )
    const cell = result.cells.find((item) => item.day === '2026-06-30')
    expect(cell).toBeTruthy()
    expect(cell?.level).toBeGreaterThan(0)
    expect(cell?.detail).toContain('1.7亿')
    expect(result.cells.filter((item) => item.future).every((item) => item.level === 0)).toBe(true)
  })

  test('given 每周模式 when 构建热力图 then 同一周格子共享周合计', () => {
    const now = new Date(2026, 5, 30) // Tuesday
    const result = buildProfileActivity(
      [
        { day: '2026-06-29', tokens: 100 },
        { day: '2026-06-30', tokens: 50 },
      ],
      'weekly',
      now,
    )
    const sunday = result.cells.find((item) => item.day === '2026-06-28')
    const tuesday = result.cells.find((item) => item.day === '2026-06-30')
    expect(sunday?.value).toBe(150)
    expect(tuesday?.value).toBe(150)
  })
})

describe('profile-format', () => {
  test('given 大数字 when 格式化 then 达到亿换算成亿，否则用万', () => {
    expect(formatChineseApproxNumber(661_000_000)).toBe('6.61亿')
    expect(formatChineseApproxNumber(316_000_000)).toBe('3.16亿')
    expect(formatChineseApproxNumber(100_000_000)).toBe('1亿')
    expect(formatChineseApproxNumber(39_000_000)).toBe('3900万')
    expect(formatChineseApproxNumber(12_500)).toBe('1.25万')
    expect(formatChineseApproxNumber(1280)).toBe('1,280')
  })

  test('given 时长与百分比 when 格式化 then 贴近资料页文案', () => {
    expect(formatDurationMs((11 * 60 + 5) * 60_000)).toBe('11小时 5分')
    expect(formatDurationMs(0)).toBe('0分')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.53)).toBe('53%')
    expect(toProfileHandle('Mao Chi Fish')).toBe('@mao_chi_fish')
    expect(toProfileInitials('deide')).toBe('DE')
    expect(toProfileInitials('王朗')).toBe('王')
  })
})
