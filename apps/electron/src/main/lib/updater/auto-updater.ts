/**
 * 自动更新核心模块
 *
 * 检测新版本 → 自动后台下载 → 用户从更新入口确认后重启安装。
 * 仅在打包后的生产环境中工作。
 */

import { autoUpdater } from 'electron-updater'
import type { UpdateDownloadedEvent } from 'electron-updater'
import { app, BrowserWindow } from 'electron'
import type { UpdateStatus } from './updater-types'
import { UPDATER_IPC_CHANNELS } from './updater-types'
import { hasAppUpdateConfiguration } from './update-availability'
import {
  launchUnsignedMacUpdate,
  prepareUnsignedMacUpdate,
} from './unsigned-mac-installer'

/** 当前更新状态 */
let currentStatus: UpdateStatus = { status: 'idle' }

/** 主窗口引用 */
let win: BrowserWindow | null = null

/** 定时检查定时器 */
let checkInterval: ReturnType<typeof setInterval> | null = null

/** 当前包是否包含 electron-updater 所需配置。 */
let updaterEnabled = false

/** electron-updater 已完成 SHA-512 校验的更新压缩包。 */
let downloadedUpdate: { file: string; version: string } | null = null

/** 更新状态并推送给渲染进程 */
function setStatus(status: UpdateStatus): void {
  currentStatus = status
  win?.webContents?.send(UPDATER_IPC_CHANNELS.ON_STATUS_CHANGED, status)
}

/** 获取当前更新状态 */
export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

/** 手动触发检查更新 */
export async function checkForUpdates(): Promise<void> {
  if (!updaterEnabled) {
    setStatus({
      status: 'disabled',
      reason: '当前为本地签名版本，不支持自动更新',
    })
    return
  }

  // 已在下载中或已下载完成，不重复检查
  if (currentStatus.status === 'downloading' || currentStatus.status === 'downloaded') {
    console.log('[更新] 跳过检查：已在下载中或已下载完成')
    return
  }

  try {
    setStatus({ status: 'checking' })
    await autoUpdater.checkForUpdates()
  } catch (err) {
    console.error('[更新] 检查更新失败:', err)
    setStatus({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** 退出并安装已下载的更新 */
export async function quitAndInstall(): Promise<void> {
  if (!updaterEnabled) return

  if (currentStatus.status !== 'downloaded' || !downloadedUpdate) {
    setStatus({
      status: 'error',
      error: '更新文件尚未下载完成，请重新检查更新',
    })
    return
  }

  if (process.platform === 'darwin') {
    const { file, version } = downloadedUpdate
    setStatus({ status: 'installing', version })

    try {
      // 未配置 Developer ID 的公开构建无法通过 Squirrel.Mac 的签名替换流程。
      // 下载文件已由 electron-updater 完成 SHA-512 校验，这里额外校验 App 的
      // Bundle ID 与版本，再交给独立 shell 进程在 Proma 退出后安全替换。
      const plan = await prepareUnsignedMacUpdate({
        downloadedFile: file,
        version,
        executablePath: app.getPath('exe'),
        tempPath: app.getPath('temp'),
        logsPath: app.getPath('logs'),
      })
      await launchUnsignedMacUpdate(plan, process.pid)

      for (const w of BrowserWindow.getAllWindows()) {
        w.removeAllListeners('close')
      }
      app.quit()
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error('[更新] macOS 更新安装准备失败:', err)
      setStatus({
        status: 'error',
        error: `安装更新失败：${error}`,
      })
    }
    return
  }

  // 移除所有窗口的 close 监听器，避免 preventDefault 阻止退出
  for (const w of BrowserWindow.getAllWindows()) {
    w.removeAllListeners('close')
  }

  // 延迟调用确保 IPC 响应已发送回渲染进程
  setImmediate(() => {
    autoUpdater.quitAndInstall(true, true)
  })
}

/** 清理更新器资源（定时器等） */
export function cleanupUpdater(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

/**
 * 初始化自动更新
 *
 * @param mainWindow - 主窗口实例，用于推送更新状态
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow

  if (!hasAppUpdateConfiguration(process.resourcesPath)) {
    updaterEnabled = false
    setStatus({
      status: 'disabled',
      reason: '当前为本地签名版本，不支持自动更新',
    })
    mainWindow.on('closed', () => {
      win = null
    })
    console.log('[更新] 本地签名版本未包含更新配置，已禁用自动更新')
    return
  }

  updaterEnabled = true

  autoUpdater.logger = {
    info: (...args: unknown[]) => console.log('[更新-updater]', ...args),
    warn: (...args: unknown[]) => console.warn('[更新-updater]', ...args),
    error: (...args: unknown[]) => console.error('[更新-updater]', ...args),
    debug: (...args: unknown[]) => console.log('[更新-updater:debug]', ...args),
  }

  // 自动下载，但不在用户正常退出时自动安装，避免重启应用后被动进入更新流程。
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  // 监听更新事件
  autoUpdater.on('checking-for-update', () => {
    console.log('[更新] 正在检查更新...')
    setStatus({ status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[更新] 发现新版本:', info.version)
    setStatus({
      status: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : undefined,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      status: 'downloading',
      version: (currentStatus as { version?: string }).version || '',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      },
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    console.log('[更新] 下载完成:', info.version)
    downloadedUpdate = {
      file: info.downloadedFile,
      version: info.version,
    }
    setStatus({
      status: 'downloaded',
      version: info.version,
    })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[更新] 已是最新版本')
    setStatus({ status: 'not-available' })
  })

  autoUpdater.on('error', (err) => {
    console.error('[更新] 更新出错:', err)
    downloadedUpdate = null
    setStatus({
      status: 'error',
      error: err.message,
    })
  })

  // 启动后延迟 10 秒首次检查
  setTimeout(() => {
    console.log('[更新] 首次自动检查更新')
    checkForUpdates()
  }, 10_000)

  // 每 4 小时自动检查一次
  checkInterval = setInterval(() => {
    console.log('[更新] 定时自动检查更新')
    checkForUpdates()
  }, 4 * 60 * 60 * 1000)

  // 窗口关闭时清理定时器
  mainWindow.on('closed', () => {
    if (checkInterval) {
      clearInterval(checkInterval)
      checkInterval = null
    }
    win = null
  })

  console.log('[更新] 自动更新模块已初始化（自动下载，用户主动确认后安装）')
}
