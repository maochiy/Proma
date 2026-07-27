import {
  CCB_PROTOCOL_VERSION,
  type CcbInteractionResponse,
  type CcbPermissionMode,
  type CcbRuntimeCapabilities,
  type CcbRuntimeCommand,
  type CcbRuntimeEnvelope,
  type CcbRuntimeError,
  type CcbRuntimeEvent,
  type CcbRuntimeModelCatalog,
  type CcbSessionOptions,
} from './protocol'
import type { AgentRuntimeProviderConfiguration } from '@proma/shared'

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024
const PERMISSION_MODES = new Set<CcbPermissionMode>([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
])
const SESSION_STATES = new Set([
  'cold',
  'starting',
  'ready',
  'busy',
  'suspended',
  'crashed',
  'closed',
])
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error'])
const QUEUE_PRIORITIES = new Set(['now', 'next', 'later'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertRecord(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`)
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} 必须是非空字符串`)
  }
}

function assertOptionalString(value: unknown, path: string): void {
  if (value !== undefined) assertString(value, path)
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} 必须是 boolean`)
}

function assertOptionalBoolean(value: unknown, path: string): void {
  if (value !== undefined) assertBoolean(value, path)
}

function assertFiniteNumber(
  value: unknown,
  path: string,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} 必须是有限数字`)
  }
}

