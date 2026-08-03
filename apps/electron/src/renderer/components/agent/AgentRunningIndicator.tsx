import * as React from 'react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

interface AgentRunningIndicatorProps {
  startedAt?: number
  className?: string
}

function formatRunningTime(seconds: number): string {
  // 秒级精度足够，避免 100ms 级 setState 在长会话中持续占用主线程。
  const wholeSeconds = Math.max(0, Math.floor(seconds))
  if (wholeSeconds < 60) return `${wholeSeconds}s`
  const minutes = Math.floor(wholeSeconds / 60)
  const remainingSeconds = wholeSeconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

/** 主会话与子智能体详情共用的 Agent 运行指示器。 */
export function AgentRunningIndicator({
  startedAt,
  className,
}: AgentRunningIndicatorProps): React.ReactElement {
  const [elapsed, setElapsed] = React.useState(0)

  React.useEffect(() => {
    const start = startedAt ?? Date.now()
    const update = (): void => setElapsed((Date.now() - start) / 1_000)
    update()
    const timer = window.setInterval(update, 1_000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  return (
    <div className={cn('flex min-h-[28px] items-center gap-2', className)}>
      <Spinner size="sm" className="text-primary/75" />
      <span className="text-[13px] font-light tabular-nums text-muted-foreground/75">
        Agent Running {formatRunningTime(elapsed)}
      </span>
    </div>
  )
}
