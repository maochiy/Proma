import * as React from 'react'

interface AgentInputContextBarProps {
  projectPicker: React.ReactNode
  planProgress: React.ReactNode
}

/**
 * 输入框上方的上下文栏。
 *
 * 三列等分两侧空间，让项目入口保持左对齐，同时让计划入口始终相对输入框精确居中。
 */
export function AgentInputContextBar({
  projectPicker,
  planProgress,
}: AgentInputContextBarProps): React.ReactElement {
  return (
    <div
      className="mb-2 grid min-h-9 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end"
      data-agent-input-context-bar
    >
      <div className="min-w-0 justify-self-start">{projectPicker}</div>
      <div className="justify-self-center">{planProgress}</div>
      <div aria-hidden="true" />
    </div>
  )
}
