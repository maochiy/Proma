import type { ContextPacket } from '@proma/shared'

export interface ContextPacketTextOptions {
  includeRecentMessages?: boolean
  includeSkillContent?: boolean
}

export function contextPacketText(
  packet: ContextPacket,
  options: ContextPacketTextOptions = {},
): string {
  const includeRecentMessages = options.includeRecentMessages ?? true
  const includeSkillContent = options.includeSkillContent ?? true
  const sections = [
    `<proma_context_packet schema="${packet.schemaVersion}" id="${packet.packetId}">`,
    `用户：${packet.profile.userName}`,
    includeRecentMessages && packet.conversation.recentMessages.length > 0
      ? `最近会话：\n${packet.conversation.recentMessages.map((message) => `- ${message.role}: ${message.content}`).join('\n')}`
      : '',
    `工作区：${packet.workspace.name}（${packet.workspace.path || '未指定'}）`,
    packet.workspace.rules.length > 0 ? `工作区规则：\n${packet.workspace.rules.map((rule) => `- ${rule}`).join('\n')}` : '',
    packet.workspace.attachedDirectories.length > 0
      ? `附加目录：\n${packet.workspace.attachedDirectories.map((path) => `- ${path}`).join('\n')}`
      : '',
    packet.workspace.attachedFiles.length > 0
      ? `工作区附加文件：\n${packet.workspace.attachedFiles.map((path) => `- ${path}`).join('\n')}`
      : '',
    packet.memory.claudeMd ? `工作区规则：\n${packet.memory.claudeMd}` : '',
    packet.memory.autoMemoryFiles.length > 0 ? `Auto Memory 文件：\n${packet.memory.autoMemoryFiles.join('\n')}` : '',
    packet.skills.length > 0
      ? `Skills：\n${packet.skills.map((skill) => (
          `- ${skill.name}${skill.description ? `：${skill.description}` : ''}`
          + (includeSkillContent && skill.content ? `\n${skill.content}` : '')
        )).join('\n')}`
      : '',
    packet.mcp.enabledServers.length > 0 ? `MCP：${packet.mcp.enabledServers.join(', ')}` : '',
    packet.mcp.builtinServers.length > 0 ? `Proma 内置 MCP：${packet.mcp.builtinServers.join(', ')}` : '',
    packet.attachments.length > 0 ? `本轮附件：\n${packet.attachments.map((path) => `- ${path}`).join('\n')}` : '',
    packet.browserAnnotations.length > 0 ? `浏览器标注：\n${packet.browserAnnotations.map((annotation) => `- ${annotation.pageTitle} ${annotation.url}\n  ${annotation.comment}\n  ${annotation.text || annotation.domExcerpt || ''}`).join('\n')}` : '',
    packet.taskGraph ? `Hermes 任务图：\n${packet.taskGraph.tasks.map((task) => `- ${task.id} ${task.title} [${task.status}]`).join('\n')}` : '',
    packet.artifacts.length > 0 ? `前序产物：\n${packet.artifacts.map((artifact) => `- ${artifact.kind}: ${artifact.content}`).join('\n')}` : '',
    `Runtime：${packet.runtime.runtimeId}\n能力：${Object.entries(packet.runtime.capabilities).map(([key, value]) => `${key}=${value}`).join(', ') || '未知'}`,
    `模型路由：${packet.model.provider}/${packet.model.modelId}（${packet.model.routeRevision}）`,
    `策略：${packet.dispatchPolicy.strategyId}\n${packet.dispatchPolicy.instruction}`,
    '</proma_context_packet>',
  ]
  return sections.filter(Boolean).join('\n\n')
}
