/**
 * 顶层设置路由。
 *
 * 设置页由 AppShell 直接挂载，不再嵌入 MainArea，也不再叠加 Dialog。
 */

import * as React from 'react'
import { SettingsPanel } from './SettingsPanel'
import { useSetAtom } from 'jotai'
import { settingsOpenAtom } from '@/atoms/settings-tab'

export function SettingsView(): React.ReactElement {
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  return (
    // 注意：不要给整页加 titlebar-no-drag，否则窗口顶部无法拖拽移动。
    // 窗口拖拽由 AppShell 顶部 0–52px 全局 drag 层兜底；设置页通过内容区
    // 顶部留白（pt-[60px]）让可点元素落在 drag 层下方即可。
    <div className="h-full min-h-0 w-full overflow-hidden">
      <SettingsPanel onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
