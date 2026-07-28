import type {
  PromaPermissionMode,
  ThinkingConfig,
  ThinkingEffortLevel,
} from '@proma/shared'
import type { CcbPermissionMode } from './protocol'

export interface RuntimeConfigUpdate {
  model?: string
  thinkingConfig?: ThinkingConfig
  effortLevel?: ThinkingEffortLevel
}

/** 构造 CCB Session 热更新命令，确保思考等级不会在桌面桥接层丢失。 */
export function createSessionRuntimeConfigCommand(
  updates: RuntimeConfigUpdate,
): {
  type: 'session.updateConfig'
  model?: string
  thinkingConfig?: ThinkingConfig
  effortLevel?: ThinkingEffortLevel
} {
  return {
    type: 'session.updateConfig',
    ...('model' in updates ? { model: updates.model } : {}),
    ...('thinkingConfig' in updates
      ? { thinkingConfig: updates.thinkingConfig }
      : {}),
    ...('effortLevel' in updates
      ? { effortLevel: updates.effortLevel }
      : {}),
  }
}

/** 将 Proma 审批模式无损映射到 CCB Runtime。 */
export function resolveCcbPermissionMode(
  mode: PromaPermissionMode | undefined,
): CcbPermissionMode {
  return mode ?? 'bypassPermissions'
}
