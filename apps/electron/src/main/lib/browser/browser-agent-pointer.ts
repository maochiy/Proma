interface BrowserAgentPointer {
  click(rect: DOMRect): Promise<void>
  type(rect: DOMRect): Promise<void>
  scroll(direction: 'up' | 'down'): Promise<void>
}

/**
 * 在当前 frame 内安装 Agent 虚拟鼠标。
 *
 * 该函数会通过 toString 注入网页，因此必须保持自包含，不能引用模块外变量。
 * 每个 frame 独立维护坐标，跨域 iframe 操作时无需换算顶层页面坐标。
 */
function installBrowserAgentPointer(): BrowserAgentPointer {
  interface PointerGlobal {
    __promaBrowserAgentPointerV1?: BrowserAgentPointer
  }

  const pointerGlobal = globalThis as typeof globalThis & PointerGlobal
  const existing = pointerGlobal.__promaBrowserAgentPointerV1
  if (existing) return existing

  const host = document.createElement('div')
  host.setAttribute('data-proma-agent-pointer', '')
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
  })
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }
    .cursor {
      position: fixed; left: 0; top: 0; width: 22px; height: 28px; opacity: 0;
      filter: drop-shadow(0 3px 5px rgb(0 0 0 / 35%));
      transform: translate3d(-40px, -40px, 0); will-change: transform;
    }
    .cursor svg { display: block; width: 100%; height: 100%; }
    .trail, .ripple { position: fixed; border-radius: 999px; transform: translate(-50%, -50%); }
    .trail {
      width: 8px; height: 8px; background: rgb(99 102 241 / 72%);
      box-shadow: 0 0 10px rgb(99 102 241 / 55%);
      animation: proma-agent-trail 420ms ease-out forwards;
    }
    .ripple {
      width: 12px; height: 12px; border: 3px solid #6366f1;
      animation: proma-agent-ripple 420ms ease-out forwards;
    }
    .target {
      position: fixed; display: none; box-sizing: border-box;
      border: 2px solid rgb(99 102 241 / 88%); border-radius: 7px;
      background: rgb(99 102 241 / 10%); box-shadow: 0 0 0 3px rgb(99 102 241 / 12%);
      animation: proma-agent-fade 520ms ease-out forwards;
    }
    .badge {
      position: fixed; display: none; min-width: 26px; padding: 5px 8px;
      border: 1px solid rgb(255 255 255 / 65%); border-radius: 999px; color: white;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      box-shadow: 0 5px 16px rgb(67 56 202 / 32%);
      font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center; white-space: nowrap;
      animation: proma-agent-fade 520ms ease-out forwards;
    }
    @keyframes proma-agent-trail {
      from { opacity: .9; transform: translate(-50%, -50%) scale(1); }
      to { opacity: 0; transform: translate(-50%, -50%) scale(.2); }
    }
    @keyframes proma-agent-ripple {
      from { opacity: 1; transform: translate(-50%, -50%) scale(.35); }
      to { opacity: 0; transform: translate(-50%, -50%) scale(3.2); }
    }
    @keyframes proma-agent-fade { 0%, 65% { opacity: 1; } 100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .trail { display: none; }
      .ripple, .target, .badge { animation-duration: 80ms; }
    }
  `
  const cursor = document.createElement('div')
  cursor.className = 'cursor'
  cursor.innerHTML = `
    <svg viewBox="0 0 24 30" aria-hidden="true">
      <path d="M2.2 1.8 21 17.1l-8.1 1.2 4.5 8.1-4.3 2.3-4.4-8-5.1 6.4z"
        fill="#6366f1" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>
  `
  const target = document.createElement('div')
  target.className = 'target'
  const badge = document.createElement('div')
  badge.className = 'badge'
  shadow.append(style, target, cursor, badge)
  document.documentElement.appendChild(host)

  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))
  let x = Math.max(18, Math.round(window.innerWidth * 0.72))
  let y = Math.max(18, Math.round(window.innerHeight * 0.28))
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined

  const addEffect = (className: 'trail' | 'ripple', effectX: number, effectY: number): void => {
    const effect = document.createElement('div')
    effect.className = className
    effect.style.left = `${effectX}px`
    effect.style.top = `${effectY}px`
    shadow.appendChild(effect)
    setTimeout(() => effect.remove(), reducedMotion ? 100 : 480)
  }

  const move = async (nextX: number, nextY: number): Promise<void> => {
    const startX = x
    const startY = y
    const steps = reducedMotion ? 1 : 10
    cursor.style.opacity = '1'
    for (let step = 1; step <= steps; step += 1) {
      const eased = 1 - Math.pow(1 - step / steps, 3)
      x = startX + (nextX - startX) * eased
      y = startY + (nextY - startY) * eased
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`
      if (!reducedMotion && step % 2 === 0) addEffect('trail', x + 2, y + 3)
      await wait(reducedMotion ? 16 : 28)
    }
  }

  const centerOf = (rect: DOMRect): { x: number; y: number } => ({
    x: Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2)),
    y: Math.max(8, Math.min(window.innerHeight - 8, rect.top + rect.height / 2)),
  })

  const replayAnimation = (element: HTMLElement): void => {
    element.style.animation = 'none'
    void element.offsetWidth
    element.style.animation = ''
  }

  const showFeedback = (rect: DOMRect, label: string): void => {
    Object.assign(target.style, {
      display: 'block',
      left: `${Math.max(0, rect.left - 3)}px`,
      top: `${Math.max(0, rect.top - 3)}px`,
      width: `${Math.max(8, rect.width + 6)}px`,
      height: `${Math.max(8, rect.height + 6)}px`,
    })
    badge.textContent = label
    Object.assign(badge.style, {
      display: 'block',
      left: `${Math.max(8, Math.min(window.innerWidth - 70, rect.left))}px`,
      top: `${Math.max(8, rect.top - 30)}px`,
    })
    replayAnimation(target)
    replayAnimation(badge)
    if (feedbackTimer) clearTimeout(feedbackTimer)
    feedbackTimer = setTimeout(() => {
      target.style.display = 'none'
      badge.style.display = 'none'
    }, reducedMotion ? 100 : 560)
  }

  const pointAt = async (rect: DOMRect, label: string): Promise<void> => {
    const center = centerOf(rect)
    await move(center.x, center.y)
    showFeedback(rect, label)
    addEffect('ripple', center.x, center.y)
    await wait(reducedMotion ? 24 : 150)
  }

  const pointer: BrowserAgentPointer = {
    click: (rect) => pointAt(rect, '点击'),
    type: (rect) => pointAt(rect, '输入'),
    async scroll(direction) {
      const nextX = Math.max(24, window.innerWidth - 42)
      const nextY = Math.max(40, window.innerHeight / 2)
      await move(nextX, nextY)
      badge.textContent = direction === 'up' ? '↑ 滚动' : '↓ 滚动'
      Object.assign(badge.style, {
        display: 'block',
        left: `${Math.max(8, nextX - 28)}px`,
        top: `${Math.max(8, nextY - 38)}px`,
      })
      replayAnimation(badge)
      addEffect('ripple', nextX, nextY)
      if (feedbackTimer) clearTimeout(feedbackTimer)
      feedbackTimer = setTimeout(() => { badge.style.display = 'none' }, reducedMotion ? 100 : 520)
      await wait(reducedMotion ? 24 : 140)
    },
  }
  pointerGlobal.__promaBrowserAgentPointerV1 = pointer
  return pointer
}

/** 返回可注入任意页面 frame 的 Agent 虚拟鼠标表达式。 */
export function browserAgentPointerExpression(): string {
  return `(${installBrowserAgentPointer.toString()})()`
}
