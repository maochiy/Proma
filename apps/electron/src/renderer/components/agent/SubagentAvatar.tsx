import * as React from 'react'
import { cn } from '@/lib/utils'
import { subagentAvatarStyle } from '@/lib/subagent-presentation'

interface SubagentAvatarProps {
  seed: string
  name: string
  className?: string
}

export function SubagentAvatar({
  seed,
  name,
  className,
}: SubagentAvatarProps): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase shadow-sm',
        className,
      )}
      style={subagentAvatarStyle(seed)}
    >
      {name.trim().charAt(0) || 'A'}
    </span>
  )
}
