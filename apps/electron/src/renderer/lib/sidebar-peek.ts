/**
 * 侧栏收起后的悬停飞出计时器（模块级共享）
 *
 * 用几何区域判断「鼠标是否仍在左侧面板列」，避免：
 * - 热区/面板拆分导致 mouseleave 误关
 * - 顶部 fixed 折叠按钮不在面板 DOM 内导致移上去就关
 * - pointer-events-none 镂空穿透到主区触发 leave
 */

/** 关闭延迟：给鼠标短暂越界一点容错 */
export const SIDEBAR_PEEK_CLOSE_DELAY_MS = 200

/** 未飞出时左缘打开热区宽度 */
export const SIDEBAR_PEEK_HOTZONE_WIDTH = 12

/** 顶栏高度（与折叠按钮/红绿灯行一致） */
export const SIDEBAR_PEEK_TITLEBAR_HEIGHT = 52

let peekCloseTimer: ReturnType<typeof setTimeout> | null = null

export function clearSidebarPeekCloseTimer(): void {
  if (peekCloseTimer !== null) {
    clearTimeout(peekCloseTimer)
    peekCloseTimer = null
  }
}

/** 打开飞出；会取消 pending 关闭 */
export function openSidebarPeek(setPeeking: (value: boolean) => void): void {
  clearSidebarPeekCloseTimer()
  setPeeking(true)
}

/** 延迟关闭飞出（已在关闭倒计时时不重置，避免 pointermove 一直续命） */
export function scheduleCloseSidebarPeek(
  setPeeking: (value: boolean) => void,
  /** 定时器触发时再判一次；返回 false 则取消关闭（指针其实还在左侧） */
  shouldStillClose?: () => boolean,
): void {
  if (peekCloseTimer !== null) return
  peekCloseTimer = setTimeout(() => {
    peekCloseTimer = null
    if (shouldStillClose && !shouldStillClose()) return
    setPeeking(false)
  }, SIDEBAR_PEEK_CLOSE_DELAY_MS)
}

export interface SidebarPeekZoneOptions {
  /** 飞出面板宽度（含 classic 外间距） */
  panelWidth: number
  /** 是否已处于飞出态 */
  peeking: boolean
  /** 折叠按钮右缘（含红绿灯占位），飞出后该区域也算左侧热区 */
  toggleChromeRight: number
  titlebarHeight?: number
  hotzoneWidth?: number
}

/**
 * 指针是否应保持/打开侧栏飞出。
 * - 未飞出：仅左缘细热区（顶栏以下），避免悬停折叠按钮误弹出
 * - 已飞出：整个左侧面板列 + 顶栏折叠按钮区域，移到 Code/折叠按钮不关
 */
export function isPointerInSidebarPeekZone(
  clientX: number,
  clientY: number,
  options: SidebarPeekZoneOptions,
): boolean {
  if (clientX < 0 || clientY < 0) return false

  const titlebarHeight = options.titlebarHeight ?? SIDEBAR_PEEK_TITLEBAR_HEIGHT
  const hotzoneWidth = options.hotzoneWidth ?? SIDEBAR_PEEK_HOTZONE_WIDTH

  if (options.peeking) {
    // 整列侧栏（含顶部）
    if (clientX <= options.panelWidth) return true
    // 折叠按钮浮层可能略超出 panel 几何时仍算内侧
    if (clientY <= titlebarHeight && clientX <= options.toggleChromeRight) return true
    return false
  }

  // 打开热区：顶栏以下的左缘，不覆盖折叠按钮，避免点收起后立刻又飞出
  return clientX <= hotzoneWidth && clientY >= titlebarHeight
}
