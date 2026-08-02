import {
  DEFAULT_CONTEXT_WINDOW,
  inferContextWindow,
  type AgentRuntimeModelCatalog,
  type AgentRuntimeProviderConfiguration,
} from '@proma/shared'

const DEFAULT_MODEL_CATALOG_WATCHDOG_MS = 90_000
const MIN_MODEL_CATALOG_WATCHDOG_MS = 5_000
const MAX_MODEL_CATALOG_WATCHDOG_MS = 5 * 60_000
const fallbackCatalogs = new WeakSet<AgentRuntimeModelCatalog>()

/**
 * 模型目录请求优先等待 Runtime 的成功/失败通知；watchdog 只负责处理
 * Host 仍存活但控制请求永久无响应的异常情况。可通过环境变量按部署调整。
 */
export function getModelCatalogWatchdogMs(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const configured = Number(environment.PROMA_CCB_MODEL_CATALOG_WATCHDOG_MS)
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MODEL_CATALOG_WATCHDOG_MS
  }
  return Math.min(
    MAX_MODEL_CATALOG_WATCHDOG_MS,
    Math.max(MIN_MODEL_CATALOG_WATCHDOG_MS, Math.round(configured)),
  )
}

export function createModelCatalogWatchdog(
  timeoutMs = getModelCatalogWatchdogMs(),
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  }
}

function resolveConfiguredModel(
  configuration: AgentRuntimeProviderConfiguration,
  requestedModel?: string,
): AgentRuntimeProviderConfiguration['models'][number] | undefined {
  const normalizedRequested = requestedModel?.replace(/\[1m\]$/i, '')
  return configuration.models.find(model =>
    model.id === requestedModel || model.id === normalizedRequested,
  ) ?? configuration.models.find(
    model => model.id === configuration.defaultModel,
  ) ?? configuration.models[0]
}

export function resolveFallbackModel(
  configuration: AgentRuntimeProviderConfiguration,
  requestedModel?: string,
): { value: string; contextWindow: number } | undefined {
  const model = resolveConfiguredModel(configuration, requestedModel)
  if (!model) return undefined
  return {
    value: model.id,
    contextWindow:
      model.contextWindow
      ?? inferContextWindow(model.id)
      ?? DEFAULT_CONTEXT_WINDOW,
  }
}

/**
 * Runtime 目录异常时返回保守目录，保证模型选择器和会话启动可继续工作。
 * 未经 Runtime 证实的 adaptive / fast / auto 能力一律不主动开启。
 */
export function buildFallbackModelCatalog(
  channelId: string,
  configuration: AgentRuntimeProviderConfiguration,
): AgentRuntimeModelCatalog {
  const models = configuration.models.map(model => {
    const contextWindow =
      model.contextWindow
      ?? inferContextWindow(model.id)
      ?? DEFAULT_CONTEXT_WINDOW
    const supportedEffortLevels = [...(model.effortLevels ?? [])]
    return {
      value: model.id,
      displayName: model.name ?? model.id,
      description: model.description ?? '',
      contextWindow,
      supportsEffort: supportedEffortLevels.length > 0,
      supportedEffortLevels,
      supportsAdaptiveThinking: false,
      supportsFastMode: false,
      supportsAutoMode: false,
    }
  })
  const catalog: AgentRuntimeModelCatalog = {
    channelId,
    defaultModel:
      configuration.defaultModel
      ?? models[0]?.value,
    models,
    contextPolicy: {
      autoCompactEnabled: false,
      models: models.map(model => ({
        model: model.value,
        contextWindow: model.contextWindow,
        effectiveContextWindow: model.contextWindow,
        autoCompactThreshold: model.contextWindow,
      })),
    },
  }
  fallbackCatalogs.add(catalog)
  return catalog
}

export function isFallbackModelCatalog(
  catalog: AgentRuntimeModelCatalog,
): boolean {
  return fallbackCatalogs.has(catalog)
}
