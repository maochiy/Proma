/**
 * Git 写操作与分支/远程管理
 *
 * 悬浮面板的分支切换、提交、推送、AI 提交信息生成。
 * 读路径的 diff 逻辑仍在 git-diff-service。
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import {
  CCB_NATIVE_CHANNEL_ID,
  type CheckoutGitBranchInput,
  type GenerateGitCommitMessageInput,
  type GenerateGitCommitMessageResult,
  type GitCommitAndPushInput,
  type GitCommitInput,
  type GitOperationResult,
  type GitPushInput,
  type ListGitBranchesResult,
  type ListGitRemotesResult,
} from '@proma/shared'
import { getAdapter, fetchTitle } from '@proma/core'
import { listChannels, resolveChannelRuntimeApiKey } from './channel-manager'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { findGitRoot, normalizeGitRoot } from './git-diff-service'

interface GitExecResult {
  code: number | null
  stdout: string
  stderr: string
}

const DEFAULT_TIMEOUT_MS = 60_000
const PUSH_TIMEOUT_MS = 120_000
const MAX_DIFF_CONTEXT_CHARS = 8_000

function runGit(
  args: string[],
  cwd: string,
  options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<GitExecResult> {
  return new Promise((resolvePromise) => {
    try {
      const child = spawn('git', ['-c', 'core.quotePath=false', ...args], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          ...options?.env,
        },
      })

      child.stdout?.setEncoding('utf-8')
      child.stderr?.setEncoding('utf-8')

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data) => {
        stdout += data
      })
      child.stderr?.on('data', (data) => {
        stderr += data
      })

      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        resolvePromise({
          code: null,
          stdout: stdout.trim(),
          stderr: stderr.trim() || 'git 命令超时',
        })
      }, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      child.on('close', (code) => {
        clearTimeout(timeout)
        resolvePromise({
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      })

      child.on('error', (err) => {
        clearTimeout(timeout)
        resolvePromise({
          code: null,
          stdout: stdout.trim(),
          stderr: err instanceof Error ? err.message : String(err),
        })
      })
    } catch (error) {
      resolvePromise({
        code: null,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

function formatGitError(result: GitExecResult, fallback: string): string {
  const text = (result.stderr || result.stdout || fallback).trim()
  // 取首个有意义的错误行，避免堆满整个 toast
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? fallback
  return firstLine.slice(0, 400)
}

async function resolveRepoRoot(dirPath: string): Promise<string | null> {
  if (!dirPath || typeof dirPath !== 'string' || !existsSync(dirPath)) {
    return null
  }
  const resolved = resolve(dirPath)
  const toplevel = await runGit(['rev-parse', '--show-toplevel'], resolved, { timeoutMs: 10_000 })
  if (toplevel.code === 0 && toplevel.stdout) {
    return normalizeGitRoot(toplevel.stdout)
  }
  // 兜底：兼容某些 worktree / 嵌套场景
  const root = await findGitRoot(resolved)
  return root ? normalizeGitRoot(root) : null
}

function isValidBranchName(name: string): boolean {
  if (!name || name.length > 200) return false
  if (name === 'HEAD' || name.startsWith('-')) return false
  // 拒绝路径穿越与 git 不允许的字符
  if (name.includes('..') || name.includes('\\') || name.includes('//')) return false
  if (/\s/.test(name)) return false
  if (/[\x00-\x1f~^:?*\[\\]/.test(name)) return false
  if (name.endsWith('.') || name.endsWith('/')) return false
  if (name.includes('@{')) return false
  return true
}

/**
 * 列出本地分支
 */
