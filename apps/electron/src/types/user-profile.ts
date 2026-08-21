/**
 * 用户档案类型
 *
 * 用户名、头像、IPC 通道等定义。
 */

/** 默认用户头像 emoji */
export const DEFAULT_USER_AVATAR = '🧑‍💻'

/** 默认用户名 */
export const DEFAULT_USER_NAME = '用户'

/** 用户档案 */
export interface UserProfile {
  /** 用户名 */
  userName: string
  /** 头像（emoji 字符串 或 data:image/* base64 URL） */
  avatar: string
}

/** 按日汇总的 Token 用量 */
export interface UserUsageDay {
  /** 本地日期 YYYY-MM-DD */
  day: string
  /** 当日真实消耗 Token（input + output + cache） */
  tokens: number
  /** 当日模型请求次数 */
  requests: number
}

/** 模型用量排行项 */
export interface UserUsageModel {
  /** 模型 ID */
  modelId: string
  /** 展示名称 */
  modelName: string
  /** 调用次数 */
  requests: number
  /** 累计 Token */
  tokens: number
  /** 最近一次使用时间戳 */
  lastUsedAt: number
}

/** Skill 用量排行项 */
export interface UserUsageSkill {
  /** Skill 名称 */
  name: string
  /** 调用次数 */
  uses: number
  /** 最近一次使用时间戳 */
  lastUsedAt: number
}

/** 个人资料页顶部统计与洞察 */
export interface UserUsageStats {
  /** 累计 Token */
  totalTokens: number
  /** 峰值日 Token */
  peakDayTokens: number
  /** 峰值日 YYYY-MM-DD */
  peakDay: string
  /** 单会话最长时长（毫秒，首次活动到末次活动） */
  longestChatDurationMs: number
  /** 当前连续活跃天数（需包含今天） */
  currentStreakDays: number
  /** 历史最长连续活跃天数 */
  longestStreakDays: number
  /** 模型请求次数 */
  requests: number
  /** Chat 对话数 */
  chatCount: number
  /** Agent 会话数（不含 draft） */
  agentSessionCount: number
  /** 快速模式占比 0-1 */
  fastModeRate: number
  /** 使用过的 Skill 种数 */
  skillsExplored: number
  /** Skill 调用总次数 */
  skillUses: number
}

/** 个人资料用量汇总 */
export interface UserUsageSummary {
  /** 汇总生成时间戳 */
  checkedAt: number
  stats: UserUsageStats
  /** 有用量的日期，供热力图使用 */
  days: UserUsageDay[]
  /** 最常用模型，按调用次数降序 */
  models: UserUsageModel[]
  /** 最常用 Skill，按调用次数降序 */
  skills: UserUsageSkill[]
}

/** 用户档案 IPC 通道 */
export const USER_PROFILE_IPC_CHANNELS = {
  GET: 'user-profile:get',
  UPDATE: 'user-profile:update',
  GET_USAGE_SUMMARY: 'user-profile:get-usage-summary',
} as const
