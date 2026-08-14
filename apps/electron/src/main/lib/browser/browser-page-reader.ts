/**
 * Proma 内置浏览器页面读取器。
 *
 * 直接通过 Electron WebFrameMain 读取内置 webview 的主文档和跨域 iframe，
 * 为可交互元素生成稳定的短引用（如 f1e3）。后续 click/type 直接复用引用，
 * 不再要求模型猜 CSS selector。
 */

import type { WebContents, WebFrameMain } from 'electron'
import { browserAgentPointerExpression } from './browser-agent-pointer'

const MAX_PAGE_TEXT_LENGTH = 12_000
const MAX_PAGE_ELEMENTS = 80
const MAX_ELEMENT_JSON_LENGTH = 18_000
const MAX_FRAME_TEXT_PREVIEW_LENGTH = 500

export interface BrowserReadableElement {
  ref: string
  role: string
  name: string
  tag: string
  type?: string
  value?: string
  href?: string
  disabled?: boolean
  checked?: boolean
  selected?: boolean
  required?: boolean
  editable?: boolean
}

export interface BrowserReadableFrame {
  frameIndex: number
  frameName: string
  frameUrl: string
  frameOrigin: string
  isMainFrame: boolean
  title: string
  text: string
  textLength: number
  elementCount: number
}

export interface BrowserPageSnapshot {
  url: string
  title: string
  text: string
  elements: BrowserReadableElement[]
  frames: BrowserReadableFrame[]
  usage: string
}

interface FrameDomSnapshot {
  title: string
  text: string
  elements: BrowserReadableElement[]
}

interface BrowserElementCandidate {
  element: BrowserReadableElement
  frame: WebFrameMain
  order: number
}

export interface BrowserPageReadResult {
  snapshot: BrowserPageSnapshot
  elementFrames: Map<string, WebFrameMain>
}

interface BrowserElementActionResult {
  ok: boolean
  reason?: string
}

function elementPriority(element: BrowserReadableElement): number {
  if (element.editable || ['textbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch'].includes(element.role)) {
    return 3
  }
  if (['button', 'link', 'menuitem', 'option', 'tab', 'slider', 'spinbutton'].includes(element.role)) {
    return 2
  }
  return element.name ? 1 : 0
}

function selectElementCandidates(candidates: BrowserElementCandidate[]): BrowserElementCandidate[] {
  let used = 0
  const selected = [...candidates]
    .sort((left, right) => (
      elementPriority(right.element) - elementPriority(left.element)
      || left.order - right.order
    ))
    .filter(({ element }) => {
      if (used >= MAX_ELEMENT_JSON_LENGTH) return false
      const size = JSON.stringify(element).length
      if (used > 0 && used + size > MAX_ELEMENT_JSON_LENGTH) return false
      used += size
      return true
    })
    .slice(0, MAX_PAGE_ELEMENTS)

  return selected.sort((left, right) => left.order - right.order)
}

function snapshotScript(frameIndex: number): string {
  return `(() => {
    const framePrefix = ${JSON.stringify(`f${frameIndex}e`)};
    const elementStore = new Map();
    globalThis.__promaBrowserElementsV1 = elementStore;

    const compact = (value, max = 160) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const roleOf = (element) => {
      const explicit = compact(element.getAttribute('role'), 40);
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      const type = compact(element.getAttribute('type'), 40).toLowerCase();
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (tag === 'button' || tag === 'summary') return 'button';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
      if (tag === 'input') {
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
        if (type === 'range') return 'slider';
        return 'textbox';
      }
      if (element.isContentEditable) return 'textbox';
      return 'interactive';
    };
    const accessibleName = (element) => {
      const ariaLabel = compact(element.getAttribute('aria-label'));
      if (ariaLabel) return ariaLabel;
      const labelledBy = compact(element.getAttribute('aria-labelledby'), 500);
      if (labelledBy) {
        const text = labelledBy.split(/\\s+/)
          .map((id) => document.getElementById(id)?.textContent || '')
          .join(' ');
        if (compact(text)) return compact(text);
      }
      if (element.labels?.length) {
        const text = Array.from(element.labels).map((label) => label.textContent || '').join(' ');
        if (compact(text)) return compact(text);
      }
      return compact(
        element.getAttribute('alt')
        || element.getAttribute('placeholder')
        || element.getAttribute('title')
        || element.textContent
        || element.getAttribute('name')
        || element.id
      );
    };
    const isInteractive = (element) => {
      const tag = element.tagName.toLowerCase();
      if (['button', 'input', 'textarea', 'select', 'summary'].includes(tag)) return true;
      if (tag === 'a' && element.hasAttribute('href')) return true;
      if (element.isContentEditable || element.hasAttribute('onclick')) return true;
      if (element.hasAttribute('tabindex')) {
        const tabIndex = Number(element.getAttribute('tabindex'));
        if (Number.isFinite(tabIndex) && tabIndex >= 0) return true;
      }
      const role = compact(element.getAttribute('role'), 40);
      return ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox', 'menuitem', 'option', 'switch', 'tab', 'slider', 'spinbutton'].includes(role);
    };
    const roots = [document];
    const allElements = [];
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      for (const element of Array.from(root.querySelectorAll('*'))) {
        allElements.push(element);
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    const elements = [];
    for (const element of allElements) {
      if (elements.length >= 120 || !isInteractive(element) || !isVisible(element)) continue;
      const ref = framePrefix + (elements.length + 1);
      elementStore.set(ref, element);
      const tag = element.tagName.toLowerCase();
      const type = compact(element.getAttribute('type'), 40).toLowerCase();
      const isPassword = tag === 'input' && type === 'password';
      const value = isPassword ? '' : compact(element.value ?? element.getAttribute('value'), 300);
      const item = {
        ref,
        role: roleOf(element),
        name: accessibleName(element),
        tag,
        ...(type ? { type } : {}),
        ...(value ? { value } : {}),
        ...(element.href ? { href: compact(element.href, 1000) } : {}),
        ...(element.disabled || element.getAttribute('aria-disabled') === 'true' ? { disabled: true } : {}),
        ...(typeof element.checked === 'boolean' ? { checked: element.checked } : {}),
        ...(typeof element.selected === 'boolean' ? { selected: element.selected } : {}),
        ...(element.required || element.getAttribute('aria-required') === 'true' ? { required: true } : {}),
        ...((tag === 'input' || tag === 'textarea' || element.isContentEditable) ? { editable: true } : {}),
      };
      elements.push(item);
    }
    return {
      title: document.title || '',
      text: compact(document.body?.innerText || '', 6000),
      elements,
    };
  })()`
}

