import { describe, expect, test } from 'bun:test'
import type { RuntimeSkillCatalog, RuntimeSkillInfo } from '@proma/shared'
import {
  countExternalRuntimeSkills,
  getVisibleRuntimeSkills,
  mergeRuntimeSkillCatalog,
} from './runtime-skill-catalog'

function skill(
  id: string,
  name: string,
  source: RuntimeSkillInfo['source'],
  shadowedBy?: string,
): RuntimeSkillInfo {
  return {
    id,
    name,
    source,
    enabled: true,
    userInvocable: true,
    modelInvocable: true,
    shadowedBy,
  }
}

function catalog(skills: RuntimeSkillInfo[]): RuntimeSkillCatalog {
  return {
    projectPath: '/tmp/project',
    resolvedAt: 1,
    skills,
  }
}

describe('CCB Skill Catalog 展示', () => {
  test('Given Catalog 保留同名覆盖项 When 生成桌面列表 Then 只展示真正生效项', () => {
    const result = getVisibleRuntimeSkills(catalog([
      skill('bundled:debug', 'debug', 'ccb-bundled'),
      skill('bundled:debug:shadowed', 'debug', 'ccb-bundled', 'bundled:debug'),
      skill('user:build-flutter', 'build-flutter', 'ccb-user'),
    ]))

    expect(result.map((item) => item.id)).toEqual([
      'bundled:debug',
      'user:build-flutter',
    ])
  })

  test('Given Proma Skills 已注册到 CCB When 计算侧边栏数量 Then 不重复计算 Proma 项', () => {
    const result = countExternalRuntimeSkills(catalog([
      skill('proma:automation', 'automation', 'proma-project'),
      skill('bundled:debug', 'debug', 'ccb-bundled'),
      skill('user:build-flutter', 'build-flutter', 'ccb-user'),
    ]))

    expect(result).toBe(2)
  })

  test('Given Proma Skill 被同名 CCB Skill 覆盖 When 合并目录 Then 保留覆盖状态且不重复展示', () => {
    const runtimeCatalog = catalog([
      skill('proma:build-flutter', 'build-flutter', 'proma-project', 'user:build-flutter'),
      skill('user:build-flutter', 'build-flutter', 'ccb-user'),
      skill('bundled:debug', 'debug', 'ccb-bundled'),
    ])
    const promaSkills = [{
      slug: 'build-flutter',
      name: 'build-flutter',
      enabled: true,
    }]

    const merged = mergeRuntimeSkillCatalog(promaSkills, runtimeCatalog)

    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({
      slug: 'build-flutter',
      registeredWithRuntime: true,
      runtimeSource: 'proma-project',
      shadowedBy: 'user:build-flutter',
    })
    expect(merged[1]).toMatchObject({
      name: 'debug',
      runtimeSource: 'ccb-bundled',
      runtimeReadOnly: true,
    })
    expect(countExternalRuntimeSkills(runtimeCatalog, promaSkills)).toBe(1)
  })
})
