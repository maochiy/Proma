import { existsSync, statSync } from 'node:fs'
import type { RuntimeSkillCatalog } from '@proma/shared'
import { getAgentWorkspace } from '../agent-workspace-manager'
import { getWorkspaceSkillsDir } from '../config-paths'
import { ccbDesktopRuntimeClient } from './runtime-client'
import type { CcbRuntimeSkillCatalog } from './protocol'
import { assertCcbRuntimeSkillCatalog } from './protocol-validation'
import { sanitizeCcbSessionEnvironment } from './runtime-security'
import { getCcbUserConfigDir } from './user-config'

/** 按当前本机项目 cwd 解析 CCB + Proma 的完整 Skill Catalog。 */
export async function resolveAgentRuntimeSkillCatalog(
  workspaceId: string,
): Promise<RuntimeSkillCatalog> {
  const workspace = getAgentWorkspace(workspaceId)
  if (!workspace) throw new Error('项目不存在，请重新选择项目')

  const projectPath = workspace.canonicalPath || workspace.path
  if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    throw new Error(`项目目录不可用，请重新添加项目：${projectPath}`)
  }

  const environment = sanitizeCcbSessionEnvironment(process.env)
  const result = await ccbDesktopRuntimeClient.request<CcbRuntimeSkillCatalog>(
    {
      type: 'session.resolveSkillCatalog',
      options: {
        cwd: projectPath,
        additionalSkillDirectories: [getWorkspaceSkillsDir(workspace.slug)],
        permissionMode: 'default',
        environment: {
          variables: environment,
          configDir: getCcbUserConfigDir(),
        },
      },
    },
    `__skill-catalog__:${workspace.id}`,
    30_000,
  )
  assertCcbRuntimeSkillCatalog(result)
  const runtime = ccbDesktopRuntimeClient.getRuntimeInfo()
  return {
    ...result,
    runtimeVersion: runtime?.runtimeVersion,
    runtimeArtifactCommit: runtime?.gitCommit,
  }
}
