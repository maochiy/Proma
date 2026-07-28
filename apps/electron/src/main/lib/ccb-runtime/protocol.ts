import type {
  AgentRuntimeModelCatalog,
  AgentRuntimeProviderConfiguration,
  AgentRuntimeExecutionGraph,
  AgentRuntimeSessionCatalog,
  AgentRuntimeSessionTranscript,
  AgentRuntimeSubagentTranscript,
  RuntimeSkillCatalog,
  SDKMessage,
  ThinkingConfig,
  ThinkingEffortLevel,
} from '@proma/shared'

export const CCB_PROTOCOL_VERSION = 5
export const EXPECTED_CCB_RUNTIME_VERSION = '2.8.15'
export const EXPECTED_CCB_RUNTIME_COMMIT = '0c6c868dc55b8836e4c48288ae4dd235883711e7'

export type CcbPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'
  | 'auto'

export interface CcbRuntimeEnvelope<T> {
  protocolVersion: number
  requestId: string
  sessionId?: string
  sequence?: number
  timestamp: number
  payload: T
}

export interface CcbSessionOptions {
  cwd: string
  additionalSkillDirectories?: string[]
  runtimeSessionId?: string
  resume?: boolean
  model?: string
  fallbackModel?: string
  thinkingConfig?: ThinkingConfig
  effortLevel?: ThinkingEffortLevel
  permissionMode: CcbPermissionMode
  environment: {
    variables: Record<string, string>
    configDir: string
  }
  providerConfiguration?: AgentRuntimeProviderConfiguration
  mcpServers?: Record<string, unknown>
  systemPrompt?: string
  appendSystemPrompt?: string
  maxTurns?: number
  maxBudgetUsd?: number
  includePartialMessages?: boolean
}

export type CcbInteractionResponse =
  | { outcome: 'allow'; updatedInput?: Record<string, unknown>; alwaysAllow?: boolean }
  | { outcome: 'deny'; message?: string; alwaysDeny?: boolean }
  | { outcome: 'cancel' }
  | { outcome: 'answer'; answers: Record<string, string | string[]> }
  | { outcome: 'approvePlan'; mode?: CcbPermissionMode }
  | { outcome: 'rejectPlan'; feedback?: string }

export type CcbRuntimeCommand =
  | { type: 'host.initialize'; expectedRuntimeVersion?: string }
  | { type: 'host.getCapabilities' }
  | { type: 'host.shutdown' }
  | { type: 'session.open'; options: CcbSessionOptions }
  | { type: 'session.resume'; options: CcbSessionOptions }
  | { type: 'session.suspend' }
  | { type: 'session.close' }
  | { type: 'session.getState' }
  | {
      type: 'session.resolveModelCatalog'
      cwd: string
      environment: {
        variables: Record<string, string>
        configDir: string
      }
      providerConfiguration: AgentRuntimeProviderConfiguration
    }
  | { type: 'session.resolveSkillCatalog'; options: CcbSessionOptions }
  | {
      type: 'session.list'
      cwd: string
      environment: {
        variables: Record<string, string>
        configDir: string
      }
      limit?: number
      offset?: number
    }
  | {
      type: 'session.getTranscript'
      cwd: string
      environment: {
        variables: Record<string, string>
        configDir: string
      }
      runtimeSessionId: string
    }
  | {
      type: 'session.delete'
      cwd: string
      environment: {
        variables: Record<string, string>
        configDir: string
      }
      runtimeSessionId: string
    }
  | { type: 'session.getExecutionGraph' }
  | { type: 'session.getSubagentTranscript'; executionNodeId: string }
  | { type: 'session.setPermissionMode'; mode: CcbPermissionMode }
  | {
      type: 'session.updateConfig'
      model?: string
      thinkingConfig?: ThinkingConfig
      effortLevel?: ThinkingEffortLevel
    }
  | { type: 'session.setEffortLevel'; level?: ThinkingEffortLevel }
  | { type: 'session.compact'; instructions?: string }
  | { type: 'session.fork'; upToMessageUuid?: string }
  | { type: 'session.rewind'; messageUuid: string }
  | { type: 'turn.start'; prompt: string; uuid?: string }
  | { type: 'turn.enqueue'; prompt: string; uuid?: string; priority?: 'now' | 'next' | 'later' }
  | { type: 'turn.interrupt'; prompt?: string; uuid?: string }
  | { type: 'turn.stop' }
  | { type: 'interaction.resolve'; interactionId: string; response: CcbInteractionResponse }

