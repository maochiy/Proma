interface AgentProjectSwitchState {
  messagesLoaded: boolean
  persistedMessageCount: number
  liveMessageCount: number
  runtimeSessionId?: string
  streaming: boolean
  backgroundWaiting: boolean
}

/**
 * 输入区只允许空白任务直接切换项目。
 *
 * 已经产生 Runtime 上下文或消息的任务必须走侧栏的“迁移会话”流程，
 * 由该流程统一处理子会话、标签页、预览和各类会话缓存。
 */
export function canSwitchAgentProject(state: AgentProjectSwitchState): boolean {
  return state.messagesLoaded
    && state.persistedMessageCount === 0
    && state.liveMessageCount === 0
    && !state.runtimeSessionId
    && !state.streaming
    && !state.backgroundWaiting
}
