import * as React from 'react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

interface AgentRunningIndicatorProps {
  startedAt?: number
  className?: string
}

function formatRunningTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds.toFixed(1)}s`
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
    const timer = window.setInterval(update, 100)
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