export async function listGitBranches(dirPath: string): Promise<ListGitBranchesResult> {
  const root = await resolveRepoRoot(dirPath)
  if (!root) {
    return { isRepo: false, currentBranch: null, branches: [] }
  }

  const currentResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root, {
    timeoutMs: 10_000,
  })
  const currentBranch = currentResult.code === 0 && currentResult.stdout && currentResult.stdout !== 'HEAD'
    ? currentResult.stdout
    : null

  const listResult = await runGit(
    ['for-each-ref', '--format=%(refname:short)%09%(HEAD)', 'refs/heads'],
    root,
    { timeoutMs: 15_000 },
  )

  if (listResult.code !== 0) {
    return {
      isRepo: true,
      currentBranch,
      branches: currentBranch ? [{ name: currentBranch, current: true }] : [],
    }
  }

  const branches = listResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, headMark] = line.split('\t')
      return {
        name: (name ?? '').trim(),
        current: headMark === '*' || (name ?? '').trim() === currentBranch,
      }
    })
    .filter((item) => item.name.length > 0)

  // 保证当前分支排在最前
  branches.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return { isRepo: true, currentBranch, branches }
}

/**
 * 列出远程
 */
export async function listGitRemotes(dirPath: string): Promise<ListGitRemotesResult> {
  const root = await resolveRepoRoot(dirPath)
  if (!root) {
    return { isRepo: false, remotes: [], upstreamRemote: null }
  }

  const remotesResult = await runGit(['remote'], root, { timeoutMs: 10_000 })
  const remotes = remotesResult.code === 0
    ? remotesResult.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    : []

  const upstreamResult = await runGit(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    root,
    { timeoutMs: 10_000 },
  )
  let upstreamRemote: string | null = null
  if (upstreamResult.code === 0 && upstreamResult.stdout.includes('/')) {
    upstreamRemote = upstreamResult.stdout.split('/')[0] || null
  }

  return { isRepo: true, remotes, upstreamRemote }
}

/**
 * 检出分支；create=true 时执行 checkout -b
 */
export async function checkoutGitBranch(
  input: CheckoutGitBranchInput,
): Promise<GitOperationResult> {
  const branch = input.branch?.trim()
  if (!branch || !isValidBranchName(branch)) {
    return { ok: false, error: '无效的分支名' }
  }

  const root = await resolveRepoRoot(input.dirPath)
  if (!root) {
    return { ok: false, error: '当前目录不是 Git 仓库' }
  }

  const args = input.create
    ? ['checkout', '-b', branch]
    : ['checkout', branch]

  const result = await runGit(args, root, { timeoutMs: 30_000 })
  if (result.code !== 0) {
    return {
      ok: false,
      error: formatGitError(result, input.create ? '创建并切换分支失败' : '切换分支失败'),
    }
  }

  return {
    ok: true,
    message: input.create ? `已创建并切换到 ${branch}` : `已切换到 ${branch}`,
    branch,
  }
}

async function stageAll(root: string): Promise<GitOperationResult | null> {
  const result = await runGit(['add', '-A'], root, { timeoutMs: 30_000 })
  if (result.code !== 0) {
    return {
      ok: false,
      error: formatGitError(result, '暂存变更失败'),
    }
  }
  return null
}

async function hasStagedChanges(root: string): Promise<boolean> {
  // 有 staged 差异时 diff --cached 返回 1；无差异返回 0；错误返回其他
  const result = await runGit(['diff', '--cached', '--quiet'], root, { timeoutMs: 15_000 })
  if (result.code === 1) return true
  if (result.code === 0) return false
  // 兜底：看 porcelain 是否有 staged 标记
  const status = await runGit(['status', '--porcelain'], root, { timeoutMs: 15_000 })
  if (status.code !== 0) return false
  return status.stdout.split('\n').some((line) => {
    if (line.length < 2) return false
    const x = line[0]
    return x !== ' ' && x !== '?'
  })
}

/**
 * 提交
 */
export async function gitCommit(input: GitCommitInput): Promise<GitOperationResult> {
  const message = input.message?.trim()
  if (!message) {
    return { ok: false, error: '提交信息不能为空' }
  }

  const root = await resolveRepoRoot(input.dirPath)
  if (!root) {
    return { ok: false, error: '当前目录不是 Git 仓库' }
  }

  if (input.includeUnstaged !== false) {
    const stageError = await stageAll(root)
    if (stageError) return stageError
  }

  const staged = await hasStagedChanges(root)
  if (!staged) {
    return { ok: false, error: '没有可提交的变更' }
  }

  // 使用 -m 传递 message，避免 shell 注入；多段用单个 -m 即可
  const result = await runGit(['commit', '-m', message], root, { timeoutMs: 60_000 })
  if (result.code !== 0) {
    return { ok: false, error: formatGitError(result, '提交失败') }
  }

  const branchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root, {
    timeoutMs: 10_000,
  })
  const branch = branchResult.code === 0 ? branchResult.stdout : null

  return {
    ok: true,
    message: result.stdout || '提交成功',
    branch,
  }
}

