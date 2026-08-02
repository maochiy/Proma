export interface SessionFloatingLayoutInput {
  viewportWidth: number
  contentWidth: number
  panelWidth?: number
  panelRightInset?: number
  minimumContentPanelGap?: number
  minimumContentLeftInset?: number
  restoreHysteresis?: number
  wasVisible?: boolean
  forceVisible?: boolean
}

export interface SessionFloatingLayout {
  visible: boolean
  contentOffsetX: number
  contentPanelGap: number
}

export interface SessionFloatingPanelToggleInput {
  enabled: boolean
  actuallyVisible: boolean
}

export interface SessionFloatingPanelToggleResult {
  enabled: boolean
  forceVisible: boolean
}

export interface SessionFloatingPanelForceInvalidationInput {
  forcedAtViewportWidth: number
  viewportWidth: number
  tolerance?: number
}

const DEFAULT_PANEL_WIDTH = 300
const DEFAULT_PANEL_RIGHT_INSET = 16
const DEFAULT_MINIMUM_GAP = 80
const DEFAULT_MINIMUM_LEFT_INSET = 24
const DEFAULT_RESTORE_HYSTERESIS = 24

/**
 * 解析顶部悬浮面板按钮的下一状态。
 *
 * 面板已实际显示时点击代表隐藏；若只是因空间不足被自动隐藏，
 * 点击则保持用户偏好开启，并进入允许覆盖正文的强制显示状态。
 */
export function resolveSessionFloatingPanelToggle(
  input: SessionFloatingPanelToggleInput,
): SessionFloatingPanelToggleResult {
  if (input.enabled && input.actuallyVisible) {
    return {
      enabled: false,
      forceVisible: false,
    }
  }

  return {
    enabled: true,
    forceVisible: true,
  }
}

/**
 * 判断用户手动强制显示是否应失效。
 *
 * 强制显示只用于响应当前宽度下的一次主动操作；窗口、左右侧栏或右侧功能区
 * 导致会话视口宽度变化后，应恢复原有自动隐藏逻辑。
 */
export function shouldInvalidateSessionFloatingPanelForce(
  input: SessionFloatingPanelForceInvalidationInput,
): boolean {
  const tolerance = input.tolerance ?? 1
  if (input.forcedAtViewportWidth <= 0 || input.viewportWidth <= 0) return false
  return Math.abs(input.viewportWidth - input.forcedAtViewportWidth) > tolerance
}

/**
 * 计算 Codex 风格会话布局。
 *
 * 正文优先保持现有居中位置；空间变窄时仅整体向左移动，
 * 不修改正文宽度。若移动后左侧安全间距仍不足，则隐藏悬浮面板。
 */
export function computeSessionFloatingLayout(
  input: SessionFloatingLayoutInput,
): SessionFloatingLayout {
  const panelWidth = input.panelWidth ?? DEFAULT_PANEL_WIDTH
  const panelRightInset = input.panelRightInset ?? DEFAULT_PANEL_RIGHT_INSET
  const minimumGap = input.minimumContentPanelGap ?? DEFAULT_MINIMUM_GAP
  const minimumLeftInset = input.minimumContentLeftInset ?? DEFAULT_MINIMUM_LEFT_INSET
  const restoreHysteresis = input.restoreHysteresis ?? DEFAULT_RESTORE_HYSTERESIS
  const viewportWidth = Math.max(0, input.viewportWidth)
  const contentWidth = Math.min(Math.max(0, input.contentWidth), viewportWidth)

  const centeredLeft = Math.max(0, (viewportWidth - contentWidth) / 2)
  const panelLeft = viewportWidth - panelRightInset - panelWidth
  const maximumContentLeft = panelLeft - minimumGap - contentWidth
  const contentLeft = Math.min(centeredLeft, maximumContentLeft)
  const requiredLeftInset = minimumLeftInset + (input.wasVisible ? 0 : restoreHysteresis)

  if (contentLeft < requiredLeftInset || panelLeft <= 0) {
    if (input.forceVisible) {
      return {
        visible: true,
        contentOffsetX: 0,
        contentPanelGap: panelLeft - (centeredLeft + contentWidth),
      }
    }

    return {
      visible: false,
      contentOffsetX: 0,
      contentPanelGap: 0,
    }
  }

  return {
    visible: true,
    contentOffsetX: contentLeft - centeredLeft,
    contentPanelGap: panelLeft - (contentLeft + contentWidth),
  }
}
