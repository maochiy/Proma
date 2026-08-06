/**
 * 会话 Git 分支菜单
 *
 * 支持搜索、滚动列表、点击切换 / 创建并检出。
 * 由悬浮面板与提交弹窗复用。
 */

import * as React from 'react'
import { Check, ChevronDown, GitBranch, Loader2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { GitBranchInfo } from '@proma/shared'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'

export interface SessionGitBranchMenuProps {
  dirPath: string | null
  sessionId: string
  currentBranch: string | null
  disabled?: boolean
  /** 切换成功后回调（含新分支名） */
  onBranchChanged?: (branch: string) => void
  /** 自定义触发器；默认渲染当前分支按钮 */
  trigger?: React.ReactNode
  /** 触发器额外 class */
  triggerClassName?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  /**
   * 嵌在 Dialog 内时传 false，保证列表可滚动，且不会被 Dialog 误判为外部点击。
   * 默认 true（Portal 到 body）。
   */
  portalled?: boolean
  /** 受控开关；用于外层 Dialog 处理“先关菜单再关弹窗” */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SessionGitBranchMenu({
  dirPath,
  sessionId,
  currentBranch,
  disabled = false,
  onBranchChanged,
  trigger,
  triggerClassName,
  align = 'end',
  side = 'bottom',
  portalled = true,
  open: openProp,
  onOpenChange,
}: SessionGitBranchMenuProps): React.ReactElement {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen
  const setOpen = React.useCallback((next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }, [isControlled, onOpenChange])

  const [loadingList, setLoadingList] = React.useState(false)
  const [switching, setSwitching] = React.useState(false)
  const [branches, setBranches] = React.useState<GitBranchInfo[]>([])
  const [query, setQuery] = React.useState('')
  const [activeBranch, setActiveBranch] = React.useState<string | null>(currentBranch)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setActiveBranch(currentBranch)
  }, [currentBranch])

  const loadBranches = React.useCallback(async () => {
    if (!dirPath) {
      setBranches([])
      return
    }
    setLoadingList(true)
    try {
      const result = await window.electronAPI.listGitBranches(dirPath, sessionId)
      setBranches(result.branches)
      if (result.currentBranch) {
        setActiveBranch(result.currentBranch)
      }
    } catch (error) {
      console.warn('[SessionGitBranchMenu] 加载分支失败', error)
      setBranches([])
      toast.error(error instanceof Error ? error.message : '加载分支列表失败')
    } finally {
      setLoadingList(false)
    }
  }, [dirPath, sessionId])

  React.useEffect(() => {
    if (!open) return
    void loadBranches()
    setQuery('')
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open, loadBranches])

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = React.useMemo(() => {
    if (!normalizedQuery) return branches
    return branches.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery))
  }, [branches, normalizedQuery])

  const exactMatch = React.useMemo(
    () => branches.some((branch) => branch.name === query.trim()),
    [branches, query],
  )
  const canCreate = query.trim().length > 0 && !exactMatch

  const switchBranch = React.useCallback(async (branch: string, create = false) => {
    if (!dirPath || switching) return
    if (branch === activeBranch && !create) {
      setOpen(false)
      return
    }

    // 先关闭弹层，在面板分支名上展示 loading
    setOpen(false)
    setSwitching(true)
    try {
      const result = await window.electronAPI.checkoutGitBranch({
        dirPath,
        branch,
        create,
        sessionId,
      })
      if (!result.ok) {
        toast.error(result.error || '切换分支失败')
        return
      }
      const nextBranch = result.branch || branch
      setActiveBranch(nextBranch)
      onBranchChanged?.(nextBranch)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换分支失败')
    } finally {
      setSwitching(false)
    }
  }, [activeBranch, dirPath, onBranchChanged, sessionId, setOpen, switching])

  const displayBranch = activeBranch ?? currentBranch ?? 'HEAD'
  const canOpen = Boolean(dirPath) && !disabled && !switching

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (switching) return
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild disabled={!canOpen}>
        {trigger ?? (
          <button
            type="button"
            disabled={!canOpen}
            className={cn(
              'flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left',
              'hover:bg-accent/55 disabled:cursor-not-allowed disabled:opacity-60',
              triggerClassName,
            )}
            aria-label="切换分支"
          >
            {switching ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
            ) : null}
            <span className="max-w-[140px] truncate text-[11px] text-muted-foreground">
              {switching ? '切换中…' : displayBranch}
            </span>
            {!switching && (
              <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" />
            )}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        portalled={portalled}
        // 固定高度结构：头部/底部不滚，中间列表可滚
        className="flex w-[260px] max-h-[min(320px,var(--radix-popover-content-available-height,320px))] flex-col overflow-hidden !rounded-[24px] p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onWheel={(event) => {
          // 避免被外层 Dialog / 滚动容器吞掉滚轮
          event.stopPropagation()
        }}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索分支"
            className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            disabled={switching}
          />
        </div>

        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
          onWheel={(event) => {
            event.stopPropagation()
          }}
        >
          {loadingList ? (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              加载分支…
            </div>
          ) : filtered.length === 0 && !canCreate ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              未找到匹配分支
            </div>
          ) : (
            <>
              {filtered.length > 0 && (
                <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  分支
                </div>
              )}
              {filtered.map((branch) => {
                const isCurrent = branch.current || branch.name === activeBranch
                return (
                  <button
                    key={branch.name}
                    type="button"
                    disabled={switching}
                    onClick={() => void switchBranch(branch.name, false)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs',
                      'hover:bg-accent/60 disabled:opacity-50',
                      isCurrent && 'bg-accent/35 font-medium',
                    )}
                  >
                    <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                    {isCurrent && <Check className="size-3.5 shrink-0 text-foreground" />}
                  </button>
                )
              })}
            </>
          )}
        </div>

        {canCreate && (
          <div className="shrink-0 border-t border-border/60 p-1">
            <button
              type="button"
              disabled={switching}
              onClick={() => void switchBranch(query.trim(), true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/60 disabled:opacity-50"
            >
              <Plus className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                创建并检出「{query.trim()}」
              </span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
