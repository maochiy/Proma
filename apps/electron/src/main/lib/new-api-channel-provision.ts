import type { Channel, ChannelModel } from '@proma/shared'

export interface ManagedChannelModelUpdate {
  models: ChannelModel[]
  defaultModelId?: string
}

export function resolveRestoredManagedChannelId(
  channels: Pick<Channel, 'id'>[],
  managedChannelId: string | undefined,
  preferredChannelId: string | undefined,
  previousChannelIds: string[] = [],
): string | undefined {
  const availableChannelIds = new Set(channels.map(channel => channel.id))
  return [preferredChannelId, ...previousChannelIds].find(channelId =>
    Boolean(
      channelId
      && channelId !== managedChannelId
      && availableChannelIds.has(channelId),
    ),
  )
}

/**
 * 决定登录时是否需要用远端模型目录初始化本地渠道。
 *
 * 同一 API Key 对应的渠道一旦已有本地模型配置，就以用户编辑后的本地配置为准。
 * 只有首次没有模型，或更换了 API Key 时，才使用远端目录重新初始化。
 */
export function resolveManagedChannelModelUpdate(
  existing: Channel | undefined,
  remoteModels: ChannelModel[],
  credentialMatches: boolean,
): ManagedChannelModelUpdate | undefined {
  if (existing && credentialMatches && existing.models.length > 0) {
    return undefined
  }

  const defaultModelId = remoteModels.find(model => model.enabled)?.id
  return {
    models: remoteModels.map(model => ({ ...model })),
    ...(defaultModelId ? { defaultModelId } : {}),
  }
}
