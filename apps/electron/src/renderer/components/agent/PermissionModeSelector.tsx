/**
 * PermissionModeSelector — Agent 权限模式切换器
 *
 * 集成在 Agent 输入区中，以文字触发器 + 选择面板切换模式。
 * 每个会话独立维护自己的权限模式。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Check, ChevronDown, Shield, ShieldCheck, Zap } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  agentPermissionModeMapAtom,
  agentDefaultPermissionModeAtom,
  sessionPersistedPermissionModeAtom,
  sessionExistsAtom,
} from '@/atoms/agent-atoms'
import type { PromaApprovalMode, PromaPermissionMode } from '@proma/shared'
import { PROMA_APPROVAL_MODES, PROMA_PERMISSION_MODE_CONFIG } from '@proma/shared'
import { normalizeApprovalMode } from '@/lib/agent-plan-mode'
import { cn } from '@/lib/utils'

const MODE_ICONS: Record<PromaApprovalMode, React.ComponentType<{ className?: string }>> = {
  default: Shield,
  bypassPermissions: Zap,
}

interface PermissionModeSelectorProps {
  sessionId: string
}

export function PermissionModeSelector({ sessionId }: PermissionModeSelectorProps): React.ReactElement | null {
  const [open, setOpen] = React.useState(false)
  const [modeMap, setModeMap] = useAtom(agentPermissionModeMapAtom)
  const defaultMode = useAtomValue(agentDefaultPermissionModeAtom)
  const persistedSessionMode = useAtomValue(sessionPersistedPermissionModeAtom(sessionId))
  const mode = normalizeApprovalMode(modeMap.get(sessionId) ?? persistedSessionMode ?? defaultMode)
  const sessionExistsInList = useAtomValue(sessionExistsAtom(sessionId))

  // 初始化：如果当前 session 不在 Map 中，按以下优先级读回：
  // 1. session meta.permissionMode（每个 tab 独立持久化，重启恢复各自的值）
  // 2. 默认完全自动模式
  // 注意：只写入当前 session，不回写到 agentDefaultPermissionModeAtom，避免跨会话污染。
  React.useEffect(() => {
    if (!sessionExistsInList) return

    setModeMap((prev: Map<string, PromaPermissionMode>) => {
      if (prev.has(sessionId)) return prev
      const next = new Map(prev)
      next.set(sessionId, normalizeApprovalMode(persistedSessionMode ?? defaultMode))
      return next
    })
  }, [sessionId, persistedSessionMode, sessionExistsInList, defaultMode, setModeMap])

  /** 切换当前会话的权限模式 */
  const selectMode = React.useCallback(async (nextMode: PromaApprovalMode) => {
    if (nextMode === mode) {
      setOpen(false)
      return
    }
    const prevMode = mode

    // 乐观更新当前 session 的模式
    setModeMap((prev: Map<string, PromaPermissionMode>) => {
      const next = new Map(prev)
      next.set(sessionId, nextMode)
      return next
    })

    // 热切换运行中的当前 session；失败时回滚 modeMap 保持 UI/后端一致
    try {
      await window.electronAPI.updateSessionPermissionMode(sessionId, nextMode)
      setOpen(false)
    } catch (error) {
      console.error('[PermissionModeSelector] 运行中切换权限模式失败，回滚 UI:', error)
      setModeMap((prev: Map<string, PromaPermissionMode>) => {
        const next = new Map(prev)
        next.set(sessionId, prevMode)
        return next
      })
    }
  }, [mode, sessionId, setModeMap])

  const config = PROMA_PERMISSION_MODE_CONFIG[mode]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`审批模式：${config.label}`}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground',
            'transition-colors hover:bg-muted/55 hover:text-foreground',
            'data-[state=open]:bg-muted/55 data-[state=open]:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          )}
        >
          <ShieldCheck className="size-3.5" />
          <span>{config.label}</span>
          <ChevronDown className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-64 rounded-xl p-1.5"
        onOpenAutoFocus={event => event.preventDefault()}
      >
        <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-muted-foreground">
          审批模式
        </div>
        {PROMA_APPROVAL_MODES.map(nextMode => {
          const nextConfig = PROMA_PERMISSION_MODE_CONFIG[nextMode]
          const Icon = MODE_ICONS[nextMode]
          const selected = nextMode === mode
          return (
            <button
              key={nextMode}
              type="button"
              onClick={() => void selectMode(nextMode)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                'hover:bg-accent/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                selected && 'bg-accent/55',
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-foreground/70">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {nextConfig.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {nextConfig.description}
                </span>
              </span>
              {selected && <Check className="size-4 shrink-0 text-foreground/65" />}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
