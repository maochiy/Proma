import { describe, expect, test } from 'bun:test'
import {
  UPDATE_CHECK_SCHEDULE,
  canScheduleQuickUpdateRetry,
  shouldCheckForUpdatesAfterActivation,
} from './update-check-schedule'

describe('自动更新检查时间策略', () => {
  test('Given 应用启动 When 初始化自动更新 Then 10 秒后首次检查且每小时定时检查', () => {
    expect(UPDATE_CHECK_SCHEDULE.initialDelayMs).toBe(10_000)
    expect(UPDATE_CHECK_SCHEDULE.periodicIntervalMs).toBe(60 * 60 * 1000)
  })

  test('Given 应用重新显示或聚焦 When 距离上次检查不足 10 分钟 Then 不重复检查', () => {
    const lastCheckStartedAt = 1_000

    expect(shouldCheckForUpdatesAfterActivation(
      lastCheckStartedAt,
      lastCheckStartedAt + UPDATE_CHECK_SCHEDULE.activationThrottleMs - 1,
    )).toBe(false)
  })

  test('Given 应用重新显示或聚焦 When 距离上次检查达到 10 分钟 Then 立即检查', () => {
    const lastCheckStartedAt = 1_000

    expect(shouldCheckForUpdatesAfterActivation(
      lastCheckStartedAt,
      lastCheckStartedAt + UPDATE_CHECK_SCHEDULE.activationThrottleMs,
    )).toBe(true)
  })

  test('Given 自动检查失败 When 安排重试 Then 5 分钟后再次检查', () => {
    expect(UPDATE_CHECK_SCHEDULE.retryDelayMs).toBe(5 * 60 * 1000)
    expect(UPDATE_CHECK_SCHEDULE.maxQuickRetries).toBe(1)
    expect(canScheduleQuickUpdateRetry(true, 0)).toBe(true)
    expect(canScheduleQuickUpdateRetry(true, 1)).toBe(false)
  })

  test('Given 更新调度器已经清理 When 未完成的检查随后失败 Then 不再创建重试任务', () => {
    expect(canScheduleQuickUpdateRetry(false, 0)).toBe(false)
  })

  test('Given 首次启动检查尚未执行 When 窗口获得焦点 Then 保持 10 秒启动延迟', () => {
    expect(shouldCheckForUpdatesAfterActivation(null, Date.now())).toBe(false)
  })
})
