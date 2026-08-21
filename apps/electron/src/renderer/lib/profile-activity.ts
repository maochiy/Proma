/**
 * 个人资料 Token 活动热力图
 *
 * 将按日用量展开为 53 周 × 7 天的 GitHub 风格网格，支持每日 / 每周 / 累计。
 */

export type ProfileActivityMode = 'daily' | 'weekly' | 'total'

export interface ProfileActivityCell {
  day: string
  value: number
  level: number
  week: number
  row: number
  index: number
  future: boolean
  heading: string
  detail: string
  ariaLabel: string
}

export interface ProfileActivityResult {
  cells: ProfileActivityCell[]
  months: Array<{ label: string; index: number }>
}

interface UsageDayLike {
  day?: string
  tokens?: number
}

const PROFILE_ACTIVITY_WEEKS = 53
const PROFILE_ACTIVITY_DAYS = PROFILE_ACTIVITY_WEEKS * 7

function safeTokenCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function localDayKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDayKey(value: string): Date | null {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function activityLevel(value: number, maxValue: number): number {
  if (value <= 0) return 0
  const ratio = value / maxValue
  if (ratio > 0.75) return 4
  if (ratio > 0.45) return 3
  if (ratio > 0.18) return 2
  return 1
}

function activityCopy(
  cell: { date: Date },
  mode: ProfileActivityMode,
  weekStart: Date,
  weekEnd: Date,
  value: number,
  formatValue: (value: number) => string,
): Pick<ProfileActivityCell, 'heading' | 'detail' | 'ariaLabel'> {
  const formatted = formatValue(value)
  if (mode === 'weekly') {
    return {
      heading: `${formatDate(weekStart)}至${formatDate(weekEnd)}`,
      detail: `本周 ${formatted} Token`,
      ariaLabel: `${formatDate(weekStart)}至${formatDate(weekEnd)}，本周 ${formatted} Token`,
    }
  }
  if (mode === 'total') {
    return {
      heading: formatDate(cell.date),
      detail: `累计 ${formatted} Token`,
      ariaLabel: `截至${formatDate(cell.date)}，累计 ${formatted} Token`,
    }
  }
  return {
    heading: formatDate(cell.date),
    detail: `使用了 ${formatted} 个 Token`,
    ariaLabel: `${formatDate(cell.date)}，使用了 ${formatted} 个 Token`,
  }
}

export function buildProfileActivity(
  days: UsageDayLike[] = [],
  mode: ProfileActivityMode = 'daily',
  now: Date = new Date(),
  formatValue: (value: number) => string = (value) => Math.round(value).toLocaleString('zh-CN'),
): ProfileActivityResult {
  const byDay = new Map<string, number>()
  for (const row of days) {
    const parsed = parseDayKey(String(row?.day || ''))
    if (!parsed) continue
    byDay.set(localDayKey(parsed), safeTokenCount(row?.tokens))
  }

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(today.getDate() - today.getDay() - ((PROFILE_ACTIVITY_WEEKS - 1) * 7))

  const rawCells: Array<{
    day: string
    date: Date
    value: number
    week: number
    row: number
    index: number
    future: boolean
  }> = []
  for (let index = 0; index < PROFILE_ACTIVITY_DAYS; index += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const day = localDayKey(date)
    rawCells.push({
      day,
      date,
      value: byDay.get(day) || 0,
      week: Math.floor(index / 7),
      row: index % 7,
      index,
      future: date.getTime() > today.getTime(),
    })
  }

  const weekTotals = new Map<number, number>()
  for (const cell of rawCells) {
    weekTotals.set(cell.week, (weekTotals.get(cell.week) || 0) + cell.value)
  }

  let running = 0
  const modeValues = rawCells.map((cell) => {
    if (mode === 'weekly') return weekTotals.get(cell.week) || 0
    if (mode === 'total') {
      running += cell.value
      return running
    }
    return cell.value
  })
  const maxValue = Math.max(1, ...modeValues)

  const cells = rawCells.map((cell, index) => {
    const value = modeValues[index] ?? 0
    const weekStart = rawCells[cell.week * 7]?.date ?? cell.date
    const weekEnd = rawCells[Math.min((cell.week * 7) + 6, rawCells.length - 1)]?.date ?? cell.date
    return {
      day: cell.day,
      value,
      level: cell.future ? 0 : activityLevel(value, maxValue),
      week: cell.week,
      row: cell.row,
      index: cell.index,
      future: cell.future,
      ...activityCopy(cell, mode, weekStart, weekEnd, value, formatValue),
    }
  })

  const months: Array<{ label: string; index: number }> = []
  let lastMonth = ''
  for (const cell of rawCells) {
    if (cell.future) continue
    const month = `${cell.date.getFullYear()}-${cell.date.getMonth()}`
    if (month !== lastMonth && cell.date.getDate() <= 7) {
      months.push({ label: `${cell.date.getMonth() + 1}月`, index: cell.week })
      lastMonth = month
    }
  }

  return { cells, months: months.slice(-13) }
}
