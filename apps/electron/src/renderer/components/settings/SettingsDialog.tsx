/**
 * SettingsDialog - 设置浮窗
 *
 * 以 Dialog 浮窗形式展示设置面板，不覆盖主内容区。
 * 使用低级 Dialog 原语实现轻遮罩 + 无默认关闭按钮（关闭按钮由 SettingsPanel 内部提供）。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { SettingsPanel } from './SettingsPanel'

export function SettingsDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(settingsOpenAtom)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[100] bg-black/35 backdrop-blur-[3px] titlebar-no-drag transition-opacity duration-150 data-[state=open]:opacity-100 data-[state=closed]:opacity-0"
        />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[100] h-[min(720px,88vh)] w-[min(960px,90vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-white/15 bg-dialog text-dialog-foreground shadow-[0_24px_80px_rgba(0,0,0,0.28)] titlebar-no-drag transition-all duration-150 data-[state=open]:scale-100 data-[state=open]:opacity-100 data-[state=closed]:scale-[0.985] data-[state=closed]:opacity-0"
        >
          <DialogPrimitive.Title className="sr-only">设置</DialogPrimitive.Title>
          <SettingsPanel onClose={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