function resolveRemoteName(
  preferred: string | undefined,
  remotes: string[],
  upstreamRemote: string | null,
): string | null {
  if (preferred && remotes.includes(preferred)) return preferred
  if (upstreamRemote && remotes.includes(upstreamRemote)) return upstreamRemote
  if (remotes.includes('origin')) return 'origin'
  if (remotes.length === 1) return remotes[0]!
  return null
}

/**
 * 推送当前分支
 */
export async function gitPush(input: GitPushInput): Promise<GitOperationResult> {
  const root = await resolveRepoRoot(input.dirPath)
  if (!root) {
    return { ok: false, error: '当前目录不是 Git 仓库' }
  }

  const remotesInfo = await listGitRemotes(root)
  if (!remotesInfo.isRepo || remotesInfo.remotes.length === 0) {
    return { ok: false, error: '未配置远程仓库' }
  }

  const remote = resolveRemoteName(input.remote, remotesInfo.remotes, remotesInfo.upstreamRemote)
  if (!remote) {
    return { ok: false, error: '存在多个远程，请选择要推送的远程' }
  }

  let branch = input.branch?.trim()
  if (!branch) {
    const branchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root, {
      timeoutMs: 10_000,
    })
    if (branchResult.code !== 0 || !branchResult.stdout || branchResult.stdout === 'HEAD') {
      return { ok: false, error: '当前处于 detached HEAD，无法推送' }
    }
    branch = branchResult.stdout
  }

  // 无 upstream 时默认 -u；调用方也可显式指定
  let setUpstream = input.setUpstream
  if (setUpstream === undefined) {
    const upstream = await runGit(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      root,
      { timeoutMs: 10_000 },
    )
    setUpstream = upstream.code !== 0
  }

  const args = setUpstream
    ? ['push', '-u', remote, branch]
    : ['push', remote, branch]

  const result = await runGit(args, root, { timeoutMs: PUSH_TIMEOUT_MS })
  if (result.code !== 0) {
    return { ok: false, error: formatGitError(result, '推送失败') }
  }

  return {
    ok: true,
    message: result.stderr || result.stdout || `已推送到 ${remote}/${branch}`,
    branch,
  }
}

/**
 * 提交并可选推送
 */
export async function gitCommitAndPush(
  input: GitCommitAndPushInput,
): Promise<GitOperationResult> {
  const commitResult = await gitCommit({
    dirPath: input.dirPath,
    message: input.message,
    includeUnstaged: input.includeUnstaged,
    sessionId: input.sessionId,
  })
  if (!commitResult.ok) return commitResult

  if (!input.push) return commitResult

  const pushResult = await gitPush({
    dirPath: input.dirPath,
    remote: input.remote,
    setUpstream: input.setUpstream,
    sessionId: input.sessionId,
  })
  if (!pushResult.ok) {
    return {
      ok: false,
      error: `提交成功，但推送失败：${pushResult.error ?? '未知错误'}`,
      branch: commitResult.branch,
    }
  }

  return {
    ok: true,
    message: '提交并推送成功',
    branch: pushResult.branch ?? commitResult.branch,
  }
}

function buildFallbackCommitMessage(statusText: string, statText: string): string {
  const files = statusText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[MADRCU?!\s]{1,2}\s+/, '').trim())
    .filter(Boolean)

  if (files.length === 0) {
    return 'chore: update files'
  }

  if (files.length === 1) {
    return `chore: update ${files[0]}`
  }

  if (files.length <= 3) {
    return `chore: update ${files.join(', ')}`
  }

  const statFirst = statText.split('\n').find((line) => line.trim())?.trim()
  if (statFirst) {
    return `chore: update ${files.length} files`
  }

  return `chore: update ${files.length} files`
}

