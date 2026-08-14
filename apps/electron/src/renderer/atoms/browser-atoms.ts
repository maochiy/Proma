/**
 * Proma Browser 状态。
 *
 * 标注属于 Agent 会话，而不是单个 BrowserPanel 组件；这样切换右侧面板
 * 或设置页面时，已采集的页面证据仍然可以被当前消息引用。
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { BrowserAnnotation } from '@proma/shared'

export const browserAnnotationsAtomFamily = atomFamily((sessionId: string) =>
  atom<BrowserAnnotation[]>([]),
)

export const browserSelectedAnnotationIdsAtomFamily = atomFamily((sessionId: string) =>
  atom<Set<string>>(new Set<string>()),
)

export function browserAnnotationKey(annotation: BrowserAnnotation): string {
  return [
    annotation.createdAt,
    annotation.target,
    annotation.url,
    annotation.comment,
    annotation.rect.x,
    annotation.rect.y,
  ].join(':')
}

// ============================================================================
// Browser Agent 任务（悬浮面板「浏览器」列表 + 任务 Tab label）
// ============================================================================

import type { BrowserAgentTask } from '@proma/shared'

/** 当前各会话的浏览器任务（taskId → task），由订阅 browser-agent 事件维护。 */
export const browserAgentTasksAtom = atom<Map<string, BrowserAgentTask>>(new Map())
