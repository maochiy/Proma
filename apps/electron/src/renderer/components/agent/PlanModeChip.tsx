import { Lightbulb, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PlanModeChipProps {
  onClose: () => void
}

/**
 * 独立计划模式 Chip。
 *
 * 默认显示灯泡，hover 时在相同位置替换为关闭图标，避免输入区工具栏抖动。
 */
export function PlanModeChip({ onClose }: PlanModeChipProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-label="关闭计划模式"
      onClick={onClose}
      className={cn(
        'group flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs',
        'bg-muted/45 text-muted-foreground transition-colors',
        'hover:bg-muted/70 hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
    >
      <span className="relative size-3.5 shrink-0">
        <Lightbulb className="absolute inset-0 size-3.5 transition-opacity group-hover:opacity-0" />
        <X className="absolute inset-0 size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span>计划</span>
    </button>
  )
}
