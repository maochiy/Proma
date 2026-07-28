import type { Channel } from '@proma/shared'

/**
 * 保留多个模型配置预设，但保证最多只有指定配置处于启用状态。
 */
export function applyExclusiveChannelSelection(
  channels: Channel[],
  activeChannelId: string,
  updatedAt: number,
): Channel[] {
  return channels.map(channel => {
    if (channel.id === activeChannelId || !channel.enabled) return channel
    return {
      ...channel,
      enabled: false,
      updatedAt,
    }
  })
}
