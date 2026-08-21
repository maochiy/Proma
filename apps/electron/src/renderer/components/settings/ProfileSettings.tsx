/**
 * ProfileSettings - 个人资料与用量统计
 *
 * 展示只读的用户资料、累计用量、Token 热力图和常用模型。
 * 姓名来自已有用户档案，本页不允许编辑。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useAtomValue } from 'jotai'
import { userProfileAtom } from '@/atoms/user-profile'
import { newApiAuthAtom } from '@/atoms/new-api-auth'
import { resolvedThemeAtom } from '@/atoms/theme'
import { buildProfileActivity, type ProfileActivityCell, type ProfileActivityMode } from '@/lib/profile-activity'
import {
  formatChineseApproxNumber,
  formatDayCount,
  formatDurationMs,
  isImageAvatar,
  toProfileHandle,
  toProfileInitials,
} from '@/lib/profile-format'
import { cn } from '@/lib/utils'
import type { UserUsageSummary } from '@/types/user-profile'

const EMPTY_USAGE_SUMMARY: UserUsageSummary = {
  checkedAt: 0,
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

const MODEL_COLORS = ['#f59e0b', '#8b5cf6', '#06b6d4', '#10b981', '#f43f5e', '#3b82f6', '#f97316']

function modelColor(modelId: string): string {
  let hash = 0
  for (const ch of modelId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return MODEL_COLORS[hash % MODEL_COLORS.length] ?? '#f59e0b'
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function ProfileSettings(): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)
  const newApiAuth = useAtomValue(newApiAuthAtom)
  const [summary, setSummary] = React.useState<UserUsageSummary>(EMPTY_USAGE_SUMMARY)
  const [loaded, setLoaded] = React.useState(false)
  const [activityMode, setActivityMode] = React.useState<ProfileActivityMode>('daily')

  React.useEffect(() => {
    let cancelled = false
    void window.electronAPI.getUserUsageSummary().then((data) => {
      if (cancelled) return
      setSummary(data)
      setLoaded(true)
    }).catch((error: unknown) => {
      console.error('[个人资料] 加载用量失败:', error)
      if (!cancelled) setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const activity = React.useMemo(
    () => buildProfileActivity(summary.days, activityMode, new Date(), formatChineseApproxNumber),
    [activityMode, summary.days],
  )
  const stats = summary.stats
  const displayName = userProfile.userName || '用户'
  const initials = toProfileInitials(displayName)
  const handle = toProfileHandle(displayName)
  const planLabel = newApiAuth.authenticated ? 'OpenSwitch' : '本地'
  const topModels = summary.models.slice(0, 5)
  const insightRows = [
    { label: '已探索的技能', value: String(stats.skillsExplored) },
    { label: '使用的技能总数', value: stats.skillUses.toLocaleString('zh-CN') },
    { label: 'Agent 会话', value: stats.agentSessionCount.toLocaleString('zh-CN') },
    { label: '聊天总数', value: (stats.agentSessionCount + stats.chatCount).toLocaleString('zh-CN') },
  ]

  return (
    <section className="relative mx-auto w-full max-w-[860px] space-y-10 pb-10">
      <header className="flex flex-col items-center pt-6 text-center">
        <div className="mb-4 flex size-[88px] items-center justify-center overflow-hidden rounded-full bg-[#f5a623] text-[28px] font-semibold text-white shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
          {isImageAvatar(userProfile.avatar) ? (
            <img src={userProfile.avatar} alt="" className="size-full object-cover" />
          ) : userProfile.avatar && userProfile.avatar !== '🧑‍💻' ? (
            <span className="text-[36px] leading-none">{userProfile.avatar}</span>
          ) : (
            initials
          )}
        </div>
        <h2 className="text-[26px] font-semibold tracking-tight text-foreground">{displayName}</h2>
        <p className="mt-1 flex items-center gap-2 text-[13px] text-muted-foreground">
          <span>{handle}</span>
          <span className="text-border">·</span>
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {planLabel}
          </span>
        </p>
      </header>

      <section
        className="grid grid-cols-5 overflow-hidden rounded-2xl border border-border/70 bg-background/40"
        aria-label="个人统计"
      >
        <StatCell value={formatChineseApproxNumber(stats.totalTokens)} label="累计 Token 数" />
        <StatCell value={formatChineseApproxNumber(stats.peakDayTokens)} label="峰值 Token 数" />
        <StatCell value={formatDurationMs(stats.longestChatDurationMs)} label="最长聊天时长" />
        <StatCell value={formatDayCount(stats.currentStreakDays)} label="当前连续天数" />
        <StatCell value={formatDayCount(stats.longestStreakDays)} label="最长连续天数" />
      </section>

      <TokenActivityHeatmap activity={activity} mode={activityMode} loaded={loaded} onModeChange={setActivityMode} />

      <section className="grid gap-12 md:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.1fr)]">
        <section>
          <h3 className="mb-4 text-[16px] font-semibold text-foreground">活动洞察</h3>
          <div className="space-y-0">
            {insightRows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-6 border-b border-border/50 py-3 last:border-b-0">
                <span className="text-[14px] text-muted-foreground">{row.label}</span>
                <strong className="text-[14px] font-semibold text-foreground">{row.value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-4 text-[16px] font-semibold text-foreground">最常用的模型</h3>
          {topModels.length > 0 ? (
            <div>
              {topModels.map((model) => (
                <div key={model.modelId} className="flex items-center gap-3 border-b border-border/50 py-3 last:border-b-0">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-white"
                    style={{ background: modelColor(model.modelId) }}
                  >
                    {(model.modelName || model.modelId).slice(0, 1).toUpperCase()}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground"
                    title={model.modelName || model.modelId}
                  >
                    {model.modelName || model.modelId}
                  </span>
                  <em className="shrink-0 text-right text-[13px] not-italic text-muted-foreground">
                    <span className="block font-medium text-foreground">
                      {formatChineseApproxNumber(model.tokens)} Token
                    </span>
                    <span className="block text-[12px]">
                      {model.requests.toLocaleString('zh-CN')} 次运行
                    </span>
                  </em>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">暂无模型使用记录。完成一次 Agent 对话后这里会开始累计。</p>
          )}
        </section>
      </section>
    </section>
  )
}

function StatCell({ value, label }: { value: string; label: string }): React.ReactElement {
  return (
    <div className="flex min-h-[84px] flex-col items-center justify-center gap-1 border-r border-border/60 px-2 py-3 last:border-r-0">
      <strong className="text-[18px] font-semibold leading-tight text-foreground sm:text-[20px]">{value}</strong>
      <span className="text-[12px] text-muted-foreground">{label}</span>
    </div>
  )
}

function TokenActivityHeatmap({
  activity,
  mode,
  loaded,
  onModeChange,
}: {
  activity: ReturnType<typeof buildProfileActivity>
  mode: ProfileActivityMode
  loaded: boolean
  onModeChange: (mode: ProfileActivityMode) => void
}): React.ReactElement {
  const theme = useAtomValue(resolvedThemeAtom)
  const [tooltip, setTooltip] = React.useState<{
    cell: ProfileActivityCell
    left: number
    top: number
    placement: 'above' | 'below'
  } | null>(null)
  const tooltipId = React.useId()
  const reduceMotion = prefersReducedMotion()

  const showTooltip = (cell: ProfileActivityCell, target: HTMLButtonElement): void => {
    const rect = target.getBoundingClientRect()
    const tooltipWidth = Math.min(216, Math.max(148, window.innerWidth - 24))
    const maxLeft = Math.max(12, window.innerWidth - tooltipWidth - 12)
    const left = Math.min(maxLeft, Math.max(12, rect.left + (rect.width / 2) - (tooltipWidth / 2)))
    const placement = cell.row <= 2 || rect.top <= 92 ? 'below' : 'above'
    setTooltip({
      cell,
      left,
      top: placement === 'above' ? rect.top - 9 : rect.bottom + 9,
      placement,
    })
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="text-[16px] font-semibold text-foreground">Token 活动</h3>
        <div className="flex rounded-lg p-0.5 text-[12px] text-muted-foreground" aria-label="Token 活动范围">
          {([
            ['daily', '每日'],
            ['weekly', '每周'],
            ['total', '累计'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              className={cn(
                'rounded-md px-2.5 py-1 transition-colors',
                mode === id ? 'bg-foreground/[0.08] font-medium text-foreground' : 'hover:text-foreground',
              )}
              onClick={() => onModeChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto pb-1" onScroll={() => setTooltip(null)}>
        <div
          className={cn('grid w-max justify-self-center gap-[4px]', loaded && 'is-loaded')}
          style={{ gridTemplateRows: 'repeat(7, 11px)', gridAutoFlow: 'column', gridAutoColumns: '11px' }}
          aria-label="Token 活动网格"
          aria-busy={!loaded}
        >
          {activity.cells.map((cell) => (
            <button
              key={cell.day}
              type="button"
              tabIndex={-1}
              aria-label={cell.ariaLabel}
              aria-describedby={tooltip?.cell.day === cell.day ? tooltipId : undefined}
              className={cn(
                'size-[11px] rounded-[3px] border-0 p-0 transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-none',
                cell.future && 'opacity-50',
              )}
              style={{
                background: heatmapLevelColor(cell.level, theme === 'dark'),
                animationDelay: reduceMotion ? '0ms' : `${Math.round(cell.index * 0.85)}ms`,
              }}
              onPointerEnter={(event) => showTooltip(cell, event.currentTarget)}
              onPointerLeave={() => setTooltip(null)}
              onFocus={(event) => showTooltip(cell, event.currentTarget)}
              onBlur={() => setTooltip(null)}
            />
          ))}
        </div>
        <div
          className="mt-3 grid w-max gap-[4px] text-[12px] text-muted-foreground"
          style={{ gridTemplateColumns: 'repeat(53, 11px)' }}
        >
          {activity.months.map((month) => (
            <span key={`${month.label}-${month.index}`} style={{ gridColumnStart: month.index + 1 }}>
              {month.label}
            </span>
          ))}
        </div>
      </div>
      {tooltip && createPortal(
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-[80] min-w-[148px] rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11.5px] text-white shadow-lg"
          style={{
            left: tooltip.left,
            top: tooltip.top,
            transform: tooltip.placement === 'above' ? 'translateY(-100%)' : undefined,
          }}
        >
          <div className="font-medium">{tooltip.cell.heading}</div>
          <div className="text-white/70">{tooltip.cell.detail}</div>
        </div>,
        document.body,
      )}
    </section>
  )
}

function heatmapLevelColor(level: number, dark: boolean): string {
  if (level >= 4) return dark ? '#5aa8e0' : '#2b7cc0'
  if (level >= 3) return dark ? '#3d7eb8' : '#5aa0d8'
  if (level >= 2) return dark ? '#2f5f86' : '#9fc8ec'
  if (level >= 1) return dark ? '#20354c' : '#d4e8f8'
  return dark ? '#242424' : '#eef1f4'
}
