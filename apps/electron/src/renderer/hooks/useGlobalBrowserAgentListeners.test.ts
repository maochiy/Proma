import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import type { BrowserAgentTask } from '@proma/shared'
import {
  agentDiffPanelTabAtom,
  agentSidePanelTabsAtom,
  createBrowserTaskTab,
} from '@/atoms/agent-atoms'
import { browserAgentTasksAtom } from '@/atoms/browser-atoms'
import { openBrowserAgentTaskInStore } from './useGlobalBrowserAgentListeners'

function createTask(status: BrowserAgentTask['status'] = 'running'): BrowserAgentTask {
  return {
    taskId: 'review-progress',
    sessionId: 'session-1',
    title: '查看审核进度',
    url: 'https://appstoreconnect.apple.com',
    status,
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('全局 Browser Agent 监听', () => {
  test('Given 主进程请求打开任务 When 写入 Store Then 创建并激活对应浏览器 Tab', () => {
    const store = createStore()
    const task = createTask()

    openBrowserAgentTaskInStore(store, task)

    const tab = createBrowserTaskTab(task.taskId)
    expect(store.get(browserAgentTasksAtom).get(task.taskId)).toEqual(task)
    expect(store.get(agentSidePanelTabsAtom).get(task.sessionId)).toEqual([tab])
    expect(store.get(agentDiffPanelTabAtom).get(task.sessionId)).toBe(tab)
  })

  test('Given 同一任务重复请求打开 When 写入 Store Then 不重复创建 Tab', () => {
    const store = createStore()
    const task = createTask('paused')

    openBrowserAgentTaskInStore(store, task)
    openBrowserAgentTaskInStore(store, { ...task, status: 'running', updatedAt: 3 })

    expect(store.get(agentSidePanelTabsAtom).get(task.sessionId)).toHaveLength(1)
    expect(store.get(browserAgentTasksAtom).get(task.taskId)?.status).toBe('running')
  })
})
