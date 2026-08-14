/**
 * 订阅并维护浏览器任务列表（写入共享 atom，供悬浮面板列表与 Tab label 使用）。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import type { BrowserAgentTask } from '@proma/shared'
import { browserAgentTasksAtom } from '@/atoms/browser-atoms'

export function useBrowserAgentTasks(sessionId: string): BrowserAgentTask[] {
  const tasksMap = useAtomValue(browserAgentTasksAtom)

  return React.useMemo(
    () => Array.from(tasksMap.values())
      .filter((task) => task.sessionId === sessionId)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [tasksMap, sessionId],
  )
}
