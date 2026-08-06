import * as React from 'react'
import {
  computeSessionFloatingLayout,
  shouldInvalidateSessionFloatingPanelForce,
  type SessionFloatingLayout,
} from '@/lib/session-floating-layout'

const HIDDEN_LAYOUT: SessionFloatingLayout = {
  visible: false,
  contentOffsetX: 0,
  contentPanelGap: 0,
}

export interface SessionFloatingLayoutResult extends SessionFloatingLayout {
  /**
   * @deprecated Code 模式与 Chat 对齐：offset 只跟随真实宽度，不再做折叠专用 transition。
   * 保留字段以免调用方解构报错。
   */
  contentOffsetTransition?: string
}

/**
 * 计算会话悬浮面板布局。
 *
 * 与 Chat 对齐：contentOffsetX 只由容器真实宽度驱动（ResizeObserver 逐帧），
 * 不做「预测终态 / 冻结 / 结束后再对齐」。侧栏折叠时主区宽度本身已是 CSS
 * 连续动画；再叠加一套延迟或抢跑的 JS 宽度，就会和 Chat 不一样、看起来不同步。
 */
export function useSessionFloatingLayout(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  forceVisible = false,
  onForceVisibilityInvalidated?: () => void,
): SessionFloatingLayoutResult {
  const [viewportWidth, setViewportWidth] = React.useState(0)
  const [wasVisible, setWasVisible] = React.useState(false)
  const forcedAtViewportWidthRef = React.useRef<number | null>(null)
  const forceInvalidatedRef = React.useRef(false)
  const previousForceVisibleRef = React.useRef(false)

  React.useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateWidth = (): void => {
      const next = element.getBoundingClientRect().width
      setViewportWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
    }

    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [containerRef])

  React.useLayoutEffect(() => {
    if (!forceVisible) {
      forcedAtViewportWidthRef.current = null
      forceInvalidatedRef.current = false
      previousForceVisibleRef.current = false
      return
    }

    if (!previousForceVisibleRef.current) {
      forceInvalidatedRef.current = false
      forcedAtViewportWidthRef.current = viewportWidth > 0 ? viewportWidth : null
    } else if (
      forcedAtViewportWidthRef.current === null
      && !forceInvalidatedRef.current
      && viewportWidth > 0
    ) {
      forcedAtViewportWidthRef.current = viewportWidth
    }
    previousForceVisibleRef.current = true
  }, [forceVisible, viewportWidth])

  React.useLayoutEffect(() => {
    const forcedAtViewportWidth = forcedAtViewportWidthRef.current
    if (
      !forceVisible
      || forceInvalidatedRef.current
      || forcedAtViewportWidth === null
      || !shouldInvalidateSessionFloatingPanelForce({
        forcedAtViewportWidth,
        viewportWidth,
      })
    ) {
      return
    }

    forceInvalidatedRef.current = true
    forcedAtViewportWidthRef.current = null
    onForceVisibilityInvalidated?.()
  }, [forceVisible, onForceVisibilityInvalidated, viewportWidth])

  const effectiveForceVisible = forceVisible && !forceInvalidatedRef.current
  const layout = React.useMemo(() => {
    if (!enabled || viewportWidth <= 0) return HIDDEN_LAYOUT
    return computeSessionFloatingLayout({
      viewportWidth,
      contentWidth: Math.min(800, viewportWidth),
      wasVisible,
      forceVisible: effectiveForceVisible,
    })
  }, [effectiveForceVisible, enabled, viewportWidth, wasVisible])

  React.useEffect(() => {
    if (!enabled) {
      setWasVisible(false)
      return
    }
    setWasVisible(layout.visible)
  }, [enabled, layout.visible])

  return layout
}
