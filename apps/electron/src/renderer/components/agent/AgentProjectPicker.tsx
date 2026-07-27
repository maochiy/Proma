/**
 * AgentProjectPicker — 输入区上方的项目入口。
 *
 * 项目属于 Agent 会话运行上下文，因此显示在输入框外层，而不是塞进工具栏。
 * 使用非模态 Popover，保持与桌面代码 Agent 的轻量交互一致。
 */

import * as React from 'react'
import { Check, ChevronDown, FolderOpen, Laptop, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { AgentWorkspace } from '@proma/shared'

interface AgentProjectPickerProps {
  workspaces: AgentWorkspace[]
  workspaceId: string | null
  changing?: boolean
  disabled?: boolean
  disabledReason?: string
  onSelect: (workspaceId: string) => void | Promise<void>
}

export function AgentProjectPicker({
  workspaces,
  workspaceId,
  changing = false,
  disabled = false,
  disabledReason,
  onSelect,
}: AgentProjectPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const currentWorkspace = workspaces.find((workspace) => workspace.id === workspaceId)

  const handleSelect = (targetWorkspaceId: string): void => {
    if (targetWorkspaceId === workspaceId || changing) {
      setOpen(false)
      return
    }
    setOpen(false)
    void onSelect(targetWorkspaceId)
  }

  return (
    <div className="mb-2 flex min-w-0 items-center gap-1.5 px-0.5">
      <div className="flex h-7 items-center gap-1.5 rounded-md bg-muted/55 px-2 text-xs text-foreground/60">
        <Laptop className="size-3.5" />
        <span>本地</span>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled || changing}
            title={disabled && disabledReason ? disabledReason : undefined}
            aria-label={`当前项目：${currentWorkspace?.name ?? '未选择'}`}
            aria-expanded={open}
            className={cn(
              'flex h-7 min-w-0 max-w-[260px] items-center gap-1.5 rounded-md bg-muted/55 px-2 text-xs text-foreground/70 transition-colors',
              'hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45',
              'disabled:cursor-not-allowed disabled:opacity-55',
            )}
          >
            {changing ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            ) : (
              <FolderOpen className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 truncate">{currentWorkspace?.name ?? '选择项目'}</span>
            <ChevronDown className="size-3 shrink-0 text-foreground/40" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-[260px] p-1.5"
        >
          <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
            项目
          </div>
          <div className="max-h-64 overflow-y-auto scrollbar-thin">
            {workspaces.map((workspace) => {
              const selected = workspace.id === workspaceId
              return (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => handleSelect(workspace.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                    selected && 'bg-accent/75',
                  )}
                >
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  {selected && <Check className="size-3.5 shrink-0 text-foreground/65" />}
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