async function collectCommitContext(
  root: string,
  includeUnstaged: boolean,
): Promise<{ status: string; stat: string; diff: string } | null> {
  if (includeUnstaged) {
    // 与最终提交一致：预览将要 stage 的整体 diff
    const [status, stat, diff] = await Promise.all([
      runGit(['status', '--porcelain'], root, { timeoutMs: 15_000 }),
      runGit(['diff', 'HEAD', '--stat'], root, { timeoutMs: 15_000 }),
      runGit(['diff', 'HEAD'], root, { timeoutMs: 20_000 }),
    ])
    if (status.code !== 0) return null
    if (!status.stdout.trim()) return null
    return {
      status: status.stdout,
      stat: stat.stdout,
      diff: diff.stdout.slice(0, MAX_DIFF_CONTEXT_CHARS),
    }
  }

  const [status, stat, diff] = await Promise.all([
    runGit(['diff', '--cached', '--name-status'], root, { timeoutMs: 15_000 }),
    runGit(['diff', '--cached', '--stat'], root, { timeoutMs: 15_000 }),
    runGit(['diff', '--cached'], root, { timeoutMs: 20_000 }),
  ])
  if (status.code !== 0) return null
  if (!status.stdout.trim()) return null
  return {
    status: status.stdout,
    stat: stat.stdout,
    diff: diff.stdout.slice(0, MAX_DIFF_CONTEXT_CHARS),
  }
}

/**
 * 根据工作区变更生成提交信息；渠道不可用时回退到启发式文案。
 */
export async function generateGitCommitMessage(
  input: GenerateGitCommitMessageInput,
): Promise<GenerateGitCommitMessageResult> {
  const root = await resolveRepoRoot(input.dirPath)
  if (!root) {
    return { ok: false, error: '当前目录不是 Git 仓库' }
  }

  const includeUnstaged = input.includeUnstaged !== false
  const context = await collectCommitContext(root, includeUnstaged)
  if (!context) {
    return { ok: false, error: '没有可提交的变更' }
  }

  const fallback = buildFallbackCommitMessage(context.status, context.stat)

  const channelId = input.channelId
  const modelId = input.modelId
  if (
    !channelId
    || !modelId
    || channelId === CCB_NATIVE_CHANNEL_ID
  ) {
    return { ok: true, message: fallback }
  }

  const channels = listChannels()
  const channel = channels.find((item) => item.id === channelId)
  if (!channel || channel.provider === 'openai-codex') {
    return { ok: true, message: fallback }
  }

  let apiKey: string
  try {
    apiKey = await resolveChannelRuntimeApiKey(channelId)
  } catch {
    return { ok: true, message: fallback }
  }

  const prompt = [
    '你是资深工程师。请根据下面的 git 变更摘要，生成一条简洁的 commit message。',
    '要求：',
    '1. 只输出 commit message 本身，不要解释、不要引号、不要代码块。',
    '2. 优先使用简短的英文 conventional commits 风格（如 feat:/fix:/chore:），也可中文。',
    '3. 第一行不超过 72 个字符；如需正文，与标题空一行。',
    '',
    '## git status',
    context.status.slice(0, 2000),
    '',
    '## git diff --stat',
    context.stat.slice(0, 2000),
    '',
    '## git diff（截断）',
    context.diff,
  ].join('\n')

  try {
    const adapter = getAdapter(channel.provider)
    const request = adapter.buildTitleRequest({
      baseUrl: channel.baseUrl,
      apiKey,
      modelId,
      prompt,
    })
    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)
    const title = await fetchTitle(request, adapter, fetchFn)
    const cleaned = title
      ?.trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim()
    if (!cleaned) {
      return { ok: true, message: fallback }
    }
    return { ok: true, message: cleaned.slice(0, 500) }
  } catch (error) {
    console.warn('[git-ops] 生成提交信息失败，使用回退文案:', error)
    return { ok: true, message: fallback }
  }
}
