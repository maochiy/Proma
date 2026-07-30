import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdditionalSkillDirectoriesFingerprint } from './skill-directory-fingerprint'
import {
  createSessionRuntimeConfigCommand,
  resolveCcbPermissionMode,
} from './runtime-config'
import { shouldRecoverSessionWorker } from './session-worker-recovery'

const tempDirs: string[] = []

function createTempSkillsDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'proma-ccb-skills-'))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('CCB Session Skills 注册表指纹', () => {
  test('Given Skill 被启用或停用 When 重新计算指纹 Then 触发 Session 配置变化', () => {
    const skillsDir = createTempSkillsDir()
    const before = createAdditionalSkillDirectoriesFingerprint([skillsDir])

    const skillDir = join(skillsDir, 'proma-skill')
    mkdirSync(skillDir)
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: proma-skill\n---\n',
      'utf-8',
    )

    const after = createAdditionalSkillDirectoriesFingerprint([skillsDir])
    expect(after).not.toBe(before)
  })

  test('Given Skill frontmatter 更新 When 重新计算指纹 Then 触发 CCB 命令表刷新', async () => {
    const skillsDir = createTempSkillsDir()
    const skillDir = join(skillsDir, 'proma-skill')
    const manifestPath = join(skillDir, 'SKILL.md')
    mkdirSync(skillDir)
    writeFileSync(manifestPath, '---\nname: proma-skill\n---\n', 'utf-8')
    const before = createAdditionalSkillDirectoriesFingerprint([skillsDir])

    await Bun.sleep(5)
    writeFileSync(
      manifestPath,
      '---\nname: proma-skill\ndescription: 已更新\n---\n',
      'utf-8',
    )

    const after = createAdditionalSkillDirectoriesFingerprint([skillsDir])
    expect(after).not.toBe(before)
  })
})

describe('CCB Session 思考等级桥接', () => {
  test('Given 桌面端选择最大思考 When 构造热更新命令 Then 原样传给 CCB', () => {
    expect(createSessionRuntimeConfigCommand({
      model: 'claude-opus-4-6',
      thinkingConfig: { type: 'adaptive' },
      effortLevel: 'max',
    })).toEqual({
      type: 'session.updateConfig',
      model: 'claude-opus-4-6',
      thinkingConfig: { type: 'adaptive' },
      effortLevel: 'max',
    })
  })

  test('Given 桌面端选择深度思考 When 构造热更新命令 Then 保留 xhigh 等级', () => {
    expect(createSessionRuntimeConfigCommand({
      effortLevel: 'xhigh',
    })).toEqual({
      type: 'session.updateConfig',
      effortLevel: 'xhigh',
    })
  })

  test('Given 只切换模型 When 构造热更新命令 Then 不得清空 CCB 已有思考等级', () => {
    expect(createSessionRuntimeConfigCommand({
      model: 'claude-sonnet-4-6',
    })).toEqual({
      type: 'session.updateConfig',
      model: 'claude-sonnet-4-6',
    })
  })
})

describe('CCB Session 审批模式桥接', () => {
  test('Given 选择请求批准 When 构造 CCB Session 配置 Then 原样传入 default 模式', () => {
    expect(resolveCcbPermissionMode('default')).toBe('default')
  })

  test('Given 未指定审批模式 When 构造 CCB Session 配置 Then 保持完全自动默认值', () => {
    expect(resolveCcbPermissionMode(undefined)).toBe('bypassPermissions')
  })
})


describe('CCB Session Worker 自动恢复判定', () => {
  test('Given Worker 被回收导致 turn.start 超时 When 判定恢复策略 Then 应 resume 而不是清空上下文', () => {
    expect(shouldRecoverSessionWorker('CCB Runtime 请求超时: turn.start')).toBe(true)
    expect(shouldRecoverSessionWorker('Error: CCB Runtime 请求超时: session.compact')).toBe(true)
    expect(shouldRecoverSessionWorker('Session 尚未打开')).toBe(true)
  })

  test('Given 普通业务错误 When 判定恢复策略 Then 不得误触发 resume', () => {
    expect(shouldRecoverSessionWorker('当前 Session 已有运行中的 Turn')).toBe(false)
    expect(shouldRecoverSessionWorker('API 错误 (429): rate limited')).toBe(false)
    expect(shouldRecoverSessionWorker('CCB Runtime 请求超时: turn.stop')).toBe(false)
  })
})
