import type {
  AgentRuntimeModelInfo,
  ThinkingConfig,
  ThinkingEffortLevel,
} from '@proma/shared'

export const THINKING_EFFORT_ORDER: readonly ThinkingEffortLevel[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

export const THINKING_EFFORT_LABELS: Record<ThinkingEffortLevel, string> = {
  low: '轻度',
  medium: '标准',
  high: '高级',
  xhigh: '深度',
  max: '最大',
}

export interface AgentThinkingEffortCapability {
  levels: ThinkingEffortLevel[]
  defaultLevel: ThinkingEffortLevel
}

export interface AgentRuntimeThinkingSelection {
  thinkingConfig?: ThinkingConfig
  effortLevel?: ThinkingEffortLevel
}

/** 优先精确匹配；仅在 CCB 规范化 `[1m]` 后缀时回退到规范化 ID。 */
export function findAgentRuntimeModel(
  models: AgentRuntimeModelInfo[],
  modelId: string | null | undefined,
): AgentRuntimeModelInfo | undefined {
  if (!modelId) return undefined
  const exact = models.find(model => model.value === modelId)
  if (exact) return exact

  const normalizedModelId = modelId.replace(/\[1m\]$/i, '')
  if (normalizedModelId === modelId) return undefined
  return models.find(model => model.value === normalizedModelId)
}

/**
 * Thinking/Effort 能力完全以 CCB Runtime 的模型目录为准。
 *
 * Renderer 不根据 Provider 或模型名称做任何推断；Runtime 不可用或明确不支持时隐藏控件。
 */
export function resolveAgentThinkingEffortCapability(
  modelInfo: AgentRuntimeModelInfo | undefined,
): AgentThinkingEffortCapability | null {
  if (
    !modelInfo
    || !modelInfo.supportsEffort
    || modelInfo.supportedEffortLevels.length === 0
  ) {
    return null
  }

  const levels = [...modelInfo.supportedEffortLevels]
  const defaultLevel =
    modelInfo.defaultEffortLevel
    && levels.includes(modelInfo.defaultEffortLevel)
      ? modelInfo.defaultEffortLevel
      : levels[0]!

  return { levels, defaultLevel }
}

export function normalizeAgentThinkingEffortLevel(
  capability: AgentThinkingEffortCapability | null,
  value: ThinkingEffortLevel | undefined,
): ThinkingEffortLevel | undefined {
  if (!capability) return undefined
  return value && capability.levels.includes(value)
    ? value
    : capability.defaultLevel
}

/** 只把 CCB 明确声明支持的 Thinking/Effort 配置发送给 Runtime。 */
export function resolveAgentRuntimeThinkingSelection(
  modelInfo: AgentRuntimeModelInfo | undefined,
  thinkingConfig: ThinkingConfig | undefined,
  effortLevel: ThinkingEffortLevel | undefined,
): AgentRuntimeThinkingSelection {
  const capability = resolveAgentThinkingEffortCapability(modelInfo)
  return {
    thinkingConfig: modelInfo?.supportsAdaptiveThinking
      ? thinkingConfig
      : undefined,
    effortLevel: normalizeAgentThinkingEffortLevel(capability, effortLevel),
  }
}
