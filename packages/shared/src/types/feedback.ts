/**
 * 用户反馈相关类型。
 *
 * 渲染进程只提交表单与关联会话信息；本地会话读取、脱敏和网络提交均由主进程完成。
 */

export type FeedbackSessionType = 'chat' | 'agent'

export interface FeedbackSubmitInput {
  /** 反馈标题 */
  title: string
  /** 反馈正文 */
  content: string
  /** 关联的本地会话 ID */
  sessionId?: string
  /** 关联会话类型 */
  sessionType?: FeedbackSessionType
  /** 是否附带经过脱敏和截断的会话记录 */
  includeTranscript: boolean
  /** 客户端界面语言 */
  locale?: string
}

export interface FeedbackSubmitResult {
  success: boolean
  feedbackId: string
  createdAt: string
}

export const FEEDBACK_IPC_CHANNELS = {
  SUBMIT: 'feedback:submit',
} as const
