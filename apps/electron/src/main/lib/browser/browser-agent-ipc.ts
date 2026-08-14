/**
 * Browser Agent IPC 注册。
 *
 * 三条通道：
 * - Renderer 绑定/解绑 webview guest 到浏览器任务
 * - Renderer 订阅任务状态变化（悬浮面板列表）
 * - 主进程内部/MCP 调用控制动作（navigate/click/type/...）
 */

import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { BROWSER_AGENT_IPC_CHANNELS } from '@proma/shared'
import type { BrowserAgentTask } from '@proma/shared'
import {
  bindBrowserAgentTaskGuest,
  unbindBrowserAgentTaskGuest,
  listBrowserAgentTasks,
  onBrowserAgentTaskUpdated,
  onBrowserAgentOpenTask,
  pruneStaleBrowserAgentTasks,
} from './browser-agent-controller'

let pruneTimer: ReturnType<typeof setInterval> | null = null

export function registerBrowserAgentIpc(getWindow: () => BrowserWindow | null): void {
  // Renderer 绑定 webview guest 到任务
  ipcMain.handle(
    BROWSER_AGENT_IPC_CHANNELS.BIND_TASK,
    (_event, input: { taskId?: string; guestId?: number; url?: string }) => {
      if (typeof input?.taskId !== 'string' || typeof input?.guestId !== 'number') return { ok: false }
      bindBrowserAgentTaskGuest(input.taskId, input.guestId, typeof input.url === 'string' ? input.url : undefined)
      return { ok: true }
    },
  )

  // Renderer 解绑
  ipcMain.handle(BROWSER_AGENT_IPC_CHANNELS.UNBIND_TASK, (_event, input: { guestId?: number }) => {
    if (typeof input?.guestId === 'number') unbindBrowserAgentTaskGuest(input.guestId)
    return { ok: true }
  })

  // Renderer 拉取任务列表（悬浮面板初始化）
  ipcMain.handle('proma:browser-agent:list-tasks', (_event, input: { sessionId?: string }) => {
    return listBrowserAgentTasks(typeof input?.sessionId === 'string' ? input.sessionId : undefined)
  })

  // 任务状态变化 → 推送给 Renderer 悬浮面板
  onBrowserAgentTaskUpdated((task: BrowserAgentTask) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(BROWSER_AGENT_IPC_CHANNELS.TASK_UPDATED, task)
    }
  })

  // Agent 请求打开任务浏览器页面 → 渲染层创建对应 Tab（触发 webview 绑定）
  onBrowserAgentOpenTask((task: BrowserAgentTask) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(BROWSER_AGENT_IPC_CHANNELS.OPEN_TASK, task)
    }
  })

  // 定时清理超时未活跃的已结束/暂停任务
  if (!pruneTimer) {
    pruneTimer = setInterval(() => {
      pruneStaleBrowserAgentTasks()
    }, 60 * 1000)
    pruneTimer.unref?.()
  }
}
