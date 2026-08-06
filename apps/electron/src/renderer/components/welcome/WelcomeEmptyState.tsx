/**
 * WelcomeEmptyState — 对话/会话空状态引导
 *
 * Chat：个性化时段问候 + 对话引导
 * Code(Agent)：任务导向引导
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Lightbulb, MessageSquare, Sparkles } from 'lucide-react'
import { appModeAtom } from '@/atoms/app-mode'
import { userProfileAtom } from '@/atoms/user-profile'
import { getRandomTip, getPlatform, type Tip } from '@/lib/tips'

/** 根据小时返回时段问候 */
function getGreeting(hour: number): string {
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function WelcomeEmptyState(): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)
  const mode = useAtomValue(appModeAtom)
  const isChat = mode === 'chat'

  const hour = new Date().getHours()
  const greeting = getGreeting(hour)
  const displayName = userProfile.userName || '用户'

  // 稳定的随机 Tip；Chat 避开 Agent 专用技巧
  const [tip] = React.useState<Tip>(() => {
    const platform = getPlatform()
    if (!isChat) return getRandomTip(platform)
    for (let i = 0; i < 8; i++) {
      const candidate = getRandomTip(platform)
      if (!candidate.id.startsWith('tip-agent')) return candidate
    }
    return getRandomTip(platform)
  })

  return (
    <div className="welcome-empty-state flex h-full justify-center px-5 sm:px-8">
      <div className="mt-[14vh] w-full max-w-[800px]">
        <div className="flex items-center gap-2.5">
          {isChat ? (
            <MessageSquare className="size-5 text-[#d97757]" strokeWidth={1.8} />
          ) : (
            <Sparkles className="size-5 text-[#d97757]" strokeWidth={1.8} />
          )}
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-foreground">
            {isChat ? `${displayName}，${greeting}` : '接下来做什么？'}
          </h1>
        </div>
        <p className="mt-2 pl-[30px] text-[13px] text-muted-foreground">
          {isChat
            ? '有什么可以帮你的？在下方输入开始对话，或从左侧继续历史对话。'
            : `${displayName}，${greeting}。描述一个任务，或从左侧继续最近的会话。`}
        </p>
        <div className="mt-5 flex items-start gap-2 pl-[30px] text-[12px] leading-5 text-muted-foreground/75">
          <Lightbulb size={13} className="mt-0.5 flex-shrink-0 text-amber-500/75" />
          <span>{tip.text}</span>
        </div>
      </div>
    </div>
  )
}
