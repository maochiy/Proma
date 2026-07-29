/**
 * PermissionBanner — Agent 权限请求横幅
 *
 * 内联在 Agent 对话流底部，当有待处理的权限请求时显示。
 * 显示工具名、命令内容、危险等级，提供允许/拒绝/总是允许操作。
 * 支持队列模式：多个并发请求按 FIFO 逐个展示。
 *
 * 设计参考 Craft Agents OSS 的内联权限 UI。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { Shield, ShieldAlert, Check, X } from 'lucide-react'
import { allPendingPermissionRequestsAtom } from '@/atoms/agent-atoms'
import { inputCardClass } from '@/components/ai-elements/input-toolbar-styles'
import { cn } from '@/lib/utils'
import type { DangerLevel } from '@proma/shared'

/** 危险等级对应的图标颜色 */
const DANGER_ICON_STYLES: Record<DangerLevel, string> = {
  safe: 'text-green-500',
  normal: 'text-primary',
  dangerous: 'text-amber-500',
}

/** 解析工具显示名称（MCP 工具显示 server / tool） */
function formatToolName(toolName: string): string {
  const parts = toolName.split('__')
  if (parts[0] === 'mcp' && parts.length >= 3) {
    return `${parts[1]} / ${parts.slice(2).join('__')}`
  }
  return toolName
}

/** PermissionBanner 属性接口 */
interface PermissionBannerProps {
  sessionId: string
}

type PermissionDecision = 'allow_once' | 'allow_session' | 'deny'

interface PermissionOption {
  decision: PermissionDecision
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  destructive?: boolean
}

const PERMISSION_OPTIONS: readonly PermissionOption[] = [
  {
    decision: 'allow_once',
    label: '允许',
    description: '仅允许执行本次操作',
    icon: Check,
  },
  {
    decision: 'allow_session',
    label: '本次会话总是允许',
    description: '本次会话中后续相同操作不再询问',
    icon: Shield,
  },
  {
    decision: 'deny',
    label: '拒绝',
    description: '拒绝本次操作并让 Agent 继续处理',
    icon: X,
    destructive: true,
  },
]

