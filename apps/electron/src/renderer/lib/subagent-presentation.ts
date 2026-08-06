import type { SessionExecutionNode } from './session-execution-nodes'

export type SubagentPresentationStatus =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'interrupted'

export interface SubagentPresentation {
  id: string
  name: string
  avatarSeed: string
  status: SubagentPresentationStatus
  statusLabel: string
  modelTooltip?: string
  additions?: number
  deletions?: number
  canOpen: boolean
  canStop: boolean
}

export function normalizeSubagentName(value: string | undefined): string {
  const normalized = (value ?? '')
    .split('/')
    .filter((part) => part && part !== 'root')
    .at(-1)
    ?.replace(/[_-]+/g, ' ')
    .trim()
  return normalized || '智能体'
}

export function canOpenSubagentNode(node: SessionExecutionNode): boolean {
  return node.kind !== 'shell'
}

export function canStopSubagentNode(node: SessionExecutionNode): boolean {
  return node.source === 'delegation'
    && (node.status === 'queued' || node.status === 'running')
    && !!node.transcriptSessionId
}

export function buildSubagentPresentation(
  node: SessionExecutionNode,
  activelyRunning: boolean,
): SubagentPresentation {
  let status: SubagentPresentationStatus
  if (node.status === 'completed') status = 'completed'
  else if (node.status === 'failed') status = 'failed'
  else if (node.status === 'stopped') status = 'interrupted'
  else if (activelyRunning) status = 'running'
  else status = 'waiting'

  const statusLabel: Record<SubagentPresentationStatus, string> = {
    running: '正在运行',
    waiting: '正在等待指示',
    completed: '已完成',
    failed: '失败',
    interrupted: '已中断',
  }

  return {
    id: node.id,
    name: normalizeSubagentName(node.name || node.description),
    avatarSeed: node.id,
    status,
    statusLabel: statusLabel[status],
    modelTooltip: node.model ? `使用 ${node.model}` : undefined,
    canOpen: canOpenSubagentNode(node),
    canStop: canStopSubagentNode(node),
  }
}

export function subagentAvatarStyle(seed: string): {
  backgroundColor: string
  color: string
} {
  let hash = 0
  for (const character of seed) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  }
  const hue = Math.abs(hash) % 360
  return {
    backgroundColor: `hsl(${hue} 68% 88%)`,
    color: `hsl(${hue} 48% 30%)`,
  }
}
