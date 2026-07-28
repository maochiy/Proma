import type {
  RuntimeSkillCatalog,
  RuntimeSkillInfo,
  SkillMeta,
} from '@proma/shared'

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase()
}

function getPromaSkillNames(
  skills: readonly Pick<SkillMeta, 'slug' | 'name'>[],
): Set<string> {
  const names = new Set<string>()
  for (const skill of skills) {
    names.add(normalizeSkillName(skill.slug))
    names.add(normalizeSkillName(skill.name))
  }
  return names
}

/**
 * 返回当前项目中真正生效且适合展示的 CCB Skills。
 *
 * CCB Catalog 会保留被同名高优先级来源覆盖的条目，方便诊断解析过程；
 * Desktop 能力页只展示实际生效项，避免同一个内置 Skill 重复出现两次。
 */
export function getVisibleRuntimeSkills(
  catalog: RuntimeSkillCatalog | null,
): RuntimeSkillInfo[] {
  if (!catalog) return []

  const seenIds = new Set<string>()
  return catalog.skills.filter((skill) => {
    if (skill.shadowedBy || seenIds.has(skill.id)) return false
    seenIds.add(skill.id)
    return true
  })
}

/** CCB 自带、用户级、项目级、插件级 Skills 数量，不重复计算 Proma 注册项。 */
export function countExternalRuntimeSkills(
  catalog: RuntimeSkillCatalog | null,
  promaSkills: readonly Pick<SkillMeta, 'slug' | 'name'>[] = [],
): number {
  const promaNames = getPromaSkillNames(promaSkills)
  return getVisibleRuntimeSkills(catalog)
    .filter((skill) =>
      skill.source !== 'proma-project'
      && !promaNames.has(normalizeSkillName(skill.name)),
    )
    .length
}

/**
 * 将 Proma 可管理 Skills 与 CCB 当前实际 Catalog 合并。
 *
 * Proma 条目始终保留管理能力；如果被同名 CCB Skill 覆盖，则在原卡片上展示
 * shadowedBy，不再额外插入一个同名只读卡片，避免列表与数量重复。
 */
export function mergeRuntimeSkillCatalog(
  promaSkills: SkillMeta[],
  catalog: RuntimeSkillCatalog | null,
): SkillMeta[] {
  if (!catalog) return promaSkills

  const runtimePromaByName = new Map<string, RuntimeSkillInfo>()
  for (const skill of catalog.skills) {
    if (skill.source !== 'proma-project') continue
    runtimePromaByName.set(normalizeSkillName(skill.name), skill)
  }

  const promaNames = getPromaSkillNames(promaSkills)
  const mergedProma = promaSkills.map((skill) => {
    const runtimeSkill =
      runtimePromaByName.get(normalizeSkillName(skill.slug))
      ?? runtimePromaByName.get(normalizeSkillName(skill.name))
    return {
      ...skill,
      registeredWithRuntime: Boolean(runtimeSkill),
      runtimeSource: runtimeSkill?.source,
      runtimePath: runtimeSkill?.path,
      shadowedBy: runtimeSkill?.shadowedBy,
    }
  })

  const ccbSkills = getVisibleRuntimeSkills(catalog)
    .filter((skill) =>
      skill.source !== 'proma-project'
      && !promaNames.has(normalizeSkillName(skill.name)),
    )
    .map((skill): SkillMeta => ({
      slug: `__ccb__${skill.id}`,
      name: skill.name,
      description: skill.description,
      enabled: skill.enabled,
      runtimeSource: skill.source,
      runtimePath: skill.path,
      runtimeReadOnly: true,
      registeredWithRuntime: true,
      shadowedBy: skill.shadowedBy,
      runtimePluginName: skill.pluginName,
    }))

  return [...mergedProma, ...ccbSkills]
}
