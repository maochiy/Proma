/**
 * LabelPicker — 标签选择器（可搜索、可新建）
 *
 * 从 dashi LabelPicker.tsx 移植：
 * - 搜索过滤（按名称或展示名）
 * - 未匹配时提供「创建新标签」入口
 * - 点击外部 / Escape 关闭
 */

import * as React from 'react'
import { Check, Tag as LabelIcon, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { labelDisplayName, labelPresentation } from './taskboard-constants'

interface LabelPickerProps {
  availableLabels: string[]
  selectedLabels: string[]
  open: boolean
  disabled?: boolean
  className?: string
  triggerClassName: string
  showIcon?: boolean
  placeholder?: string
  triggerContent?: React.ReactNode
  onOpenChange: (open: boolean) => void
  onChange: (labels: string[]) => void
}

export function LabelPicker({
  availableLabels, selectedLabels, open, disabled = false, className = '',
  triggerClassName, showIcon = false, placeholder, triggerContent,
  onOpenChange, onChange,
}: LabelPickerProps): React.ReactElement {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [search, setSearch] = React.useState('')
  const normalizedSearch = search.trim()
  const filteredLabels = availableLabels.filter((label) => (
    !normalizedSearch
    || label.toLocaleLowerCase().includes(normalizedSearch.toLocaleLowerCase())
    || labelDisplayName(label).toLocaleLowerCase().includes(normalizedSearch.toLocaleLowerCase())
  ))
  const canCreateLabel = Boolean(normalizedSearch) && !availableLabels.some((label) => (
    label === normalizedSearch
    || labelDisplayName(label).toLocaleLowerCase() === normalizedSearch.toLocaleLowerCase()
  ))

  React.useEffect(() => {
    if (!open) {
      setSearch('')
      return
    }
    function closeFromOutside(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false)
    }
    function closeFromEscape(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') {
        onOpenChange(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('keydown', closeFromEscape)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      window.removeEventListener('keydown', closeFromEscape)
    }
  }, [onOpenChange, open])

  function toggleLabel(label: string): void {
    if (disabled) return
    onChange(selectedLabels.includes(label)
      ? selectedLabels.filter((item) => item !== label)
      : [...selectedLabels, label])
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        disabled={disabled}
        aria-label="选择或创建标签"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {triggerContent ?? (
          <>
            {showIcon && <LabelIcon size={12} />}
            <span>{selectedLabels.length > 0
              ? selectedLabels.map((label) => labelDisplayName(label)).join(', ')
              : (placeholder ?? '标签')}</span>
          </>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="选择或创建标签"
          className="absolute left-0 top-full z-[200] mt-1 w-56 rounded-lg border border-border/70 bg-popover p-1.5 shadow-xl"
        >
          <div className="relative mb-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="添加标签…"
              aria-label="搜索标签"
              className="w-full rounded-md border border-border/60 bg-background py-1 pl-7 pr-2 text-[12px] text-foreground outline-none focus:border-primary/50"
            />
          </div>
          <div role="listbox" aria-label="可用标签" aria-multiselectable="true" className="max-h-52 overflow-y-auto">
            {filteredLabels.map((label) => {
              const presentation = labelPresentation(label)
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedLabels.includes(label)}
                  disabled={disabled}
                  key={label}
                  onClick={() => toggleLabel(label)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-popover-foreground/85 hover:bg-accent"
                >
                  <i className="size-2.5 rounded-full" style={{ backgroundColor: presentation.color }} aria-hidden="true" />
                  <span className="flex-1">{presentation.name}</span>
                  {selectedLabels.includes(label) && <Check size={13} className="text-primary" />}
                </button>
              )
            })}
            {canCreateLabel && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  toggleLabel(normalizedSearch)
                  setSearch('')
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-popover-foreground/85 hover:bg-accent"
              >
                <i className="size-2.5 rounded-full" style={{ backgroundColor: labelPresentation(normalizedSearch).color }} aria-hidden="true" />
                <span>创建 “{normalizedSearch}”</span>
              </button>
            )}
            {filteredLabels.length === 0 && !canCreateLabel && (
              <div className="px-2 py-1.5 text-[12px] text-muted-foreground">暂无可用标签</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
