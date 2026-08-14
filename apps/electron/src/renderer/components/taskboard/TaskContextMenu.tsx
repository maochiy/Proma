/**
 * TaskContextMenu — 任务右键菜单（Portal 版）
 *
 * 从 dashi TaskContextMenu.tsx 移植：
 * - 状态 / 优先级 / 标签 子菜单（悬浮 300ms 或点击展开）
 * - 编辑 / 创建副本 / 复制子菜单 / 归档
 * - 键盘导航（方向键、Tab、Home/End、字母快捷方式、Esc）
 * - 自动贴近屏幕边缘，子菜单上下自动偏移
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  Archive, ChevronRight, Circle, Copy, Flag, Link2, Pencil, Tag, Trash2,
} from 'lucide-react'
import type { Task, TaskPriority, TaskStatus } from '@proma/shared'
import { cn } from '@/lib/utils'
import { PRIORITY_LABELS, PRIORITY_CHIP, STATUS_LABELS, STATUS_TONES, labelPresentation } from './taskboard-constants'

type SubmenuName = 'status' | 'priority' | 'labels' | 'copy'

interface TaskContextMenuProps {
  task: Task
  position: { x: number; y: number }
  labels: string[]
  onClose: () => void
  onEdit: (task: Task) => void
  onStatusChange: (task: Task, status: TaskStatus) => void
  onPriorityChange: (task: Task, priority: TaskPriority) => void
  onLabelsChange: (task: Task, labels: string[]) => void
  onDuplicate: (task: Task) => void
  onCopy: (text: string, message: string) => void
  onArchive: (task: Task) => void
}

interface MenuItemProps {
  label: string
  icon?: React.ReactNode
  shortcut?: string
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  submenu?: SubmenuName
  submenuOpen?: boolean
  rootShortcut?: string
  onPointerEnter?: () => void
  onClick?: () => void
  children?: React.ReactNode
}

function MenuItem({
  label, icon, shortcut, checked, danger, disabled, submenu, submenuOpen,
  rootShortcut, onPointerEnter, onClick, children,
}: MenuItemProps): React.ReactElement {
  return (
    <div className="context-menu-item-anchor">
      <button
        type="button"
        role={checked === undefined ? 'menuitem' : 'menuitemradio'}
        aria-checked={checked}
        aria-haspopup={submenu ? 'menu' : undefined}
        aria-expanded={submenu ? submenuOpen : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]',
          danger ? 'text-destructive hover:bg-destructive/10' : 'text-popover-foreground/85 hover:bg-accent hover:text-accent-foreground',
          disabled && 'opacity-50 pointer-events-none',
        )}
        disabled={disabled}
        data-submenu={submenu}
        data-root-shortcut={rootShortcut}
        data-open={submenuOpen ? 'true' : undefined}
        onPointerEnter={onPointerEnter}
        onClick={onClick}
      >
        <span className="inline-flex w-4 items-center justify-center">{icon}</span>
        <span className="flex-1">{label}</span>
        {shortcut && <span className="text-[11px] text-foreground/40">{shortcut}</span>}
        {checked && <ChevronRight size={12} className="opacity-0" />}
        {submenu && <ChevronRight size={13} className="text-foreground/40" />}
      </button>
      {children}
    </div>
  )
}

export function TaskContextMenu({
  task, position, labels, onClose, onEdit, onStatusChange, onPriorityChange,
  onLabelsChange, onDuplicate, onCopy, onArchive,
}: TaskContextMenuProps): React.ReactElement {
  const menuRef = React.useRef<HTMLDivElement>(null)
  const submenuTimerRef = React.useRef<number | null>(null)
  const [submenu, setSubmenu] = React.useState<SubmenuName | null>(null)
  const [placedPosition, setPlacedPosition] = React.useState(position)
  const [submenuSide, setSubmenuSide] = React.useState<'left' | 'right'>('right')
  const [submenuShift, setSubmenuShift] = React.useState(0)

  function closeThen(action: () => void): void {
    onClose()
    action()
  }

  function openSubmenu(name: SubmenuName, focus = false): void {
    if (submenuTimerRef.current !== null) window.clearTimeout(submenuTimerRef.current)
    setSubmenu(name)
    if (focus) {
      requestAnimationFrame(() => {
        menuRef.current
          ?.querySelector<HTMLElement>(`[data-submenu-panel="${name}"] .context-menu-item:not(:disabled)`)
          ?.focus()
      })
    }
  }

  function scheduleSubmenu(name: SubmenuName): void {
    if (submenuTimerRef.current !== null) window.clearTimeout(submenuTimerRef.current)
    submenuTimerRef.current = window.setTimeout(() => openSubmenu(name), 300)
  }

  function closeSubmenu(): void {
    if (submenuTimerRef.current !== null) window.clearTimeout(submenuTimerRef.current)
    setSubmenu(null)
  }

  React.useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const x = Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))
    const y = Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))
    setPlacedPosition((current) => (current.x === x && current.y === y ? current : { x, y }))
    setSubmenuSide(x + rect.width + 196 > window.innerWidth - 8 ? 'left' : 'right')
  }, [position.x, position.y])

  React.useLayoutEffect(() => {
    if (!submenu) {
      setSubmenuShift(0)
      return
    }
    const panel = menuRef.current?.querySelector<HTMLElement>(`[data-submenu-panel="${submenu}"]`)
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const shift = rect.bottom > window.innerHeight - 8
      ? window.innerHeight - 8 - rect.bottom
      : rect.top < 8
        ? 8 - rect.top
        : 0
    setSubmenuShift(shift)
  }, [submenu, placedPosition])

  React.useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('.context-menu-item:not(:disabled)')?.focus())

    function closeFromOutside(event: PointerEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    function closeFromViewportChange(): void {
      onClose()
    }

    document.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('blur', closeFromViewportChange)
    window.addEventListener('resize', closeFromViewportChange)
    window.addEventListener('scroll', closeFromViewportChange, true)
    return () => {
      if (submenuTimerRef.current !== null) window.clearTimeout(submenuTimerRef.current)
      document.removeEventListener('pointerdown', closeFromOutside)
      window.removeEventListener('blur', closeFromViewportChange)
      window.removeEventListener('resize', closeFromViewportChange)
      window.removeEventListener('scroll', closeFromViewportChange, true)
      previousFocus?.focus?.({ preventScroll: true })
    }
  }, [onClose])

  function buttonsIn(menu: HTMLElement): HTMLButtonElement[] {
    return Array.from(menu.querySelectorAll<HTMLButtonElement>(
      ':scope > .context-menu-group > .context-menu-item-anchor > .context-menu-item:not(:disabled), :scope > .context-menu-item-anchor > .context-menu-item:not(:disabled)',
    ))
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const current = event.target as HTMLButtonElement
    const activeMenu = current.closest<HTMLElement>('[role="menu"]')
    if (!activeMenu) return

    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (event.key === 'ArrowLeft' && activeMenu.classList.contains('context-submenu')) {
      event.preventDefault()
      const owner = submenu
      setSubmenu(null)
      requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>(`[data-submenu="${owner}"]`)?.focus())
      return
    }

    if (event.key === 'ArrowRight' && current.dataset.submenu) {
      event.preventDefault()
      openSubmenu(current.dataset.submenu as SubmenuName, true)
      return
    }

    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) {
      event.preventDefault()
      const buttons = buttonsIn(activeMenu)
      if (!buttons.length) return
      if (event.key === 'Home') buttons[0]?.focus()
      else if (event.key === 'End') buttons.at(-1)?.focus()
      else {
        const direction = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1
        const index = Math.max(0, buttons.indexOf(current))
        buttons[(index + direction + buttons.length) % buttons.length]?.focus()
      }
      return
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {
      const shortcut = menuRef.current?.querySelector<HTMLButtonElement>(
        `[data-root-shortcut="${event.key.toLowerCase()}"]`,
      )
      if (shortcut?.dataset.submenu) {
        event.preventDefault()
        shortcut.focus()
        openSubmenu(shortcut.dataset.submenu as SubmenuName, true)
      }
    }
  }

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${task.identifier} 操作`}
      data-submenu-side={submenuSide}
      style={{ left: placedPosition.x, top: placedPosition.y }}
      className="fixed z-[210] min-w-[200px] rounded-lg border border-border/70 bg-popover p-1 shadow-xl"
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-menu-group">
        <MenuItem
          label="状态"
          icon={<Circle size={13} />}
          shortcut="S"
          submenu="status"
          submenuOpen={submenu === 'status'}
          rootShortcut="s"
          onPointerEnter={() => scheduleSubmenu('status')}
          onClick={() => openSubmenu('status', true)}
        >
          {submenu === 'status' && (
            <div className="context-submenu" role="menu" data-submenu-panel="status" style={{ transform: `translateY(${submenuShift}px)` }}>
              {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((status, index) => (
                <MenuItem
                  key={status}
                  label={STATUS_LABELS[status]}
                  icon={<span className={cn('size-2 rounded-full', STATUS_TONES[status].dot)} />}
                  shortcut={String(index + 1)}
                  checked={task.status === status}
                  onClick={() => closeThen(() => onStatusChange(task, status))}
                />
              ))}
            </div>
          )}
        </MenuItem>

        <MenuItem
          label="优先级"
          icon={<Flag size={13} />}
          shortcut="P"
          submenu="priority"
          submenuOpen={submenu === 'priority'}
          rootShortcut="p"
          onPointerEnter={() => scheduleSubmenu('priority')}
          onClick={() => openSubmenu('priority', true)}
        >
          {submenu === 'priority' && (
            <div className="context-submenu" role="menu" data-submenu-panel="priority" style={{ transform: `translateY(${submenuShift}px)` }}>
              {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((priority, index) => (
                <MenuItem
                  key={priority}
                  label={PRIORITY_LABELS[priority] ?? priority}
                  icon={<Flag size={12} />}
                  shortcut={String(index)}
                  checked={task.priority === priority}
                  onClick={() => closeThen(() => onPriorityChange(task, priority))}
                />
              ))}
            </div>
          )}
        </MenuItem>

        <MenuItem
          label="标签"
          icon={<Tag size={13} />}
          shortcut="L"
          submenu="labels"
          submenuOpen={submenu === 'labels'}
          rootShortcut="l"
          onPointerEnter={() => scheduleSubmenu('labels')}
          onClick={() => openSubmenu('labels', true)}
        >
          {submenu === 'labels' && (
            <div className="context-submenu labels-submenu" role="menu" data-submenu-panel="labels" style={{ transform: `translateY(${submenuShift}px)` }}>
              {labels.length ? labels.map((label) => {
                const selected = task.labels.includes(label)
                const presentation = labelPresentation(label)
                return (
                  <MenuItem
                    key={label}
                    label={presentation.name}
                    icon={<span className="size-2 rounded-full" style={{ backgroundColor: presentation.color }} />}
                    checked={selected}
                    onClick={() => closeThen(() => onLabelsChange(
                      task,
                      selected ? task.labels.filter((value) => value !== label) : [...task.labels, label],
                    ))}
                  />
                )
              }) : (
                <MenuItem label="暂无可用标签" disabled />
              )}
              <div className="my-1 h-px bg-border/60" role="separator" />
              <MenuItem
                label="在编辑器中管理…"
                icon={<Pencil size={13} />}
                onClick={() => closeThen(() => onEdit(task))}
              />
            </div>
          )}
        </MenuItem>
      </div>

      <div className="my-1 h-px bg-border/60" role="separator" />

      <div className="context-menu-group">
        <MenuItem
          label="编辑议题"
          icon={<Pencil size={13} />}
          shortcut="↵"
          onPointerEnter={closeSubmenu}
          onClick={() => closeThen(() => onEdit(task))}
        />
        <MenuItem
          label="创建副本"
          icon={<Copy size={13} />}
          onPointerEnter={closeSubmenu}
          onClick={() => closeThen(() => onDuplicate(task))}
        />
        <MenuItem
          label="复制"
          icon={<Copy size={13} />}
          submenu="copy"
          submenuOpen={submenu === 'copy'}
          onPointerEnter={() => scheduleSubmenu('copy')}
          onClick={() => openSubmenu('copy', true)}
        >
          {submenu === 'copy' && (
            <div className="context-submenu" role="menu" data-submenu-panel="copy" style={{ transform: `translateY(${submenuShift}px)` }}>
              <MenuItem
                label="复制议题 ID"
                onClick={() => closeThen(() => onCopy(task.identifier, `${task.identifier} 已复制。`))}
              />
              <MenuItem
                label="复制标题"
                onClick={() => closeThen(() => onCopy(task.title, '议题标题已复制。'))}
              />
              <MenuItem
                label="复制 Markdown"
                onClick={() => closeThen(() => onCopy(`**${task.identifier}** ${task.title}`, 'Markdown 已复制。'))}
              />
            </div>
          )}
        </MenuItem>
        <MenuItem
          label="在对话中打开"
          icon={<Link2 size={13} />}
          onPointerEnter={closeSubmenu}
          onClick={() => closeThen(() => {})}
        />
      </div>

      <div className="my-1 h-px bg-border/60" role="separator" />

      <div className="context-menu-group">
        <MenuItem
          label="归档议题"
          icon={<Archive size={13} />}
          shortcut="⌘⌫"
          danger
          onPointerEnter={closeSubmenu}
          onClick={() => closeThen(() => onArchive(task))}
        />
      </div>
    </div>
  )

  return createPortal(menu, document.body)
}