export interface CcbRuntimeError {
  code: string
  message: string
  stack?: string
  recoverable?: boolean
}

export interface CcbRuntimeCapabilities {
  runtimeName: 'claude-code-best'
  protocolVersion: number
  tools: string[]
  commands: string[]
  skills: string[]
  agents: string[]
  plugins: string[]
  hooks: string[]
  providerTypes: string[]
  mcpCapabilities: string[]
  permissionModes: CcbPermissionMode[]
  sessionOperations: string[]
  features: string[]
  buildFeatureFlags: string[]
  transportExclusions: string[]
}

export type CcbRuntimeEvent =
  | { type: 'host.ready'; runtimeVersion: string; capabilities: CcbRuntimeCapabilities }
  | { type: 'response.success'; responseTo: string; result?: unknown }
  | { type: 'response.failure'; responseTo: string; error: CcbRuntimeError }
  | {
      type: 'session.stateChanged'
      state: 'cold' | 'starting' | 'ready' | 'busy' | 'suspended' | 'crashed' | 'closed'
      runtimeSessionId?: string
    }
  | { type: 'runtime.message'; message: SDKMessage }
  | { type: 'runtime.executionGraphChanged'; graph: AgentRuntimeExecutionGraph }
  | { type: 'runtime.progress'; phase: string; detail?: string; data?: Record<string, unknown> }
  | {
      type: 'interaction.permissionRequested'
      request: {
        interactionId: string
        toolName: string
        toolUseId: string
        input: Record<string, unknown>
        suggestions?: unknown[]
      }
    }
  | {
      type: 'interaction.askUserRequested'
      request: { interactionId: string; toolUseId: string; input: Record<string, unknown> }
    }
  | {
      type: 'interaction.planApprovalRequested'
      request: { interactionId: string; toolUseId: string; input: Record<string, unknown> }
    }
  | { type: 'turn.completed'; result?: SDKMessage }
  | { type: 'turn.failed'; error: CcbRuntimeError }
  | { type: 'worker.crashed'; exitCode: number | null; signal: string | null; recoverable: boolean }
  | {
      type: 'runtime.credentialsUpdated'
      provider: 'openai-codex'
      credentials: {
        access: string
        refresh: string
        expires: number
        accountId?: string
      }
    }
  | { type: 'runtime.log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string }

export interface CcbRuntimeManifest {
  runtimeName: 'claude-code-best'
  runtimeVersion: string
  gitCommit: string
  protocolVersion: number
  platform: string
  arch: string
  buildTime: string
  entrypoints: { host: string; worker: string }
  capabilitiesHash: string
  files: Array<{ path: string; sha256: string; executable?: boolean }>
}

export type CcbRuntimeModelCatalog = Omit<AgentRuntimeModelCatalog, 'channelId'>
export type CcbRuntimeSessionCatalog = AgentRuntimeSessionCatalog
export type CcbRuntimeSessionTranscript = AgentRuntimeSessionTranscript
export type CcbRuntimeExecutionGraph = AgentRuntimeExecutionGraph
export type CcbRuntimeSubagentTranscript = AgentRuntimeSubagentTranscript
export type CcbRuntimeSkillCatalog = Omit<
  RuntimeSkillCatalog,
  'runtimeVersion' | 'runtimeArtifactCommit'
>
