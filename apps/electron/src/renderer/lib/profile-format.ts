/**
 * 个人资料页数字 / 时长格式化
 */

function trimDecimal(value: number, digits: number): string {
  const factor = 10 ** digits
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor
  if (Number.isInteger(rounded)) return String(rounded)
  return String(rounded)
}

/** 中文约数：达到 1 亿用亿，否则达到 1 万用万。例：6.61亿 / 3900万 / 1,280 */
export function formatChineseApproxNumber(value: number): string {
  const next = Number(value || 0)
  if (!Number.isFinite(next) || next <= 0) return '0'
  if (next >= 100_000_000) {
    const yi = next / 100_000_000
    return `${trimDecimal(yi, yi >= 10 ? 1 : 2)}亿`
  }
  if (next >= 10_000) {
    const wan = next / 10_000
    const digits = wan >= 100 ? 0 : wan >= 10 ? 1 : 2
    return `${trimDecimal(wan, digits)}万`
  }
  return Math.round(next).toLocaleString('zh-CN')
}

/** 百分比，保留 0 位或 1 位 */
export function formatPercent(value: number): string {
  const ratio = Number.isFinite(value) ? Math.max(0, value) : 0
  const percent = ratio * 100
  if (percent >= 99.5) return '100%'
  if (percent >= 10) return `${percent.toFixed(0)}%`
  if (percent <= 0) return '0%'
  return `${percent.toFixed(1)}%`
}

/** 11小时 5分 / 15天 / 0分 */
export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.max(0, Math.round((ms || 0) / 60_000))
  if (totalMinutes <= 0) return '0分'
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? `${days}天 ${hours}小时` : `${days}天`
  if (hours > 0) return minutes > 0 ? `${hours}小时 ${minutes}分` : `${hours}小时`
  return `${minutes}分`
}

export function formatDayCount(value: number): string {
  return `${Math.max(0, Math.round(value || 0))}天`
}

export function toProfileHandle(userName: string): string {
  const slug = userName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w\u4e00-\u9fff-]/g, '')
  return `@${slug || 'proma'}`
}

export function toProfileInitials(userName: string): string {
  const trimmed = userName.trim()
  if (!trimmed) return 'PR'
  if (/[\u4e00-\u9fff]/.test(trimmed[0] || '')) return trimmed.slice(0, 1)
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase()
  }
  return trimmed.slice(0, 2).toUpperCase()
}

export function isImageAvatar(avatar: string): boolean {
  return avatar.startsWith('data:image') || avatar.startsWith('http')
}
