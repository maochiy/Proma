/** 自动更新检查时间策略。 */
export const UPDATE_CHECK_SCHEDULE = {
  /** 应用启动后的首次检查延迟。 */
  initialDelayMs: 10_000,
  /** 常驻运行期间的定时检查间隔。 */
  periodicIntervalMs: 60 * 60 * 1000,
  /** 窗口显示、聚焦或系统唤醒触发检查时的最小间隔。 */
  activationThrottleMs: 10 * 60 * 1000,
  /** 检查或下载失败后的重试延迟。 */
  retryDelayMs: 5 * 60 * 1000,
  /** 每轮常规检查失败后最多进行一次快速重试，避免断网时持续请求。 */
  maxQuickRetries: 1,
} as const

/**
 * 判断应用重新活跃时是否需要检查更新。
 *
 * 首次检查由独立的启动定时器负责；在首次检查前，窗口显示和聚焦不会提前触发。
 */
export function shouldCheckForUpdatesAfterActivation(
  lastCheckStartedAt: number | null,
  now: number,
): boolean {
  if (lastCheckStartedAt === null) return false
  return now - lastCheckStartedAt >= UPDATE_CHECK_SCHEDULE.activationThrottleMs
}

/** 判断当前失败周期是否还能安排一次快速重试。 */
export function canScheduleQuickUpdateRetry(
  schedulerActive: boolean,
  quickRetryCount: number,
): boolean {
  return schedulerActive && quickRetryCount < UPDATE_CHECK_SCHEDULE.maxQuickRetries
}
