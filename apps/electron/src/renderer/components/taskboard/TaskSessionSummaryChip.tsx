/**
 * TaskSessionSummaryChip — 任务卡片上的会话摘要角标
 *
 * 处理中 / 受阻且有绑定会话的任务，在卡片底部展示一行摘要：
 * - 处理中：最新进度（最后 assistant 文本）
 * - 受阻：阻塞原因摘要
 * 懒加载，避免大量卡片同时阻塞。
 */

import * as React from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTaskSessionSummary } from '@/hooks/useTaskSessionSummary'

export function TaskSessionSummaryChip({
  threadId, status,
}: {
  threadId: string
  status: 'in_progress' | 'blocked'
}): React.ReactElement {
  const { summary, loading, running } = useTaskSessionSummary(threadId, status === 'blocked' ? 'blocked' : 'progress')

  return (
    <div
      className="pointer-events-none relative z-10 mt-0.5 flex items-start gap-1.5"
      title={status === 'blocked' ? '阻塞原因' : '最新进度'}
    >
      <span className={cn(
        'mt-0.5 size-1.5 shrink-0 rounded-full',
        status === 'blocked' ? 'bg-red-500' : (running ? 'animate-pulse bg-blue-500' : 'bg-blue-400'),
      )} aria-hidden="true" />
      <span className="line-clamp-2 text-[11px] leading-snug text-foreground/55">
        {loading ? (
          <span className="inline-flex items-center gap-1 text-foreground/40">
            <LoaderCircle size={10} className="animate-spin" /> 读取中…
          </span>
        ) : summary ? (
          summary
        ) : (
          <span className="text-foreground/35">暂无会话摘要</span>
        )}
      </span>
    </div>
  )
}
