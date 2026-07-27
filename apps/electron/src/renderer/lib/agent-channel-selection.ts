import { isAgentCompatibleProvider, type Channel } from '@proma/shared'

/**
 * Agent 渠道可用性完全由「渠道已启用 + CCB 协议兼容」派生。
 */
export function getEnabledAgentChannelIds(
  channels: readonly Pick<Channel, 'id' | 'enabled' | 'provider'>[],
): string[] {
  return channels
    .filter((channel) => channel.enabled && isAgentCompatibleProvider(channel.provider))
    .map((channel) => channel.id)
}
