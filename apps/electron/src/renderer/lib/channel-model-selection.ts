import type { Channel, ChannelModel } from '@proma/shared'

/** 判断目标模型是否是配置中最后一个启用模型。 */
export function isLastEnabledChannelModel(
  models: ChannelModel[],
  modelId: string,
): boolean {
  const target = models.find(model => model.id === modelId)
  if (!target?.enabled) return false
  return models.filter(model => model.enabled).length === 1
}

/** 判断目标模型配置是否是 Proma 中最后一个启用配置。 */
export function isLastEnabledChannelConfiguration(
  channels: Channel[],
  channelId: string,
): boolean {
  const target = channels.find(channel => channel.id === channelId)
  if (!target?.enabled) return false
  return channels.filter(channel => channel.enabled).length === 1
}
