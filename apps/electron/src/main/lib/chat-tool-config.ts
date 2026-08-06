/**
 * Chat 工具配置服务
 *
 * 管理 ~/.proma/chat-tools.json 的读写。
 * 存储工具开关状态和非记忆工具的凭据。
 * 记忆凭据保留在 memory.json（Chat + Agent 共用）。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { getChatToolsConfigPath } from './config-paths'
import type { ChatToolsFileConfig, ChatToolState, ChatToolMeta } from '@proma/shared'

/** 默认配置 */
const DEFAULT_CONFIG: ChatToolsFileConfig = {
  toolStates: {
    memory: { enabled: true },
    'agent-mode-recommend': { enabled: true },
    // 对话工具面板可开关；登录 OpenSwitch 后可用，默认开启
    'web-search': { enabled: true },
    'nano-banana': { enabled: false },
  },
  toolCredentials: {},
  customTools: [],
}

/**
 * 读取工具配置
 */
export function getChatToolsConfig(): ChatToolsFileConfig {
  const filePath = getChatToolsConfigPath()

  if (!existsSync(filePath)) {
    return structuredClone(DEFAULT_CONFIG)
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<ChatToolsFileConfig> & {
      /** 是否已从 Tavily 配置模型迁移到 OpenSwitch 默认开启 */
      openswitchWebSearchMigrated?: boolean
    }
    const toolStates = { ...DEFAULT_CONFIG.toolStates, ...data.toolStates }
    const toolCredentials = { ...(data.toolCredentials ?? {}) }
    let needsSave = false

    // 清理历史 Tavily API Key（不再需要手动配置）
    if (toolCredentials['web-search']) {
      delete toolCredentials['web-search']
      needsSave = true
    }

    // 一次性迁移：旧版默认关闭 / 缺失 → 新默认开启；之后尊重用户在对话工具面板的开关
    if (!data.openswitchWebSearchMigrated) {
      toolStates['web-search'] = { enabled: true }
      needsSave = true
    } else if (!toolStates['web-search']) {
      toolStates['web-search'] = { enabled: true }
    }

    const config: ChatToolsFileConfig = {
      toolStates,
      toolCredentials,
      customTools: data.customTools ?? [],
    }

    if (needsSave) {
      // 额外写入迁移标记，避免每次启动覆盖用户关闭态
      writeFileSync(
        filePath,
        JSON.stringify({ ...config, openswitchWebSearchMigrated: true }, null, 2),
        'utf-8',
      )
    }

    return config
  } catch (error) {
    console.error('[Chat 工具配置] 读取失败:', error)
    return structuredClone(DEFAULT_CONFIG)
  }
}

/**
 * 保存工具配置
 */
export function saveChatToolsConfig(config: ChatToolsFileConfig): void {
  const filePath = getChatToolsConfigPath()
  try {
    // 始终带上迁移标记，避免用户关闭开关后下次启动被重置
    writeFileSync(
      filePath,
      JSON.stringify({ ...config, openswitchWebSearchMigrated: true }, null, 2),
      'utf-8',
    )
    console.log('[Chat 工具配置] 已保存')
  } catch (error) {
    console.error('[Chat 工具配置] 保存失败:', error)
    throw new Error('保存 Chat 工具配置失败')
  }
}

/**
 * 更新单个工具的开关状态
 */
export function updateToolState(toolId: string, state: ChatToolState): void {
  const config = getChatToolsConfig()
  config.toolStates[toolId] = state
  saveChatToolsConfig(config)
}

/**
 * 更新工具凭据
 */
export function updateToolCredentials(toolId: string, credentials: Record<string, string>): void {
  const config = getChatToolsConfig()
  config.toolCredentials[toolId] = credentials
  saveChatToolsConfig(config)
}

/**
 * 获取工具开关状态（不存在时返回默认关闭）
 */
export function getToolState(toolId: string): ChatToolState {
  const config = getChatToolsConfig()
  return config.toolStates[toolId] ?? { enabled: false }
}

/**
 * 获取工具凭据
 */
export function getToolCredentials(toolId: string): Record<string, string> {
  const config = getChatToolsConfig()
  return config.toolCredentials[toolId] ?? {}
}

/**
 * 添加自定义工具
 */
export function addCustomTool(meta: ChatToolMeta): void {
  const config = getChatToolsConfig()
  // 去重
  config.customTools = config.customTools.filter((t) => t.id !== meta.id)
  config.customTools.push(meta)
  config.toolStates[meta.id] = { enabled: false }
  saveChatToolsConfig(config)
}

/**
 * 删除自定义工具
 */
export function deleteCustomTool(toolId: string): void {
  const config = getChatToolsConfig()
  config.customTools = config.customTools.filter((t) => t.id !== toolId)
  delete config.toolStates[toolId]
  delete config.toolCredentials[toolId]
  saveChatToolsConfig(config)
}
