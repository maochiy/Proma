/**
 * 全局维护 Browser Agent 任务状态。
 *
 * OPEN_TASK 必须在应用顶层监听：模型请求打开网页时立即创建任务 Tab，
 * 让 BrowserPanel 挂载 webview 并把 guestId 回传主进程。
 */

import * as React from 'react'
import { useStore } from 'jotai'
import type { Store } from 'jotai/vanilla/store'
import type { BrowserAgentTask } from '@proma/shared'
import { browserAgentTasksAtom } from '@/atoms/browser-atoms'
import {
  createBrowserTaskTab,
  openAgentSidePanelTabAtom,
} from '@/atoms/agent-atoms'

export function updateBrowserAgentTaskInStore(
  store: Store,
  task: BrowserAgentTask,
): void {
  store.set(browserAgentTasksAtom, (previous) => {
    const next = new Map(previous)
    next.set(task.taskId, task)
    return next
  })
}

export function openBrowserAgentTaskInStore(
  store: Store,
  task: BrowserAgentTask,
): void {
  updateBrowserAgentTaskInStore(store, task)
  store.set(openAgentSidePanelTabAtom, {
    sessionId: task.sessionId,
    tab: createBrowserTaskTab(task.taskId),
  })
}

export function useGlobalBrowserAgentListeners(): void {
  const store = useStore()

  React.useEffect(() => {
    const unsubscribeUpdated = window.electronAPI.onBrowserAgentTaskUpdated((task) => {
      updateBrowserAgentTaskInStore(store, task)
    })
    const unsubscribeOpen = window.electronAPI.onBrowserAgentOpenTask((task) => {
      openBrowserAgentTaskInStore(store, task)
    })
    void window.electronAPI.listBrowserAgentTasks({}).then((tasks) => {
      for (const task of tasks) updateBrowserAgentTaskInStore(store, task)
    }).catch((error: unknown) => {
      console.warn('[内置浏览器 Agent] 初始化任务列表失败:', error)
    })

    return () => {
      unsubscribeUpdated()
      unsubscribeOpen()
    }
  }, [store])
}