export function PermissionBanner({ sessionId }: PermissionBannerProps): React.ReactElement | null {
  const [allRequests, setAllRequests] = useAtom(allPendingPermissionRequestsAtom)
  const requests = allRequests.get(sessionId) ?? []
  const [responding, setResponding] = React.useState(false)
  const [focusedIdx, setFocusedIdx] = React.useState(0)
  const focusedIdxRef = React.useRef(focusedIdx)
  const respondRef = React.useRef<((decision: PermissionDecision) => void) | null>(null)

  const request = requests[0] ?? null
  focusedIdxRef.current = focusedIdx

  React.useEffect(() => {
    setFocusedIdx(0)
  }, [request?.requestId])

  // 键盘操作与 Codex 交互一致：上下选择、Enter 确认、数字键快速选择。
  React.useEffect(() => {
    if (!request) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const optionCount = PERMISSION_OPTIONS.length
        const nextIdx = e.key === 'ArrowDown'
          ? (focusedIdxRef.current + 1) % optionCount
          : (focusedIdxRef.current - 1 + optionCount) % optionCount
        setFocusedIdx(nextIdx)
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        const option = PERMISSION_OPTIONS[focusedIdxRef.current]
        if (option) respondRef.current?.(option.decision)
      } else if (e.key >= '1' && e.key <= '3') {
        e.preventDefault()
        const optionIdx = Number(e.key) - 1
        const option = PERMISSION_OPTIONS[optionIdx]
        if (option) {
          setFocusedIdx(optionIdx)
          respondRef.current?.(option.decision)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [request?.requestId])

  if (!request) return null

  const iconColor = DANGER_ICON_STYLES[request.dangerLevel]
  const isDangerous = request.dangerLevel === 'dangerous'
  const IconComponent = isDangerous ? ShieldAlert : Shield

  /** 响应权限请求 */
  const respond = async (behavior: 'allow' | 'deny', alwaysAllow = false): Promise<void> => {
    if (responding) return
    setResponding(true)

    try {
      await window.electronAPI.respondPermission({
        requestId: request.requestId,
        behavior,
        alwaysAllow,
      })
      // 移除已响应的请求（FIFO 出队）
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const newValue = current.filter((r) => r.requestId !== request.requestId)
        if (newValue.length === 0) map.delete(sessionId)
        else map.set(sessionId, newValue)
        return map
      })
    } catch (error) {
      console.error('[PermissionBanner] 响应失败:', error)
    } finally {
      setResponding(false)
    }
  }

  const respondToDecision = (decision: PermissionDecision): void => {
    if (decision === 'deny') {
      void respond('deny')
      return
    }
    void respond('allow', decision === 'allow_session')
  }

  respondRef.current = respondToDecision

  /** 关闭等同于拒绝当前操作，让拒绝结果返回 CCB，由模型决定如何继续。 */
  const handleDismiss = (): void => {
    respondToDecision('deny')
  }

  return (
    <div
      className={cn(
        inputCardClass,
        'w-full overflow-hidden bg-card animate-in slide-in-from-bottom-2 duration-200',
      )}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <IconComponent className={`size-4 ${iconColor}`} />
          <span className="text-sm font-medium">
            {isDangerous ? '危险操作需要确认' : '需要确认'}
          </span>
          {requests.length > 1 && (
            <span className="text-xs text-muted-foreground">
              (+{requests.length - 1})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-mono">
            {request.sdkDisplayName ?? formatToolName(request.toolName)}
          </span>
          <button
            type="button"
            className="size-5 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
            onClick={handleDismiss}
            title="拒绝当前操作"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 命令/操作内容 */}
      <div className="px-4 pb-3 space-y-1.5">
        {/* SDK 可读标题（优先展示，描述操作意图） */}
        {request.sdkTitle && (
          <p className="text-xs text-foreground">{request.sdkTitle}</p>
        )}
        {/* SDK 详细描述（与标题不同时才展示） */}
        {request.sdkDescription && request.sdkDescription !== request.sdkTitle && (
          <p className="text-xs text-muted-foreground">{request.sdkDescription}</p>
        )}
        {/* Bash 命令：始终展示代码块 */}
        {request.command ? (
          <pre className="max-h-[180px] overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-muted/45 px-3 py-2 text-xs font-mono">
            {request.command}
          </pre>
        ) : !request.sdkTitle && Object.keys(request.toolInput).length > 0 ? (
          <pre className="max-h-[180px] overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-muted/45 px-3 py-2 text-xs font-mono">
            {JSON.stringify(request.toolInput, null, 2)}
          </pre>
        ) : !request.sdkTitle ? (
          <p className="text-xs text-muted-foreground">
            {request.description}
          </p>
        ) : null}
      </div>

      {/* Codex 风格纵向审批操作 */}
      <div className="px-3 pb-2">
        <div className="flex flex-col gap-1">
          {PERMISSION_OPTIONS.map((option, idx) => {
            const isFocused = focusedIdx === idx
            const OptionIcon = option.icon
            return (
              <button
                key={option.decision}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors',
                  option.destructive
                    ? 'text-foreground/80 hover:bg-destructive/10 hover:text-destructive'
                    : 'text-foreground/85 hover:bg-muted/70',
                  isFocused && (
                    option.destructive
                      ? 'bg-destructive/[0.07] text-destructive ring-1 ring-inset ring-destructive/20'
                      : 'bg-muted/70 text-foreground ring-1 ring-inset ring-foreground/10'
                  ),
                )}
                onClick={() => respondToDecision(option.decision)}
                onMouseEnter={() => setFocusedIdx(idx)}
                disabled={responding}
              >
                <span className="w-4 shrink-0 text-center text-[11px] text-muted-foreground/55">
                  {idx + 1}
                </span>
                <OptionIcon className="size-4 shrink-0 opacity-70" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-[11px] text-muted-foreground">{option.description}</span>
                </span>
                {isFocused && <Check className="size-4 shrink-0 opacity-70" />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="px-4 pb-3 text-[10px] text-muted-foreground/45">
        点击选择 · ↑↓ Enter 确认 · 1-3 快速选择
      </div>
    </div>
  )
}
