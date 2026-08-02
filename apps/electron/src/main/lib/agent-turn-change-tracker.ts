/**
 * Agent 本轮文件改动统计
 *
 * 每轮开始前使用临时 Git Index 创建工作树基线；后续将当前工作树快照与基线比较，
 * 因而不会把本轮开始前已经存在的未提交修改计入统计。
 */

import { statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { AgentTurnChangeStats } from '@proma/shared'
import {
  createGitWorkingTreeSnapshot,
  findAllGitRoots,
  getGitTreeChangeStats,
  normalizeGitRoot,
} from './git-diff-service'
import type { GitWorkingTreeSnapshot } from './git-diff-service'

interface TrackingCandidate {
  absolutePath: string
  searchPath: string
  fileOnly: boolean
}

interface AgentTurnChangeTrackingState {
  startedAt: number
  repositories: GitWorkingTreeSnapshot[]
}

interface AgentTurnChangeStatsRequest {
  state: AgentTurnChangeTrackingState
  request: Promise<AgentTurnChangeStats | null>
}

const trackingStates = new Map<string, AgentTurnChangeTrackingState>()
const statsRequests = new Map<string, AgentTurnChangeStatsRequest>()

function isPathInside(parentPath: string, childPath: string): boolean {
  const rel = relative(parentPath, childPath)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function toTrackingCandidate(path: string): TrackingCandidate | null {
  if (!path) return null
  const absolutePath = resolve(path)
  try {
    const stats = statSync(absolutePath)
    if (stats.isFile()) {
      return {
        absolutePath,
        searchPath: dirname(absolutePath),
        fileOnly: true,
      }
    }
    if (stats.isDirectory()) {
      return {
        absolutePath,
        searchPath: absolutePath,
        fileOnly: false,
      }
    }
  } catch {
    return null
  }
  return null
}

function scopeIncludesRelativePath(pathspecs: Set<string>, relativePath: string): boolean {
  for (const pathspec of pathspecs) {
    if (pathspec.startsWith(':(')) continue
    if (
      pathspec === '.'
      || pathspec === relativePath
      || relativePath.startsWith(`${pathspec}/`)
    ) {
      return true
    }
  }
  return false
}

/**
 * 为每个候选路径选择最贴近的 Git 仓库。
 *
 * 候选位于仓库内时选择最深的祖先仓库；候选目录下存在嵌套仓库时同时保留，
 * 并从父仓库 pathspec 中排除嵌套仓库，避免 gitlink 与内部文件重复计数。
 */
async function resolveRepositoryScopes(paths: string[]): Promise<Map<string, Set<string>>> {
  const scopes = new Map<string, Set<string>>()
  const candidates = Array.from(new Set(paths.map(path => resolve(path))))
    .map(toTrackingCandidate)
    .filter((candidate): candidate is TrackingCandidate => candidate !== null)

  for (const candidate of candidates) {
    const roots = await findAllGitRoots(candidate.searchPath)
    const ancestorRoots = roots
      .filter((root) => isPathInside(root, candidate.absolutePath))
      .sort((a, b) => b.length - a.length)
    const descendantRoots = candidate.fileOnly
      ? []
      : roots.filter((root) => isPathInside(candidate.absolutePath, root))
    const selectedRoots = Array.from(new Set([
      ...(ancestorRoots.length > 0 ? [ancestorRoots[0]!] : []),
      ...descendantRoots,
    ]))

    for (const root of selectedRoots) {
      const normalizedRoot = normalizeGitRoot(root)
      let pathspec: string
      if (isPathInside(root, candidate.absolutePath)) {
        const rel = relative(root, candidate.absolutePath).replace(/\\/g, '/')
        pathspec = rel || '.'
      } else {
        pathspec = '.'
      }

      const existing = scopes.get(normalizedRoot) ?? new Set<string>()
      existing.add(pathspec)
      scopes.set(normalizedRoot, existing)
    }
  }

  for (const [parentRoot, parentPathspecs] of scopes) {
    for (const childRoot of scopes.keys()) {
      if (childRoot === parentRoot || !isPathInside(parentRoot, childRoot)) continue
      const childRelativePath = relative(parentRoot, childRoot).replace(/\\/g, '/')
      if (!scopeIncludesRelativePath(parentPathspecs, childRelativePath)) continue
      parentPathspecs.add(`:(exclude)${childRelativePath}`)
    }
  }

  return scopes
}

/** 在 Agent 真正开始本轮执行前创建 Git 工作树基线。 */
export async function startAgentTurnChangeTracking(input: {
  sessionId: string
  startedAt: number
  paths: string[]
}): Promise<void> {
  const { sessionId, startedAt, paths } = input
  trackingStates.delete(sessionId)
  statsRequests.delete(sessionId)

  const scopes = await resolveRepositoryScopes(paths)
  const repositories: GitWorkingTreeSnapshot[] = []

  for (const [gitRoot, pathspecSet] of scopes) {
    const snapshot = await createGitWorkingTreeSnapshot(gitRoot, Array.from(pathspecSet))
    if (snapshot) repositories.push(snapshot)
  }

  trackingStates.set(sessionId, {
    startedAt,
    repositories,
  })
}

/** 获取当前工作树相对本轮基线的文件数量和增删行数。 */
export async function getAgentTurnChangeStats(
  sessionId: string,
): Promise<AgentTurnChangeStats | null> {
  const state = trackingStates.get(sessionId)
  if (!state || state.repositories.length === 0) return null

  const pending = statsRequests.get(sessionId)
  if (pending?.state === state) return pending.request

  const request = (async (): Promise<AgentTurnChangeStats | null> => {
    let filesChanged = 0
    let additions = 0
    let deletions = 0
    let successfulRepositories = 0
    const files: AgentTurnChangeStats['files'] = []

    for (const baseline of state.repositories) {
      const current = await createGitWorkingTreeSnapshot(
        baseline.gitRoot,
        baseline.pathspecs,
      )
      if (!current) continue
      const stats = await getGitTreeChangeStats(baseline, current)
      if (!stats) continue

      successfulRepositories += 1
      filesChanged += stats.filesChanged
      additions += stats.additions
      deletions += stats.deletions
      for (const file of stats.files) {
        files.push({
          // 多仓库时保留相对路径；单文件名展示由渲染层处理
          path: file.path,
          additions: file.additions,
          deletions: file.deletions,
        })
      }
    }

    if (successfulRepositories === 0) return null
    if (trackingStates.get(sessionId) !== state) return null

    return {
      startedAt: state.startedAt,
      filesChanged,
      additions,
      deletions,
      files,
      updatedAt: Date.now(),
    }
  })()

  statsRequests.set(sessionId, { state, request })
  try {
    return await request
  } finally {
    if (statsRequests.get(sessionId)?.request === request) {
      statsRequests.delete(sessionId)
    }
  }
}

/** 会话删除时释放本轮统计状态。 */
export function clearAgentTurnChangeTracking(sessionId: string): void {
  trackingStates.delete(sessionId)
  statsRequests.delete(sessionId)
}
