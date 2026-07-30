import { constants } from 'node:fs'
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { dirname, join, parse, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DEFAULT_BUNDLE_ID = 'com.proma.app'

export interface UnsignedMacUpdatePlan {
  scriptPath: string
  targetAppPath: string
  stagedAppPath: string
  stagingRoot: string
  logFilePath: string
}

interface PrepareUnsignedMacUpdateOptions {
  downloadedFile: string
  version: string
  executablePath: string
  tempPath: string
  logsPath: string
  bundleId?: string
}

function normalizePath(path: string): string {
  return resolve(path).replace(new RegExp(`${sep}+$`), '')
}

/**
 * 从 Electron 可执行文件路径解析出当前 .app Bundle。
 *
 * /Applications/Proma.app/Contents/MacOS/Proma → /Applications/Proma.app
 */
export function resolveMacAppBundlePath(executablePath: string): string {
  let current = normalizePath(executablePath)
  const root = parse(current).root

  while (current !== root) {
    if (current.toLowerCase().endsWith('.app')) {
      return current
    }
    current = dirname(current)
  }

  throw new Error(`无法从可执行文件路径定位 macOS App：${executablePath}`)
}

export function validateMacUpdateIdentity(
  actualBundleId: string,
  actualVersion: string,
  expectedBundleId: string,
  expectedVersion: string,
): void {
  if (actualBundleId.trim() !== expectedBundleId) {
    throw new Error(
      `更新包 Bundle ID 不匹配：预期 ${expectedBundleId}，实际 ${actualBundleId.trim() || '空'}`,
    )
  }
  if (actualVersion.trim() !== expectedVersion) {
    throw new Error(
      `更新包版本不匹配：预期 ${expectedVersion}，实际 ${actualVersion.trim() || '空'}`,
    )
  }
}

/**
 * 独立于 Proma Bundle 执行。应用退出后备份旧 Bundle、复制新 Bundle，
 * 失败则回滚，成功后移除下载隔离属性并重新打开应用。
 */
export function buildUnsignedMacInstallerScript(): string {
  return `#!/bin/sh
set -u

APP_PID="$1"
TARGET_APP="$2"
STAGED_APP="$3"
STAGING_ROOT="$4"
LOG_FILE="$5"
BACKUP_APP="\${TARGET_APP}.proma-update-backup"

/bin/mkdir -p "$(/usr/bin/dirname "$LOG_FILE")"
exec >>"$LOG_FILE" 2>&1

echo "[$(/bin/date '+%Y-%m-%d %H:%M:%S')] 开始安装未签名 macOS 更新"
echo "target=$TARGET_APP"
echo "staged=$STAGED_APP"

WAIT_COUNT=0
while /bin/kill -0 "$APP_PID" 2>/dev/null; do
  /bin/sleep 0.25
  WAIT_COUNT=$((WAIT_COUNT + 1))
  if [ "$WAIT_COUNT" -ge 240 ]; then
    echo "等待 Proma 退出超时"
    exit 1
  fi
done

if [ ! -e "$TARGET_APP" ] && [ -e "$BACKUP_APP" ]; then
  echo "检测到上次安装中断，先恢复旧版本"
  /bin/mv "$BACKUP_APP" "$TARGET_APP" || exit 1
fi
if [ ! -e "$TARGET_APP" ]; then
  echo "找不到当前 Proma 应用：$TARGET_APP"
  exit 1
fi

/bin/rm -rf "$BACKUP_APP"
if ! /bin/mv "$TARGET_APP" "$BACKUP_APP"; then
  echo "无法备份当前应用，请确认当前用户对应用目录有写入权限"
  exit 1
fi

if /usr/bin/ditto "$STAGED_APP" "$TARGET_APP"; then
  /usr/bin/xattr -rd com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
  echo "更新复制完成，正在重新打开 Proma"
  if /usr/bin/open "$TARGET_APP"; then
    /bin/sleep 2
    /bin/rm -rf "$BACKUP_APP"
    /bin/rm -rf "$STAGING_ROOT"
    exit 0
  fi
  echo "新版本启动失败，正在恢复旧版本"
fi

echo "更新复制失败，正在恢复旧版本"
/bin/rm -rf "$TARGET_APP"
if /bin/mv "$BACKUP_APP" "$TARGET_APP"; then
  /usr/bin/open "$TARGET_APP"
fi
exit 1
`
}

async function readPlistValue(infoPlistPath: string, key: string): Promise<string> {
  const { stdout } = await execFileAsync(
    '/usr/libexec/PlistBuddy',
    ['-c', `Print :${key}`, infoPlistPath],
    { encoding: 'utf8' },
  )
  return stdout.trim()
}

async function findStagedApp(stagingRoot: string): Promise<string> {
  const entries = await readdir(stagingRoot, { withFileTypes: true })
  const appEntries = entries.filter(
    entry => entry.isDirectory() && entry.name.toLowerCase().endsWith('.app'),
  )
  if (appEntries.length !== 1) {
    throw new Error(`更新压缩包中应包含一个 App，实际找到 ${appEntries.length} 个`)
  }
  return join(stagingRoot, appEntries[0]!.name)
}

export async function prepareUnsignedMacUpdate(
  options: PrepareUnsignedMacUpdateOptions,
): Promise<UnsignedMacUpdatePlan> {
  const targetAppPath = resolveMacAppBundlePath(options.executablePath)
  const targetParent = dirname(targetAppPath)

  await access(options.downloadedFile, constants.R_OK)
  await access(targetParent, constants.W_OK)

  const stagingRoot = await mkdtemp(join(options.tempPath, 'proma-update-'))
  try {
    await execFileAsync('/usr/bin/ditto', ['-x', '-k', options.downloadedFile, stagingRoot])

    const stagedAppPath = await findStagedApp(stagingRoot)
    const infoPlistPath = join(stagedAppPath, 'Contents', 'Info.plist')
    const [actualBundleId, actualVersion] = await Promise.all([
      readPlistValue(infoPlistPath, 'CFBundleIdentifier'),
      readPlistValue(infoPlistPath, 'CFBundleShortVersionString'),
    ])

    validateMacUpdateIdentity(
      actualBundleId,
      actualVersion,
      options.bundleId ?? DEFAULT_BUNDLE_ID,
      options.version,
    )

    const scriptPath = join(stagingRoot, 'install-proma-update.sh')
    const logDirectory = join(options.logsPath, 'updater')
    const logFilePath = join(logDirectory, 'install.log')
    await mkdir(logDirectory, { recursive: true })
    await writeFile(scriptPath, buildUnsignedMacInstallerScript(), 'utf8')
    await chmod(scriptPath, 0o700)

    // 确认脚本真实落盘，避免退出应用后才发现辅助安装器缺失。
    await readFile(scriptPath)

    return {
      scriptPath,
      targetAppPath,
      stagedAppPath,
      stagingRoot,
      logFilePath,
    }
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export async function launchUnsignedMacUpdate(
  plan: UnsignedMacUpdatePlan,
  appPid: number,
): Promise<void> {
  const child = spawn(
    '/bin/sh',
    [
      plan.scriptPath,
      String(appPid),
      plan.targetAppPath,
      plan.stagedAppPath,
      plan.stagingRoot,
      plan.logFilePath,
    ],
    {
      detached: true,
      stdio: 'ignore',
    },
  )

  await new Promise<void>((resolvePromise, rejectPromise) => {
    child.once('spawn', resolvePromise)
    child.once('error', rejectPromise)
  })
  child.unref()
}
