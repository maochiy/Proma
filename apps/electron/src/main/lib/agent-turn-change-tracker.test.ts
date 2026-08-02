import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearAgentTurnChangeTracking,
  getAgentTurnChangeStats,
  startAgentTurnChangeTracking,
} from './agent-turn-change-tracker'

const SESSION_ID = 'agent-turn-change-tracker-test'

let tempDir = ''
let repositoryDir = ''

function runGit(args: string[], cwd = repositoryDir): void {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} 执行失败`)
  }
}

function createCommittedRepository(): void {
  repositoryDir = join(tempDir, 'repository')
  mkdirSync(repositoryDir, { recursive: true })
  runGit(['init'])
  runGit(['config', 'user.name', 'Proma Test'])
  runGit(['config', 'user.email', 'proma-test@example.com'])
  writeFileSync(join(repositoryDir, 'tracked.txt'), '已提交\n')
  writeFileSync(join(repositoryDir, 'deleted.txt'), '待删除\n')
  runGit(['add', '-A'])
  runGit(['commit', '-m', 'initial'])
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'proma-turn-change-tracker-'))
  createCommittedRepository()
})

afterEach(() => {
  clearAgentTurnChangeTracking(SESSION_ID)
  rmSync(tempDir, { recursive: true, force: true })
})

describe('Agent 本轮文件改动统计', () => {
  test('Given 基线前已有未提交改动 When 本轮继续修改文件 Then 只统计本轮增删', async () => {
    appendFileSync(join(repositoryDir, 'tracked.txt'), '基线前修改\n')
    runGit(['add', 'tracked.txt'])
    writeFileSync(join(repositoryDir, 'preexisting-untracked.txt'), '基线前新文件\n')

    await startAgentTurnChangeTracking({
      sessionId: SESSION_ID,
      startedAt: 100,
      paths: [repositoryDir],
    })

    appendFileSync(join(repositoryDir, 'tracked.txt'), '本轮新增\n')
    appendFileSync(join(repositoryDir, 'preexisting-untracked.txt'), '本轮新增\n')
    writeFileSync(join(repositoryDir, 'new.txt'), '第一行\n第二行\n')
    unlinkSync(join(repositoryDir, 'deleted.txt'))

    const stats = await getAgentTurnChangeStats(SESSION_ID)

    expect(stats).toMatchObject({
      startedAt: 100,
      filesChanged: 4,
      additions: 4,
      deletions: 1,
    })
    expect(stats?.files?.map((file) => file.path).sort()).toEqual([
      'deleted.txt',
      'new.txt',
      'preexisting-untracked.txt',
      'tracked.txt',
    ])
    expect(stats?.files?.find((file) => file.path === 'new.txt')).toEqual({
      path: 'new.txt',
      additions: 2,
      deletions: 0,
    })
    expect(stats?.files?.find((file) => file.path === 'deleted.txt')).toEqual({
      path: 'deleted.txt',
      additions: 0,
      deletions: 1,
    })
  })

  test('Given 已创建本轮基线 When 工作树没有继续变化 Then 返回零改动', async () => {
    await startAgentTurnChangeTracking({
      sessionId: SESSION_ID,
      startedAt: 200,
      paths: [repositoryDir],
    })

    const stats = await getAgentTurnChangeStats(SESSION_ID)

    expect(stats).toMatchObject({
      startedAt: 200,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
    })
  })

  test('Given 本轮新增二进制文件 When 读取统计 Then 只增加文件数', async () => {
    await startAgentTurnChangeTracking({
      sessionId: SESSION_ID,
      startedAt: 300,
      paths: [repositoryDir],
    })
    writeFileSync(join(repositoryDir, 'binary.dat'), Buffer.from([0, 1, 2, 3]))

    const stats = await getAgentTurnChangeStats(SESSION_ID)

    expect(stats).toMatchObject({
      filesChanged: 1,
      additions: 0,
      deletions: 0,
    })
  })

  test('Given 路径不属于 Git 仓库 When 读取统计 Then 静默返回空', async () => {
    const plainDir = join(tempDir, 'plain')
    mkdirSync(plainDir)

    await startAgentTurnChangeTracking({
      sessionId: SESSION_ID,
      startedAt: 400,
      paths: [plainDir],
    })

    expect(await getAgentTurnChangeStats(SESSION_ID)).toBeNull()
  })

  test('Given 会话已有统计基线 When 清理会话 Then 不再返回统计', async () => {
    await startAgentTurnChangeTracking({
      sessionId: SESSION_ID,
      startedAt: 500,
      paths: [repositoryDir],
    })

    clearAgentTurnChangeTracking(SESSION_ID)

    expect(await getAgentTurnChangeStats(SESSION_ID)).toBeNull()
  })

  test('Given 项目内存在嵌套 Git 仓库 When 修改嵌套仓库文件 Then 统计内部真实文件且不重复计算 gitlink', async () => {
    const nestedRepository = join(repositoryDir, 'nested-repository')
    mkdirSync(nestedRepository)
    runGit(['init'], nestedRepository)
    runGit(['config', 'user.name', 'Proma Test'], nestedRepository)
    runGit(['config', 'user.email', 'proma-test@example.com'], nestedRepository)
    writeFileSync(join(nestedRepository, 'nested.txt'), '嵌套仓库\n')
    runGit(['add', '-A'], nestedRepository)
    runGit(['commit', '-m', 'nested initial'], nestedRepository)

    await startAgentTurnChangeTracking({
      sessionId: SESSION_ID,
      startedAt: 600,
      paths: [repositoryDir],
    })
    appendFileSync(join(nestedRepository, 'nested.txt'), '本轮修改\n')

    const stats = await getAgentTurnChangeStats(SESSION_ID)

    expect(stats).toMatchObject({
      filesChanged: 1,
      additions: 1,
      deletions: 0,
    })
  })

  test('Given 上一轮统计仍在执行 When 新一轮已建立基线 Then 新查询不得复用旧轮 Promise', async () => {
    const manyRepositoriesDir = join(tempDir, 'many-repositories')
    mkdirSync(manyRepositoriesDir)
    const additionalRepositories: string[] = []
    for (let index = 0; index < 12; index += 1) {
      const repo = join(manyRepositoriesDir, `repo-${index}`)
      mkdirSync(repo)
      runGit(['init'], repo)
      writeFileSync(join(repo, 'file.txt'), '基线\n')
      additionalRepositories.push(repo)
    }

    await startAgentTurnChangeTracking({
      sessionId: SESSION_ID,
      startedAt: 700,
      paths: [manyRepositoriesDir],
    })
    for (const repo of additionalRepositories) {
      appendFileSync(join(repo, 'file.txt'), '上一轮修改\n')
    }

    const previousTurnRequest = getAgentTurnChangeStats(SESSION_ID)
    await startAgentTurnChangeTracking({
      sessionId: SESSION_ID,
      startedAt: 701,
      paths: [repositoryDir],
    })
    const currentTurnStats = await getAgentTurnChangeStats(SESSION_ID)
    await previousTurnRequest

    expect(currentTurnStats?.startedAt).toBe(701)
  })
})
