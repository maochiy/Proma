import * as React from 'react'
import type { AgentRuntimeModelInfo, ThinkingEffortLevel } from '@proma/shared'
import { cn } from '@/lib/utils'

const EFFORT_LABELS: Record<ThinkingEffortLevel, string> = {
  low: '轻度',
  medium: '标准',
  high: '高级',
  xhigh: '深度',
  max: '最大',
}

export function formatRuntimeContextWindow(contextWindow: number): string {
  if (contextWindow >= 1_000_000) {
    const millions = contextWindow / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  if (contextWindow >= 1_000) {
    const thousands = contextWindow / 1_000
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`
  }
  return String(contextWindow)
}

export function buildRuntimeCapabilityLabels(
  model: AgentRuntimeModelInfo,
): string[] {
  const labels = [`${formatRuntimeContextWindow(model.contextWindow)} 上下文`]
  if (model.supportsEffort && model.supportedEffortLevels.length > 0) {
    labels.push(
      `思考 ${model.supportedEffortLevels.map(level => EFFORT_LABELS[level]).join('/')}`,
    )
  }
  if (model.supportsAdaptiveThinking) labels.push('Adaptive')
  if (model.supportsFastMode) labels.push('Fast')
  if (model.supportsAutoMode) labels.push('Auto')
  return labels
}

interface RuntimeModelCapabilitySummaryProps {
  model?: AgentRuntimeModelInfo
  className?: string
  compact?: boolean
}

/** 仅展示 CCB Runtime 实际返回的模型能力，不根据模型名称猜测。 */
export function RuntimeModelCapabilitySummary({
  model,
  className,
  compact = false,
}: RuntimeModelCapabilitySummaryProps): React.ReactElement | null {
  if (!model) return null

  if (compact) {
    const details = [`${formatRuntimeContextWindow(model.contextWindow)} 上下文`]
    if (model.supportsEffort && model.supportedEffortLevels.length > 0) {
      details.push(`${model.supportedEffortLevels.length} 档思考`)
    }
    return (
      <p className={cn('mt-0.5 truncate text-[10px] text-muted-foreground/70', className)}>
        {details.join(' · ')}
      </p>
    )
  }

  return (
    <div className={cn('mt-1 flex min-w-0 flex-wrap items-center gap-1', className)}>
      {buildRuntimeCapabilityLabels(model).map(label => (
        <span
          key={label}
          className={cn(
            'rounded-md bg-muted/70 px-1.5 py-0.5 text-muted-foreground',
            'text-[10px] leading-4',
          )}
        >
          {label}
        </span>
      ))}
    </div>
  )
}