function assertStringArray(
  value: unknown,
  path: string,
): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${path} 必须是字符串数组`)
  }
}

function assertStringRecord(value: unknown, path: string): void {
  assertRecord(value, path)
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      throw new Error(`${path}.${key} 必须是字符串`)
    }
  }
}

function assertPermissionMode(
  value: unknown,
  path: string,
): asserts value is CcbPermissionMode {
  if (
    typeof value !== 'string' ||
    !PERMISSION_MODES.has(value as CcbPermissionMode)
  ) {
    throw new Error(`${path} 非法`)
  }
}

function assertRuntimeError(
  value: unknown,
  path: string,
): asserts value is CcbRuntimeError {
  assertRecord(value, path)
  assertString(value.code, `${path}.code`)
  assertString(value.message, `${path}.message`)
  assertOptionalString(value.stack, `${path}.stack`)
  assertOptionalBoolean(value.recoverable, `${path}.recoverable`)
}

function assertThinkingConfig(value: unknown, path: string): void {
  assertRecord(value, path)
  if (
    value.type !== 'adaptive' &&
    value.type !== 'enabled' &&
    value.type !== 'disabled'
  ) {
    throw new Error(`${path}.type 非法`)
  }
  if (value.type === 'enabled') {
    assertFiniteNumber(value.budgetTokens, `${path}.budgetTokens`)
    if (value.budgetTokens <= 0) {
      throw new Error(`${path}.budgetTokens 必须大于 0`)
    }
  }
}

function assertThinkingEffortLevel(value: unknown, path: string): void {
  if (
    value !== 'low'
    && value !== 'medium'
    && value !== 'high'
    && value !== 'xhigh'
    && value !== 'max'
  ) {
    throw new Error(`${path} 非法`)
  }
}

function assertProviderConfiguration(
  value: unknown,
  path: string,
): asserts value is AgentRuntimeProviderConfiguration {
  assertRecord(value, path)
  if (
    value.modelType !== 'anthropic'
    && value.modelType !== 'openai'
    && value.modelType !== 'gemini'
    && value.modelType !== 'grok'
  ) {
    throw new Error(`${path}.modelType 非法`)
  }
  assertOptionalString(value.defaultModel, `${path}.defaultModel`)
  if (!Array.isArray(value.models)) {
    throw new Error(`${path}.models 必须是数组`)
  }
  for (const [index, model] of value.models.entries()) {
    const modelPath = `${path}.models.${index}`
    assertRecord(model, modelPath)
    assertString(model.id, `${modelPath}.id`)
    assertOptionalString(model.name, `${modelPath}.name`)
    assertOptionalString(model.description, `${modelPath}.description`)
    if (model.contextWindow !== undefined) {
      assertFiniteNumber(model.contextWindow, `${modelPath}.contextWindow`)
      if (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0) {
        throw new Error(`${modelPath}.contextWindow 必须是正整数`)
      }
    }
    if (model.effortLevels !== undefined) {
      if (!Array.isArray(model.effortLevels)) {
        throw new Error(`${modelPath}.effortLevels 必须是数组`)
      }
      for (const level of model.effortLevels) {
        assertThinkingEffortLevel(level, `${modelPath}.effortLevels`)
      }
    }
  }
}

function assertSessionOptions(
  value: unknown,
  path: string,
): asserts value is CcbSessionOptions {
  assertRecord(value, path)
  assertString(value.cwd, `${path}.cwd`)
  assertOptionalString(value.runtimeSessionId, `${path}.runtimeSessionId`)
  assertOptionalBoolean(value.resume, `${path}.resume`)
  assertOptionalString(value.model, `${path}.model`)
  assertOptionalString(value.fallbackModel, `${path}.fallbackModel`)
  if (value.thinkingConfig !== undefined) {
    assertThinkingConfig(value.thinkingConfig, `${path}.thinkingConfig`)
  }
  if (value.effortLevel !== undefined) {
    assertThinkingEffortLevel(value.effortLevel, `${path}.effortLevel`)
  }
  assertPermissionMode(value.permissionMode, `${path}.permissionMode`)
  assertRecord(value.environment, `${path}.environment`)
  assertStringRecord(
    value.environment.variables,
    `${path}.environment.variables`,
  )
  assertString(value.environment.configDir, `${path}.environment.configDir`)
  if (value.providerConfiguration !== undefined) {
    assertProviderConfiguration(
      value.providerConfiguration,
      `${path}.providerConfiguration`,
    )
  }
  if (value.mcpServers !== undefined) {
    assertRecord(value.mcpServers, `${path}.mcpServers`)
  }
  assertOptionalString(value.systemPrompt, `${path}.systemPrompt`)
  assertOptionalString(value.appendSystemPrompt, `${path}.appendSystemPrompt`)
  if (value.maxTurns !== undefined) {
    assertFiniteNumber(value.maxTurns, `${path}.maxTurns`)
    if (!Number.isInteger(value.maxTurns) || value.maxTurns <= 0) {
      throw new Error(`${path}.maxTurns 必须是正整数`)
    }
  }
  if (value.maxBudgetUsd !== undefined) {
    assertFiniteNumber(value.maxBudgetUsd, `${path}.maxBudgetUsd`)
    if (value.maxBudgetUsd < 0) {
      throw new Error(`${path}.maxBudgetUsd 不能小于 0`)
    }
  }
  assertOptionalBoolean(
    value.includePartialMessages,
    `${path}.includePartialMessages`,
  )
}

function assertInteractionResponse(
  value: unknown,
  path: string,
): asserts value is CcbInteractionResponse {
  assertRecord(value, path)
  assertString(value.outcome, `${path}.outcome`)
  switch (value.outcome) {
    case 'allow':
      if (value.updatedInput !== undefined) {
        assertRecord(value.updatedInput, `${path}.updatedInput`)
      }
      assertOptionalBoolean(value.alwaysAllow, `${path}.alwaysAllow`)
      return
    case 'deny':
      assertOptionalString(value.message, `${path}.message`)
      assertOptionalBoolean(value.alwaysDeny, `${path}.alwaysDeny`)
      return
    case 'cancel':
      return
    case 'answer':
      assertRecord(value.answers, `${path}.answers`)
      for (const [key, answer] of Object.entries(value.answers)) {
        if (
          typeof answer !== 'string' &&
          (!Array.isArray(answer) ||
            answer.some(item => typeof item !== 'string'))
        ) {
          throw new Error(`${path}.answers.${key} 必须是字符串或字符串数组`)
        }
      }
      return
    case 'approvePlan':
      if (value.mode !== undefined) {
        assertPermissionMode(value.mode, `${path}.mode`)
      }
      return
    case 'rejectPlan':
      assertOptionalString(value.feedback, `${path}.feedback`)
      return
    default:
      throw new Error(`${path}.outcome 不支持: ${value.outcome}`)
  }
}

function assertInteractionRequest(
  value: unknown,
  path: string,
  permission: boolean,
): void {
  assertRecord(value, path)
  assertString(value.interactionId, `${path}.interactionId`)
  assertString(value.toolUseId, `${path}.toolUseId`)
  assertRecord(value.input, `${path}.input`)
  if (permission) {
    assertString(value.toolName, `${path}.toolName`)
    if (value.suggestions !== undefined && !Array.isArray(value.suggestions)) {
      throw new Error(`${path}.suggestions 必须是数组`)
    }
  }
}

function assertSdkMessage(value: unknown, path: string): void {
  assertRecord(value, path)
  assertString(value.type, `${path}.type`)
}

function assertCapabilities(
  value: unknown,
  path: string,
): asserts value is CcbRuntimeCapabilities {
  assertRecord(value, path)
  if (value.runtimeName !== 'claude-code-best') {
    throw new Error(`${path}.runtimeName 非法`)
  }
  assertFiniteNumber(value.protocolVersion, `${path}.protocolVersion`)
  for (const field of [
    'tools',
    'commands',
    'skills',
    'agents',
    'plugins',
    'hooks',
    'providerTypes',
    'mcpCapabilities',
    'permissionModes',
    'sessionOperations',
    'features',
    'buildFeatureFlags',
    'transportExclusions',
  ]) {
    assertStringArray(value[field], `${path}.${field}`)
  }
  const permissionModes = value.permissionModes
  assertStringArray(permissionModes, `${path}.permissionModes`)
  for (const mode of permissionModes) {
    assertPermissionMode(mode, `${path}.permissionModes`)
  }
}

function assertBaseEnvelope(
  value: unknown,
): asserts value is CcbRuntimeEnvelope<CcbRuntimeCommand | CcbRuntimeEvent> {
  assertRecord(value, 'CCB Runtime envelope')
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new Error('CCB Runtime envelope 不能序列化')
  }
  if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) {
    throw new Error(`CCB Runtime 消息超过 ${MAX_MESSAGE_BYTES} bytes 限制`)
  }
  if (value.protocolVersion !== CCB_PROTOCOL_VERSION) {
    throw new Error(
      `CCB Runtime protocol 不兼容: expected=${CCB_PROTOCOL_VERSION}, actual=${String(value.protocolVersion)}`,
    )
  }
  assertString(value.requestId, 'CCB Runtime envelope.requestId')
  assertOptionalString(value.sessionId, 'CCB Runtime envelope.sessionId')
  if (value.sequence !== undefined) {
    assertFiniteNumber(value.sequence, 'CCB Runtime envelope.sequence')
    if (!Number.isInteger(value.sequence) || value.sequence < 0) {
      throw new Error('CCB Runtime envelope.sequence 必须是非负整数')
    }
  }
  assertFiniteNumber(value.timestamp, 'CCB Runtime envelope.timestamp')
  assertRecord(value.payload, 'CCB Runtime envelope.payload')
  assertString(value.payload.type, 'CCB Runtime envelope.payload.type')
}

function assertSessionId(
  envelope: CcbRuntimeEnvelope<CcbRuntimeCommand | CcbRuntimeEvent>,
): void {
  assertString(envelope.sessionId, `${envelope.payload.type}.sessionId`)
}

export function assertCcbCommandEnvelope(
  value: unknown,
): asserts value is CcbRuntimeEnvelope<CcbRuntimeCommand> {
  assertBaseEnvelope(value)
  const payload = value.payload
  switch (payload.type) {
    case 'host.initialize':
      assertOptionalString(
        payload.expectedRuntimeVersion,
        'host.initialize.expectedRuntimeVersion',
      )
      return
    case 'host.getCapabilities':
    case 'host.shutdown':
      return
    case 'session.open':
    case 'session.resume':
      assertSessionId(value)
      assertSessionOptions(payload.options, `${payload.type}.options`)
      return
    case 'session.suspend':
    case 'session.close':
    case 'session.getState':
    case 'turn.stop':
      assertSessionId(value)
      return
    case 'session.resolveModelCatalog':
      assertSessionId(value)
      assertRecord(payload.environment, `${payload.type}.environment`)
      assertStringRecord(
        payload.environment.variables,
        `${payload.type}.environment.variables`,
      )
      assertString(
        payload.environment.configDir,
        `${payload.type}.environment.configDir`,
      )
      assertProviderConfiguration(
        payload.providerConfiguration,
        `${payload.type}.providerConfiguration`,
      )
      return
    case 'session.setPermissionMode':
      assertSessionId(value)
      assertPermissionMode(payload.mode, `${payload.type}.mode`)
      return
    case 'session.updateConfig':
      assertSessionId(value)
      assertOptionalString(payload.model, `${payload.type}.model`)
      if (payload.thinkingConfig !== undefined) {
        assertThinkingConfig(
          payload.thinkingConfig,
          `${payload.type}.thinkingConfig`,
        )
      }
      if (payload.effortLevel !== undefined) {
        assertThinkingEffortLevel(
          payload.effortLevel,
          `${payload.type}.effortLevel`,
        )
      }
      return
    case 'session.setEffortLevel':
      assertSessionId(value)
      if (payload.level !== undefined) {
        assertThinkingEffortLevel(payload.level, `${payload.type}.level`)
      }
      return
    case 'session.compact':
      assertSessionId(value)
      assertOptionalString(payload.instructions, `${payload.type}.instructions`)
      return
    case 'session.fork':
      assertSessionId(value)
      assertOptionalString(
        payload.upToMessageUuid,
        `${payload.type}.upToMessageUuid`,
      )
      return
    case 'session.rewind':
      assertSessionId(value)
      assertString(payload.messageUuid, `${payload.type}.messageUuid`)
      return
    case 'turn.start':
      assertSessionId(value)
      assertString(payload.prompt, `${payload.type}.prompt`)
      assertOptionalString(payload.uuid, `${payload.type}.uuid`)
      return
    case 'turn.enqueue':
      assertSessionId(value)
      assertString(payload.prompt, `${payload.type}.prompt`)
      assertOptionalString(payload.uuid, `${payload.type}.uuid`)
      if (
        payload.priority !== undefined &&
        (typeof payload.priority !== 'string' ||
          !QUEUE_PRIORITIES.has(payload.priority))
      ) {
        throw new Error(`${payload.type}.priority 非法`)
      }
      return
    case 'turn.interrupt':
      assertSessionId(value)
      assertOptionalString(payload.prompt, `${payload.type}.prompt`)
      assertOptionalString(payload.uuid, `${payload.type}.uuid`)
      return
    case 'interaction.resolve':
      assertSessionId(value)
      assertString(payload.interactionId, `${payload.type}.interactionId`)
      assertInteractionResponse(payload.response, `${payload.type}.response`)
      return
    default:
      throw new Error(`CCB Runtime command 不支持: ${payload.type}`)
  }
}

export function assertCcbRuntimeModelCatalog(
  value: unknown,
): asserts value is CcbRuntimeModelCatalog {
  assertRecord(value, 'CCB Runtime model catalog')
  assertOptionalString(
    value.defaultModel,
    'CCB Runtime model catalog.defaultModel',
  )
  if (!Array.isArray(value.models)) {
    throw new Error('CCB Runtime model catalog.models 必须是数组')
  }
  for (const [index, model] of value.models.entries()) {
    const path = `CCB Runtime model catalog.models.${index}`
    assertRecord(model, path)
    assertString(model.value, `${path}.value`)
    assertString(model.displayName, `${path}.displayName`)
    assertString(model.description, `${path}.description`)
    assertFiniteNumber(model.contextWindow, `${path}.contextWindow`)
    if (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0) {
      throw new Error(`${path}.contextWindow 必须是正整数`)
    }
    assertBoolean(model.supportsEffort, `${path}.supportsEffort`)
    if (!Array.isArray(model.supportedEffortLevels)) {
      throw new Error(`${path}.supportedEffortLevels 必须是数组`)
    }
    for (const level of model.supportedEffortLevels) {
      assertThinkingEffortLevel(level, `${path}.supportedEffortLevels`)
    }
    if (model.defaultEffortLevel !== undefined) {
      assertThinkingEffortLevel(
        model.defaultEffortLevel,
        `${path}.defaultEffortLevel`,
      )
    }
    assertBoolean(
      model.supportsAdaptiveThinking,
      `${path}.supportsAdaptiveThinking`,
    )
    assertBoolean(model.supportsFastMode, `${path}.supportsFastMode`)
    assertBoolean(model.supportsAutoMode, `${path}.supportsAutoMode`)
  }
}

export function assertCcbEventEnvelope(
  value: unknown,
): asserts value is CcbRuntimeEnvelope<CcbRuntimeEvent> {
  assertBaseEnvelope(value)
  const payload = value.payload
  switch (payload.type) {
    case 'host.ready':
      assertString(payload.runtimeVersion, `${payload.type}.runtimeVersion`)
      assertCapabilities(payload.capabilities, `${payload.type}.capabilities`)
      return
    case 'response.success':
      assertString(payload.responseTo, `${payload.type}.responseTo`)
      return
    case 'response.failure':
      assertString(payload.responseTo, `${payload.type}.responseTo`)
      assertRuntimeError(payload.error, `${payload.type}.error`)
      return
    case 'session.stateChanged':
      assertSessionId(value)
      if (
        typeof payload.state !== 'string' ||
        !SESSION_STATES.has(payload.state)
      ) {
        throw new Error(`${payload.type}.state 非法`)
      }
      assertOptionalString(
        payload.runtimeSessionId,
        `${payload.type}.runtimeSessionId`,
      )
      return
    case 'runtime.message':
      assertSessionId(value)
      assertSdkMessage(payload.message, `${payload.type}.message`)
      return
    case 'runtime.progress':
      assertSessionId(value)
      assertString(payload.phase, `${payload.type}.phase`)
      assertOptionalString(payload.detail, `${payload.type}.detail`)
      if (payload.data !== undefined) {
        assertRecord(payload.data, `${payload.type}.data`)
      }
      return
    case 'interaction.permissionRequested':
      assertSessionId(value)
      assertInteractionRequest(payload.request, `${payload.type}.request`, true)
      return
    case 'interaction.askUserRequested':
    case 'interaction.planApprovalRequested':
      assertSessionId(value)
      assertInteractionRequest(payload.request, `${payload.type}.request`, false)
      return
    case 'turn.completed':
      assertSessionId(value)
      if (payload.result !== undefined) {
        assertSdkMessage(payload.result, `${payload.type}.result`)
      }
      return
    case 'turn.failed':
      assertSessionId(value)
      assertRuntimeError(payload.error, `${payload.type}.error`)
      return
    case 'worker.crashed':
      assertSessionId(value)
      if (payload.exitCode !== null) {
        assertFiniteNumber(payload.exitCode, `${payload.type}.exitCode`)
        if (!Number.isInteger(payload.exitCode)) {
          throw new Error(`${payload.type}.exitCode 必须是整数或 null`)
        }
      }
      if (payload.signal !== null) {
        assertString(payload.signal, `${payload.type}.signal`)
      }
      assertBoolean(payload.recoverable, `${payload.type}.recoverable`)
      return
    case 'runtime.credentialsUpdated':
      assertSessionId(value)
      if (payload.provider !== 'openai-codex') {
        throw new Error(`${payload.type}.provider 非法`)
      }
      assertRecord(payload.credentials, `${payload.type}.credentials`)
      assertString(
        payload.credentials.access,
        `${payload.type}.credentials.access`,
      )
      assertString(
        payload.credentials.refresh,
        `${payload.type}.credentials.refresh`,
      )
      assertFiniteNumber(
        payload.credentials.expires,
        `${payload.type}.credentials.expires`,
      )
      assertOptionalString(
        payload.credentials.accountId,
        `${payload.type}.credentials.accountId`,
      )
      return
    case 'runtime.log':
      if (
        typeof payload.level !== 'string' ||
        !LOG_LEVELS.has(payload.level)
      ) {
        throw new Error(`${payload.type}.level 非法`)
      }
      assertString(payload.message, `${payload.type}.message`)
      return
    default:
      throw new Error(`CCB Runtime event 不支持: ${payload.type}`)
  }
}
