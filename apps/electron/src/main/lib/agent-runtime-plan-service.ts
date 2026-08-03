import type { AgentRuntimePlanPersistedStore } from '@proma/shared'
import { getAgentRuntimePlansPath } from './config-paths'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'

function createEmptyStore(): AgentRuntimePlanPersistedStore {
  return {
    sessions: {},
    updatedAt: 0,
  }
}

export function getAgentRuntimePlanStore(): AgentRuntimePlanPersistedStore {
  try {
    const parsed = readJsonFileSafe<Partial<AgentRuntimePlanPersistedStore>>(
      getAgentRuntimePlansPath(),
    )
    if (!parsed) return createEmptyStore()

    return {
      sessions: (
        parsed.sessions
        && typeof parsed.sessions === 'object'
        && !Array.isArray(parsed.sessions)
      )
        ? parsed.sessions
        : {},
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch (error) {
    console.error('[Agent计划] 读取生命周期历史失败:', error)
    return createEmptyStore()
  }
}

export function saveAgentRuntimePlanStore(
  store: AgentRuntimePlanPersistedStore,
): void {
  try {
    writeJsonFileAtomic(
      getAgentRuntimePlansPath(),
      store,
    )
  } catch (error) {
    console.error('[Agent计划] 保存生命周期历史失败:', error)
    throw new Error('保存 Agent 计划生命周期失败')
  }
}
