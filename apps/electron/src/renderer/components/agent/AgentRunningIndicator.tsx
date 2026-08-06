import * as React from 'react'
import type { SDKContentBlock } from '@proma/shared'
import type { AgentTurnStatus } from '@/lib/agent-turn-status'
import { cn } from '@/lib/utils'
import { AgentTurnStatusLine } from './AgentTurnStatusLine'
import { ContentBlock } from './ContentBlock'

interface AgentRunningIndicatorProps {
  startedAt?: number
  model?: string
  status?: AgentTurnStatus
  className?: string
}

/**
 * 主会话与子智能体详情共用的运行态占位。
 *
 * 开局尚无 assistant 内容时：
 * - <1s：顶栏「正在思考」
 * - ≥1s：顶栏「已处理 N 秒」
 * - 下方始终保留「正在思考」活动行（无思考正文则无折叠箭头）
 */
export function AgentRunningIndicator({
  startedAt,
  model,
  status,
  className,
}: AgentRunningIndicatorProps): React.ReactElement {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (startedAt == null) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  const elapsedMs = startedAt == null ? 0 : Math.max(0, now - startedAt)
  const showProcessedLabel = elapsedMs >= 1_000
  const processingLabel = showProcessedLabel
    ? `已处理 ${Math.max(1, Math.round(elapsedMs / 1_000))} 秒`
    : '正在思考'
  // 外部传入明确 status 时沿用（如子智能体工具态）；否则按耗时走顶栏文案
  const statusLineStatus = status ?? (showProcessedLabel ? 'completed' : 'thinking')
  const emptyThinkingBlock = {
    type: 'thinking',
    thinking: '',
  } as SDKContentBlock

  return (
    <div
      className={cn(
        // 纯淡入，不做 max-height 撑开，避免开局「正在思考」上下跳
        'agent-activity-fade-in space-y-1',
        className,
      )}
    >
      <AgentTurnStatusLine
        model={model}
        status={statusLineStatus}
        labelOverride={status ? undefined : processingLabel}
        running
      />
      {/* 无正文/无工具时仍要显示「正在思考」行，避免顶栏变「已处理」后只剩状态条 */}
      <div className="ml-7">
        <ContentBlock
          block={emptyThinkingBlock}
          allMessages={[]}
          activityRunning
          activityItem
          isStreaming
        />
      </div>
    </div>
  )
}
