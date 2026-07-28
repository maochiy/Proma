import { join } from 'node:path'
import type {
  AgentRuntimeSessionCatalog,
  AgentRuntimeSessionTranscript,
  AgentSessionMeta,
} from '@proma/shared'
import { getConfigDir } from '../config-paths'
import {
  getAgentSessionMeta,
  listAgentSessions,
  replaceAgentSessionSDKMessages,
  syncRuntimeSessionCatalog,
} from '../agent-session-manager'
import {
  getAgentWorkspace,
  listAgentWorkspaces,
} from '../agent-workspace-manager'
import { ccbDesktopRuntimeClient } from './runtime-client'

function runtimeEnvironment(): {
  variables: Record<string, string>
  configDir: string
} {
  return {
    variables: {},
    configDir: join(getConfigDir(), 'runtime', 'ccb'),
  }
}

/** 按所有已添加项目 pwd 从 CCB Transcript 目录同步会话列表。 */
export async function syncCcbSessionCatalogs(): Promise<AgentSessionMeta[]> {
  for (const workspace of listAgentWorkspaces()) {
    const cwd = workspace.canonicalPath || workspace.path
    const sessions: AgentRuntimeSessionCatalog['sessions'] = []
    let offset = 0
    while (true) {
      const catalog =
        await ccbDesktopRuntimeClient.request<AgentRuntimeSessionCatalog>(
        {
          type: 'session.list',
          cwd,
          environment: runtimeEnvironment(),
          limit: 500,
          offset,
        },
        `__session-catalog__:${workspace.id}:${offset}`,
        30_000,
      )
      sessions.push(...catalog.sessions)
      if (catalog.nextOffset === undefined) break
      offset = catalog.nextOffset
    }
    syncRuntimeSessionCatalog(workspace.id, sessions)
  }
  return listAgentSessions()
}

/** 以 CCB Transcript 为真源刷新指定 Proma 会话的消息投影。 */
export async function syncCcbSessionTranscript(
  promaSessionId: string,
): Promise<AgentRuntimeSessionTranscript | undefined> {
  const session = getAgentSessionMeta(promaSessionId)
  if (!session?.runtimeSessionId || !session.workspaceId) return undefined
  const workspace = getAgentWorkspace(session.workspaceId)
  if (!workspace) return undefined
  const cwd = workspace.canonicalPath || workspace.path
  const transcript =
    await ccbDesktopRuntimeClient.request<AgentRuntimeSessionTranscript>(
      {
        type: 'session.getTranscript',
        cwd,
        environment: runtimeEnvironment(),
        runtimeSessionId: session.runtimeSessionId,
      },
      `__session-transcript__:${session.runtimeSessionId}`,
      30_000,
    )
  replaceAgentSessionSDKMessages(promaSessionId, transcript.messages)
  return transcript
}

/** 删除 Proma 会话对应的 CCB 原生 Transcript。 */
export async function deleteCcbSessionTranscript(
  promaSessionId: string,
): Promise<void> {
  const session = getAgentSessionMeta(promaSessionId)
  if (!session?.runtimeSessionId || !session.workspaceId) return
  const workspace = getAgentWorkspace(session.workspaceId)
  if (!workspace) return
  const cwd = workspace.canonicalPath || workspace.path
  await ccbDesktopRuntimeClient.request<{ deleted: boolean }>(
    {
      type: 'session.delete',
      cwd,
      environment: runtimeEnvironment(),
      runtimeSessionId: session.runtimeSessionId,
    },
    `__session-delete__:${session.runtimeSessionId}`,
    30_000,
  )
}
