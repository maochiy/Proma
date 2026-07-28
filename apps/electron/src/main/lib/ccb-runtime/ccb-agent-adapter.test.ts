import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdditionalSkillDirectoriesFingerprint } from './skill-directory-fingerprint'

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
