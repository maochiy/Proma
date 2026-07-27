/**
 * AgentProjectPicker — 输入区上方的项目入口。
 *
 * 项目属于 Agent 会话运行上下文，因此显示在输入框外层，而不是塞进工具栏。
 * 使用非模态 Popover，保持与桌面代码 Agent 的轻量交互一致。
 */

import * as React from 'react'
import { Check, ChevronDown, FolderOpen, Loader2, Plus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  resolveAgentProjectPickerLabel,
  splitAgentProjectPickerItems,
} from '@/lib/agent-project-picker'
import type { AgentWorkspace } from '@proma/shared'

interface AgentProjectPickerProps {
  workspaces: AgentWorkspace[]
  workspaceId: string | null
  changing?: boolean
  disabled?: boolean
  disabledReason?: string
  onSelect: (workspaceId: string) => void | Promise<void>
  onCreate: (name: string) => Promise<boolean>
}

export function AgentProjectPicker({
  workspaces,
  workspaceId,
  changing = false,
  disabled = false,
  disabledReason,
  onSelect,
  onCreate,
}: AgentProjectPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [projectName, setProjectName] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const createInputRef = React.useRef<HTMLInputElement>(null)
  const { defaultWorkspace, projects } = React.useMemo(
    () => splitAgentProjectPickerItems(workspaces),
    [workspaces],
  )
  const currentLabel = resolveAgentProjectPickerLabel(workspaces, workspaceId)

  const handleSelect = (targetWorkspaceId: string): void => {
    if (targetWorkspaceId === workspaceId || changing || submitting) {
      setOpen(false)
      return
    }
    setOpen(false)
    void onSelect(targetWorkspaceId)
  }

  const handleStartCreate = (): void => {
    setCreating(true)
    setProjectName('')
    requestAnimationFrame(() => createInputRef.current?.focus())
  }

  const handleCancelCreate = (): void => {
    if (submitting) return
    setCreating(false)
    setProjectName('')
  }

  const handleCreate = async (): Promise<void> => {
    const name = projectName.trim()
    if (!name || submitting) return

    setSubmitting(true)
    try {
      const created = await onCreate(name)
      if (!created) return
      setCreating(false)
      setProjectName('')
      setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      void handleCreate()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelCreate()
    }
  }

  return (
    <div className="mb-2 flex min-w-0 items-center px-0.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled || changing}
            title={disabled && disabledReason ? disabledReason : undefined}
            aria-label={`当前项目：${currentLabel}`}
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
            <span className="min-w-0 truncate">{currentLabel}</span>
            <ChevronDown className="size-3 shrink-0 text-foreground/40" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-[260px] p-1.5"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">选择项目</span>
            <button
              type="button"
              disabled={changing || submitting}
              onClick={handleStartCreate}
              className={cn(
                'flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors',
                'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <Plus className="size-3" />
              新建项目
            </button>
          </div>

          {creating && (
            <div className="mb-1.5 rounded-lg bg-muted/55 p-2">
              <div className="flex items-center gap-2">
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                <input
                  ref={createInputRef}
                  value={projectName}
                  disabled={submitting}
                  maxLength={50}
                  placeholder="输入项目名称"
                  aria-label="项目名称"
                  onChange={(event) => setProjectName(event.target.value)}
                  onKeyDown={handleCreateKeyDown}
                  className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/65"
                />
                <button
                  type="button"
                  disabled={!projectName.trim() || submitting}
                  onClick={() => void handleCreate()}
                  className="flex h-7 items-center rounded-md bg-foreground px-2.5 text-xs text-background transition-opacity disabled:opacity-40"
                >
                  {submitting ? <Loader2 className="size-3.5 animate-spin" /> : '创建'}
                </button>
              </div>
            </div>
          )}

          {projects.length > 0 ? (
            <div className="max-h-64 overflow-y-auto scrollbar-thin">
              {projects.map((workspace) => {
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
          ) : (
            <div className="rounded-md px-2 py-3 text-xs leading-5 text-muted-foreground">
              还没有项目，可以新建项目或继续使用默认工作区。
            </div>
          )}

          {defaultWorkspace && (
            <>
              <div className="mx-1 my-1 h-px bg-border/60" />
              <button
                type="button"
                onClick={() => handleSelect(defaultWorkspace.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                  defaultWorkspace.id === workspaceId && 'bg-accent/75',
                )}
              >
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">默认工作区</span>
                {defaultWorkspace.id === workspaceId && (
                  <Check className="size-3.5 shrink-0 text-foreground/65" />
                )}
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
