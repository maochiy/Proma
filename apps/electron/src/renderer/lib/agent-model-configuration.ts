import type { AgentSessionMeta } from '@proma/shared'

export interface AgentSessionModelBinding {
  channelId: string
  modelId?: string
}

/**
 * 将会话绑定归一化到当前唯一启用的 CCB Provider。
 *
 * 原模型仍可用时保留；已删除或禁用时回退到配置默认模型，再回退到首个可用模型。
 */
export function resolveAgentSessionModelBinding(
  session: Pick<AgentSessionMeta, 'channelId' | 'modelId'>,
  channelId: string,
  modelIds: string[],
  defaultModelId?: string,
): AgentSessionModelBinding {
  const availableModelIds = new Set(modelIds)
  const fallbackModelId =
    defaultModelId && availableModelIds.has(defaultModelId)
      ? defaultModelId
      : modelIds[0]
  const modelId =
    session.modelId && availableModelIds.has(session.modelId)
      ? session.modelId
      : fallbackModelId
  return {
    channelId,
    ...(modelId ? { modelId } : {}),
  }
}