function actionScript(ref: string, action: 'click' | 'type', text = ''): string {
  return `(async () => {
    const store = globalThis.__promaBrowserElementsV1;
    const element = store instanceof Map ? store.get(${JSON.stringify(ref)}) : null;
    if (!element || !element.isConnected) return { ok: false, reason: 'stale' };
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
      return { ok: false, reason: 'disabled' };
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const rect = element.getBoundingClientRect();
    const pointer = ${browserAgentPointerExpression()};
    ${action === 'click'
      ? `
        await pointer.click(rect);
        element.focus();
        element.click();
      `
      : `
        await pointer.type(rect);
        element.focus();
        const nextValue = ${JSON.stringify(text)};
        if (element.isContentEditable) {
          element.textContent = nextValue;
        } else {
          const proto = element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : element instanceof HTMLSelectElement
              ? HTMLSelectElement.prototype
              : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(element, nextValue);
          else element.value = nextValue;
        }
        element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: nextValue }));
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nextValue }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      `}
    return { ok: true };
  })()`
}

export async function readBrowserPage(contents: WebContents): Promise<BrowserPageReadResult> {
  const frames: BrowserReadableFrame[] = []
  const frameTexts: string[] = []
  const candidates: BrowserElementCandidate[] = []
  const elementFrames = new Map<string, WebFrameMain>()
  const errors: string[] = []

  for (const [frameIndex, frame] of contents.mainFrame.framesInSubtree.entries()) {
    if (frame.isDestroyed()) continue
    try {
      const value = await frame.executeJavaScript(snapshotScript(frameIndex), true) as FrameDomSnapshot
      const readableFrame: BrowserReadableFrame = {
        frameIndex,
        frameName: frame.name,
        frameUrl: frame.url,
        frameOrigin: frame.origin,
        isMainFrame: frame.parent == null,
        title: value.title,
        text: value.text.slice(0, MAX_FRAME_TEXT_PREVIEW_LENGTH),
        textLength: value.text.length,
        elementCount: value.elements.length,
      }
      frames.push(readableFrame)
      frameTexts.push(value.text)
      for (const element of value.elements) {
        candidates.push({ element, frame, order: candidates.length })
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '页面 frame 读取失败')
    }
  }

  if (frames.length === 0) {
    throw new Error(errors[0] ?? '没有可读取的页面 frame')
  }

  const main = frames.find((frame) => frame.isMainFrame) ?? frames[0]!
  const elements = selectElementCandidates(candidates)
    .map(({ element, frame }) => {
      elementFrames.set(element.ref, frame)
      return element
    })
  const text = frames
    .map((_, index) => frameTexts[index] ?? '')
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_PAGE_TEXT_LENGTH)

  return {
    snapshot: {
      url: contents.getURL() || main.frameUrl,
      title: contents.getTitle() || main.title,
      text,
      elements,
      frames,
      usage: '后续 browser_click/browser_type 优先传元素 ref；页面变化后 ref 可能失效，重新调用 browser_get_state 即可刷新。',
    },
    elementFrames,
  }
}

export async function clickBrowserElement(frame: WebFrameMain, ref: string): Promise<BrowserElementActionResult> {
  return frame.executeJavaScript(actionScript(ref, 'click'), true) as Promise<BrowserElementActionResult>
}

export async function typeBrowserElement(
  frame: WebFrameMain,
  ref: string,
  text: string,
): Promise<BrowserElementActionResult> {
  return frame.executeJavaScript(actionScript(ref, 'type', text), true) as Promise<BrowserElementActionResult>
}
