import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 生成宿主 Skills 注册表指纹。
 *
 * CCB 在 Session 打开时加载命令表；Proma 启停或更新 Skill 后，需要让现有
 * Worker 重新打开 Session，才能刷新 QueryEngine 中的命令。这里只读取每个
 * Skill 的目录名与 SKILL.md 元数据，不扫描资源文件，避免每轮请求产生高额 IO。
 */
export function createAdditionalSkillDirectoriesFingerprint(
  directories: string[] | undefined,
): string {
  const hash = createHash('sha256')
  for (const directory of [...(directories ?? [])].sort()) {
    hash.update(`root:${directory}\n`)
    if (!existsSync(directory)) {
      hash.update('missing\n')
      continue
    }
    try {
      const entries = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
        const skillManifestPath = join(directory, entry.name, 'SKILL.md')
        hash.update(`skill:${entry.name}\n`)
        if (!existsSync(skillManifestPath)) {
          hash.update('manifest:missing\n')
          continue
        }
        const stats = statSync(skillManifestPath)
        hash.update(`manifest:${stats.size}:${stats.mtimeMs}\n`)
      }
    } catch (error) {
      hash.update(
        `error:${error instanceof Error ? error.message : String(error)}\n`,
      )
    }
  }
  return hash.digest('hex')
}
