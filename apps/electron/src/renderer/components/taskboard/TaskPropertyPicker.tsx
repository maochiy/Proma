/**
 * TaskPropertyPicker — 属性下拉选择器（Portal 版）
 *
 * 从 dashi TaskPropertyPicker.tsx 移植：
 * - trigger 按钮 + portal 弹出的 listbox
 * - 自动判断向上/向下展开，贴近屏幕边缘时收拢
 * - 点击外部 / Escape / resize / scroll 关闭
 * - 打开时自动聚焦已选项
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TaskPropertyOption<Value extends string> {
  value: Value
  label: string
  icon: React.ReactNode
  className?: string
}

interface TaskPropertyPickerProps<Value extends string> {
  value: Value
  options: readonly TaskPropertyOption<Value>[]
  open: boolean
  disabled?: boolean
  className?: string
  triggerClassName: string
  ariaLabel: string
  title?: string
  onOpenChange: (open: boolean) => void
  onChange: (value: Value) => void
}

export function TaskPropertyPicker<Value extends string>({
  value, options, open, disabled = false, className = '', triggerClassName,
  ariaLabel, title, onOpenChange, onChange,
}: TaskPropertyPickerProps<Value>): React.ReactElement {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [position, setPosition] = React.useState({ left: 0, top: 0 })
  const selected = options.find((option) => option.value === value) ?? options[0]
  const selectedLabel = selected?.label ?? value
  const portalTarget = triggerRef.current?.closest('dialog') ?? document.body

  React.useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return
    const triggerRect = trigger.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const gap = 4
    const edge = 8
    const openAbove = triggerRect.bottom + gap + menuRect.height > window.innerHeight - edge
      && triggerRect.top - gap - menuRect.height >= edge
    const left = Math.max(edge, Math.min(triggerRect.left, window.innerWidth - menuRect.width - edge))
    const top = openAbove ? triggerRect.top - menuRect.height - gap : triggerRect.bottom + gap
    setPosition({ left, top: Math.max(edge, top) })
  }, [open])

  React.useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>("[aria-selected='true']")
        ?.focus({ preventScroll: true })
    })

    function closeFromOutside(event: PointerEvent): void {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        onOpenChange(false)
      }
    }
    function closeFromEscape(event: globalThis.KeyboardEvent): void {
      if (event.key !== 'Escape') return
      onOpenChange(false)
      triggerRef.current?.focus()
    }
    function closeFromViewportChange(): void {
      onOpenChange(false)
    }

    document.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('keydown', closeFromEscape)
    window.addEventListener('resize', closeFromViewportChange)
    window.addEventListener('scroll', closeFromViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      window.removeEventListener('keydown', closeFromEscape)
      window.removeEventListener('resize', closeFromViewportChange)
      window.removeEventListener('scroll', closeFromViewportChange, true)
    }
  }, [onOpenChange, open])

  const menu = open ? createPortal(
    <div
      ref={menuRef}
      role="listbox"
      aria-label={ariaLabel}
      style={{ position: 'fixed', left: position.left, top: position.top }}
      className="z-[500] min-w-[140px] rounded-lg border border-border/70 bg-popover p-1 shadow-xl"
    >
      {options.map((option) => (
        <button
          type="button"
          role="option"
          aria-selected={option.value === value}
          key={option.value}
          onClick={() => {
            onOpenChange(false)
            if (option.value !== value) onChange(option.value)
          }}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-popover-foreground/85',
            'hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:bg-accent',
            option.value === value && 'font-medium',
            option.className,
          )}
        >
          <span className="inline-flex w-4 items-center justify-center">{option.icon}</span>
          <span className="flex-1">{option.label}</span>
          {option.value === value && <Check size={13} className="text-primary" />}
        </button>
      ))}
    </div>,
    portalTarget,
  ) : null

  return (
    <div ref={rootRef} className={className}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={() => onOpenChange(!open)}
      >
        {selected?.icon}
        <span>{selectedLabel}</span>
      </button>
      {menu}
    </div>
  )
}
