/**
 * WelcomeEmptyState — 对话/会话空状态引导
 *
 * 在没有消息时展示轻量的任务引导和平台提示。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Lightbulb, Sparkles } from 'lucide-react'
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

  // 稳定的随机 Tip（组件挂载时选一条）
  const [tip] = React.useState<Tip>(() => getRandomTip(getPlatform()))

  const hour = new Date().getHours()
  const greeting = getGreeting(hour)
  const displayName = userProfile.userName || '用户'

  return (
    <div className="welcome-empty-state flex h-full justify-center px-5 sm:px-8">
      <div className="mt-[14vh] w-full max-w-[800px]">
        <div className="flex items-center gap-2.5">
          <Sparkles className="size-5 text-[#d97757]" strokeWidth={1.8} />
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-foreground">
            接下来做什么？
          </h1>
        </div>
        <p className="mt-2 pl-[30px] text-[13px] text-muted-foreground">
          {displayName}，{greeting}。描述一个任务，或从左侧继续最近的会话。
        </p>
        <div className="mt-5 flex items-start gap-2 pl-[30px] text-[12px] leading-5 text-muted-foreground/75">
          <Lightbulb size={13} className="mt-0.5 flex-shrink-0 text-amber-500/75" />
          <span>{tip.text}</span>
        </div>
      </div>
    </div>
  )
}
