/**
 * 侧栏折叠布局
 *
 * 正确模型（避免内容弹两下 / 面板与主区不同步）：
 * - 外列动画 width：peekWidth ↔ 0（overflow:hidden）——主区左缘与列右缘同帧伸缩
 * - 内层同曲线 translateX：0 ↔ -peekWidth——整栏视觉上往左滑出
 * - 任意插值时刻保持「内层右缘 = 外列右缘」，不会和主区脱节
 * - Code 模式悬浮正文 offset 只跟随容器真实宽度（与 Chat 一样无额外 transition）
 * - 禁止：预测终态宽度 / 动画结束后再批量改 offset（会和侧栏 CSS 脱节）
 * - 红绿灯与折叠按钮用 fixed 浮层，位置不随侧栏跳动
 * - TabBar 仅在侧栏收起时预留折叠按钮右缘，展开时贴主区左缘（不再垫一整段 chrome）
 */

/** 展开/收起动画时长（ms）——侧栏与主区共用 */
export const SIDEBAR_COLLAPSE_DURATION_MS = 400

/** 缓动：ease-out，无回弹 overshoot——侧栏与主区共用 */
export const SIDEBAR_COLLAPSE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** macOS 红绿灯右缘 */
export const MAC_TRAFFIC_LIGHT_END = 78
/** 红绿灯与折叠按钮间距 */
export const SIDEBAR_TOGGLE_GAP = 12
/** 折叠按钮固定 left（收起/展开不变） */
export const SIDEBAR_TOGGLE_LEFT = MAC_TRAFFIC_LIGHT_END + SIDEBAR_TOGGLE_GAP
/** 折叠按钮宽度 */
export const SIDEBAR_TOGGLE_SIZE = 32
/** 全局 drag 从按钮右缘之后开始，避免吞点击 */
export const TITLEBAR_DRAG_LEFT = SIDEBAR_TOGGLE_LEFT + SIDEBAR_TOGGLE_SIZE

/** macOS 红绿灯 + 折叠按钮热区（仅 fixed 浮层定位用，不进文档流） */
export const SIDEBAR_CHROME_RESERVE_MAC = TITLEBAR_DRAG_LEFT

/** 非 mac */
export const SIDEBAR_CHROME_RESERVE_OTHER = 44

/** 折叠按钮右缘与草稿/会话 Tab 的间距 */
export const SIDEBAR_TAB_GAP = 8

export function sidebarChromeReserve(isMac: boolean): number {
  return isMac ? SIDEBAR_CHROME_RESERVE_MAC : SIDEBAR_CHROME_RESERVE_OTHER
}

/**
 * 侧栏收起时 TabBar 左内边距：折叠按钮右缘 + 与 tab 的小间距。
 * 展开时不要用这个值——主区已在侧栏右侧，再垫会空一大截。
 */
export function sidebarTopChromeReserve(isMac: boolean): number {
  return sidebarChromeReserve(isMac) + SIDEBAR_TAB_GAP
}

/** 侧栏折叠主动画：列宽 0↔peekWidth，主区同帧伸缩 */
export function sidebarWidthTransition(enabled: boolean): string | undefined {
  if (!enabled) return undefined
  return `width ${SIDEBAR_COLLAPSE_DURATION_MS}ms ${SIDEBAR_COLLAPSE_EASING}`
}

/** 悬浮正文 offset 与侧栏折叠同步的 transition（transform） */
export function sidebarContentOffsetTransition(enabled: boolean): string | undefined {
  if (!enabled) return undefined
  return `transform ${SIDEBAR_COLLAPSE_DURATION_MS}ms ${SIDEBAR_COLLAPSE_EASING}`
}

/** 少数仍用 margin 对齐的叠加层 */
export function sidebarContentOffsetMarginTransition(enabled: boolean): string | undefined {
  if (!enabled) return undefined
  return `margin-left ${SIDEBAR_COLLAPSE_DURATION_MS}ms ${SIDEBAR_COLLAPSE_EASING}`
}

/** @deprecated 旧 margin-left 滑出模型；折叠请用 sidebarWidthTransition */
export function sidebarMarginTransition(enabled: boolean): string | undefined {
  if (!enabled) return undefined
  return `margin-left ${SIDEBAR_COLLAPSE_DURATION_MS}ms ${SIDEBAR_COLLAPSE_EASING}`
}

/** @deprecated 旧 transform 动画；折叠请用 sidebarWidthTransition */
export function sidebarTransformTransition(enabled: boolean): string | undefined {
  if (!enabled) return undefined
  return `transform ${SIDEBAR_COLLAPSE_DURATION_MS}ms ${SIDEBAR_COLLAPSE_EASING}`
}

/**
 * 全局顶栏 drag 起点。
 * Electron 的 -webkit-app-region:drag 不完全遵循 z-index，会盖住上层 no-drag 按钮/飞出面板。
 * 收起并悬停飞出时，必须把 drag 推到侧栏右缘之外，否则：
 * - 折叠按钮点一次后点不动
 * - 飞出面板顶部 52px 进不去 hover 热区，鼠标移上去会误关
 */
export function titlebarDragLeftOffset(options: {
  isMac: boolean
  sidebarCollapsed: boolean
  sidebarPeeking: boolean
  leftSidebarWidth: number
}): number {
  const base = options.isMac ? TITLEBAR_DRAG_LEFT : 12 + SIDEBAR_TOGGLE_SIZE
  if (options.sidebarCollapsed && options.sidebarPeeking) {
    return Math.max(base, options.leftSidebarWidth)
  }
  return base
}
