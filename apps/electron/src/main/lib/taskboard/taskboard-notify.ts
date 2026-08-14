/**
 * 任务看板变更广播模块
 *
 * 与 ipc.ts 解耦，供主进程任何服务（如 agent-service 的会话→任务同步）在
 * 修改任务看板数据后向所有渲染窗口广播 TASKBOARD_IPC_CHANNELS.CHANGED，
 * 触发渲染层 useGlobalTaskboardListeners 重新拉取数据。
 */

import { BrowserWindow } from 'electron'
import { TASKBOARD_IPC_CHANNELS } from '@proma/shared'

/** 向所有渲染窗口广播任务看板数据变更（main → renderer） */
export function notifyTaskboardChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(TASKBOARD_IPC_CHANNELS.CHANGED)
    }
  }
}
