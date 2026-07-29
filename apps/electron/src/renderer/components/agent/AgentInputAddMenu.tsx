import * as React from 'react'
import { Check, FilePlus2, Lightbulb, Plus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface AgentInputAddMenuProps {
  onAttachFile: () => void
  planModeEnabled: boolean
  onPlanModeChange: (enabled: boolean) => void
}

interface AddMenuItemProps {
  icon: React.ReactNode
  label: string
  description: string
  onClick: () => void
  selected?: boolean
}

function AddMenuItem({
  icon,
  label,
  description,
  onClick,
  selected = false,
}: AddMenuItemProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left',
        'transition-colors hover:bg-accent/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-foreground/70">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      {selected && <Check className="size-4 shrink-0 text-foreground/60" />}
    </button>
  )
}

export function AgentInputAddMenu({
  onAttachFile,
  planModeEnabled,
  onPlanModeChange,
}: AgentInputAddMenuProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)

  const runAction = (action: () => void): void => {
    setOpen(false)
    requestAnimationFrame(action)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="添加内容"
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/60',
            'transition-colors hover:bg-muted/55 hover:text-foreground',
            'data-[state=open]:bg-muted/55 data-[state=open]:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          )}
        >
          <Plus className="size-[18px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-64 rounded-xl p-1.5"
        onOpenAutoFocus={event => event.preventDefault()}
      >
        <AddMenuItem
          icon={<FilePlus2 className="size-4" />}
          label="添加附件"
          description="选择文件或图片随消息发送"
          onClick={() => runAction(onAttachFile)}
        />
        <AddMenuItem
          icon={<Lightbulb className="size-4" />}
          label="计划"
          description="先制定计划，不直接执行改动"
          selected={planModeEnabled}
          onClick={() => runAction(() => onPlanModeChange(!planModeEnabled))}
        />
      </PopoverContent>
    </Popover>
  )
}
