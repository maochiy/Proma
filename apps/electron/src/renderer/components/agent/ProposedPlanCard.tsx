import * as React from 'react'
import { ChevronRight, PanelRightOpen } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { MessageResponse } from '@/components/ai-elements/message'
import { openAgentSidePanelTabAtom } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'

interface ProposedPlanCardProps {
  content: string
  sessionId?: string
  /** 流式生成中：标题显示"编写计划"并使用运行态样式 */
  streaming?: boolean
}

/**
 * 与整轮活动折叠相互独立的 Markdown 计划卡。
 *
 * 规则文档第 7.8 节：预览区域使用有限高度（头部约 40px + 正文约 160px ≈ 200px），
 * 超出部分底部渐隐遮罩提示还有更多内容；流式时标题为"编写计划"，完成后为"计划"。
 */
export function ProposedPlanCard({
  content,
  sessionId,
  streaming = false,
}: ProposedPlanCardProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(true)
  const openSidePanelTab = useSetAtom(openAgentSidePanelTabAtom)

  return (
    <section className="overflow-hidden rounded-xl bg-muted/35 shadow-sm">
      <div className="flex min-h-10 items-center gap-2 px-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setExpanded((previous) => !previous)}
          aria-expanded={expanded}
        >
          <ChevronRight className={cn(
            'size-3.5 text-muted-foreground transition-transform',
            expanded && 'rotate-90',
          )} />
          <span className={cn(
            'text-sm font-medium',
            streaming && 'agent-status-shimmer',
          )}>
            {streaming ? '编写计划' : '计划'}
          </span>
        </button>
        {sessionId && (
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => openSidePanelTab({ sessionId, tab: 'plan' })}
            title="打开计划"
          >
            <PanelRightOpen className="size-3.5" />
          </button>
        )}
      </div>
      {expanded && (
        <div className="relative max-h-[160px] overflow-y-auto border-t border-border/30 px-3 py-2.5">
          <MessageResponse>{content}</MessageResponse>
          {/* 底部渐隐遮罩：内容超出预览高度时提示还有更多内容 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-muted/35 to-transparent" aria-hidden="true" />
        </div>
      )}
    </section>
  )
}
