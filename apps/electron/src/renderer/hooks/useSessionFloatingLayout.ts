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

export function useSessionFloatingLayout(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  forceVisible = false,
  onForceVisibilityInvalidated?: () => void,
): SessionFloatingLayout {
  const [viewportWidth, setViewportWidth] = React.useState(0)
  const [wasVisible, setWasVisible] = React.useState(false)
  const forcedAtViewportWidthRef = React.useRef<number | null>(null)
  const forceInvalidatedRef = React.useRef(false)
  const previousForceVisibleRef = React.useRef(false)

  React.useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateWidth = (): void => {
      setViewportWidth(element.getBoundingClientRect().width)
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
