import * as React from 'react'
import { cn } from '@/lib/utils'
import type { AgentEventUsage } from '@proma/shared'
import type { AgentTurnStatus } from '@/lib/agent-turn-status'
import { AgentTurnStatusLine } from './AgentTurnStatusLine'

interface AgentTurnActivityGroupProps {
  model?: string
  status: AgentTurnStatus
  durationMs?: number
  usage?: AgentEventUsage
  messageCount?: number
  collapsible: boolean
  expanded: boolean
  onToggle: () => void
  running?: boolean
  labelOverride?: string
  children: React.ReactNode
}

const COLLAPSE_DURATION_MS = 480

export function AgentTurnActivityGroup({
  model,
  status,
  durationMs,
  usage,
  messageCount,
  collapsible,
  expanded,
  onToggle,
  running,
  labelOverride,
  children,
}: AgentTurnActivityGroupProps): React.ReactElement {
  const [renderContent, setRenderContent] = React.useState(expanded)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [height, setHeight] = React.useState<number | undefined>()

  React.useLayoutEffect(() => {
    if (expanded) {
      setRenderContent(true)
      setHeight(undefined)
      return
    }
    const element = contentRef.current
    if (element) {
      setHeight(element.scrollHeight)
      requestAnimationFrame(() => setHeight(0))
    }
    const timer = window.setTimeout(() => setRenderContent(false), COLLAPSE_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [expanded])

  return (
    <div className="space-y-1.5">
      <AgentTurnStatusLine
        model={model}
        status={status}
        durationMs={durationMs}
        usage={usage}
        messageCount={messageCount}
        collapsible={collapsible}
        expanded={expanded}
        onToggle={onToggle}
        running={running}
        labelOverride={labelOverride}
      />
      {renderContent && (
        <div
          ref={contentRef}
          className={cn(
            'ml-7 space-y-2 overflow-hidden transition-[height,opacity] ease-out',
            expanded ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            height: height == null ? 'auto' : `${height}px`,
            transitionDuration: `${COLLAPSE_DURATION_MS}ms`,
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
