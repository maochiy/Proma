import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Desktop Runtime 与 CCB CLI 共享用户配置根目录。
 *
 * 项目设置仍由 cwd 下的 .claude 目录发现；Proma Skills 通过
 * additionalSkillDirectories 单独注册，不复制或改写用户的 CCB 配置。
 */
export function getCcbUserConfigDir(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim()
  return resolve(configured || join(homedir(), '.claude'))
}
