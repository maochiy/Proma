/**
 * ModeSwitcher - Code/Chat 模式切换（下拉弹窗）
 *
 * 当前模式作为触发器，点击弹出可选项。纯弹窗交互，无选中高亮/描边。
 * 切换模式时自动恢复上一次在该模式下查看的对话/会话。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ChevronDown, Bot, MessageSquare } from 'lucide-react'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { activeViewAtom } from '@/atoms/active-view'
import { sidebarViewModeAtom } from '@/atoms/sidebar-atoms'
import { conversationsAtom, currentConversationIdAtom } from '@/atoms/chat-atoms'
import { agentSessionsAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { tabsAtom } from '@/atoms/tab-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface ModeOption {
  value: AppMode
  label: string
  description: string
  icon: React.ReactNode
}

const modes: ModeOption[] = [
  {
    value: 'agent',
    label: 'Code',
    description: '构建、调试并执行',
    icon: <Bot size={16} />,
  },
  {
    value: 'chat',
    label: 'Chat',
    description: '创建、学习和探索',
    icon: <MessageSquare size={16} />,
  },
]

export function ModeSwitcher({ compact = false }: { compact?: boolean } = {}): React.ReactElement {
  const [mode, setMode] = useAtom(appModeAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setViewMode = useSetAtom(sidebarViewModeAtom)
  const openSession = useOpenSession()
  const conversations = useAtomValue(conversationsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const currentConversationId = useAtomValue(currentConversationIdAtom)
  const currentAgentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const tabs = useAtomValue(tabsAtom)
  const [open, setOpen] = React.useState(false)

  const foundMode = modes.find((item) => item.value === mode)
  const currentMode: ModeOption = foundMode ?? modes[0]!

  const restoreSession = React.useCallback((targetMode: AppMode) => {
    const isChatMode = targetMode === 'chat'
    const sessions = isChatMode ? conversations : agentSessions
    const lastId = isChatMode ? currentConversationId : currentAgentSessionId

    if (lastId) {
      const match = sessions.find((s) => s.id === lastId)
      if (match) {
        openSession(targetMode, match.id, match.title)
        return
      }
    }
    const tab = tabs.find((t) => t.type === targetMode)
    if (tab) {
      openSession(targetMode, tab.sessionId, tab.title)
      return
    }
    const recent = sessions.find((s) => !s.archived)
    if (recent) {
      openSession(targetMode, recent.id, recent.title)
      return
    }
    setMode(targetMode)
  }, [openSession, conversations, agentSessions, currentConversationId, currentAgentSessionId, tabs, setMode])

  const handleModeSwitch = React.useCallback((targetMode: AppMode) => {
    if (targetMode !== mode) {
      // 与原先侧栏切换一致：回到会话列表 active 视图
      setViewMode('active')
      setActiveView('conversations')
      restoreSession(targetMode)
    }
    setOpen(false)
  }, [mode, restoreSession, setActiveView, setViewMode])

  return (
    <div className="titlebar-no-drag select-none">
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`当前模式 ${currentMode.label}，点击切换`}
            className={cn(
              'titlebar-no-drag group inline-flex max-w-full items-center gap-1 rounded-md',
              compact ? 'px-1.5 py-1' : 'px-2 py-1.5',
              'text-[16px] font-semibold tracking-tight text-foreground',
              // 纯触发器：无描边、无 ring、无 open 选中底，避免点击后出现黑框
              'border-0 bg-transparent shadow-none outline-none',
              'hover:bg-foreground/[0.05]',
              'focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0',
              'data-[state=open]:bg-transparent data-[state=open]:outline-none data-[state=open]:ring-0',
            )}
          >
            <span className="truncate">{currentMode.label}</span>
            <ChevronDown
              size={16}
              className={cn(
                'shrink-0 text-foreground/45 transition-transform duration-150',
                open && 'rotate-180 text-foreground/70',
              )}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={4}
          className="z-[200] w-[240px] p-1.5 titlebar-no-drag"
        >
          {modes.map((item) => (
            <DropdownMenuItem
              key={item.value}
              onSelect={() => handleModeSwitch(item.value)}
              className="cursor-pointer gap-3 rounded-lg px-2.5 py-2.5"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05] text-foreground/60">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium leading-tight text-foreground">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  {item.description}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
