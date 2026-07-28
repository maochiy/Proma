import { describe, expect, test } from 'bun:test'
import {
  CCB_PROTOCOL_VERSION,
  type CcbRuntimeCommand,
  type CcbRuntimeEnvelope,
  type CcbRuntimeEvent,
} from './protocol'
import {
  assertCcbCommandEnvelope,
  assertCcbEventEnvelope,
  assertCcbRuntimeModelCatalog,
  assertCcbRuntimeSkillCatalog,
} from './protocol-validation'

function commandEnvelope(
  payload: CcbRuntimeCommand,
  sessionId?: string,
): CcbRuntimeEnvelope<CcbRuntimeCommand> {
  return {
    protocolVersion: CCB_PROTOCOL_VERSION,
    requestId: 'request-1',
    sessionId,
    timestamp: Date.now(),
    payload,
  }
}

function eventEnvelope(
  payload: CcbRuntimeEvent,
  sessionId?: string,
): CcbRuntimeEnvelope<CcbRuntimeEvent> {
  return {
    protocolVersion: CCB_PROTOCOL_VERSION,
    requestId: 'event-1',
    sessionId,
    timestamp: Date.now(),
    payload,
  }
}

describe('Proma CCB Runtime protocol validation', () => {
  test('接受合法的 Turn 命令', () => {
    expect(() =>
      assertCcbCommandEnvelope(
        commandEnvelope(
          {
            type: 'turn.start',
            prompt: 'hello',
          },
          'session-1',
        ),
      ),
    ).not.toThrow()
  })

  test('拒绝缺少 Session ID 的 Turn 命令', () => {
    expect(() =>
      assertCcbCommandEnvelope(
        commandEnvelope({
          type: 'turn.start',
          prompt: 'hello',
        }),
      ),
    ).toThrow('sessionId')
  })

  test('拒绝未知命令类型', () => {
    const envelope = commandEnvelope({
      type: 'host.getCapabilities',
    }) as unknown as {
      protocolVersion: number
      requestId: string
      timestamp: number
      payload: { type: string }
    }
    envelope.payload = { type: 'unknown.command' }
    expect(() => assertCcbCommandEnvelope(envelope)).toThrow('不支持')
  })

  test('校验 Session 思考等级命令', () => {
    expect(() =>
      assertCcbCommandEnvelope(
        commandEnvelope(
          { type: 'session.setEffortLevel', level: 'max' },
          'session-1',
        ),
      ),
    ).not.toThrow()

    const envelope = commandEnvelope(
      { type: 'session.setEffortLevel', level: 'high' },
      'session-1',
    ) as unknown as {
      protocolVersion: number
      requestId: string
      sessionId: string
      timestamp: number
      payload: { type: 'session.setEffortLevel'; level: string }
    }
    envelope.payload.level = 'ultra'
    expect(() => assertCcbCommandEnvelope(envelope)).toThrow('level 非法')
  })

  test('校验 Session Runtime 配置更新命令', () => {
    expect(() =>
      assertCcbCommandEnvelope(
        commandEnvelope(
          {
            type: 'session.updateConfig',
            model: 'claude-opus-4-6',
            thinkingConfig: { type: 'adaptive' },
            effortLevel: 'max',
          },
          'session-1',
        ),
      ),
    ).not.toThrow()
  })

  test('校验 Provider-aware 模型目录命令', () => {
    expect(() =>
      assertCcbCommandEnvelope(
        commandEnvelope(
          {
            type: 'session.resolveModelCatalog',
            environment: {
              variables: {
                CLAUDE_CODE_USE_OPENAI: '1',
                OPENAI_MODEL: 'reasoner-a',
              },
              configDir: '/tmp/ccb',
            },
            providerConfiguration: {
              modelType: 'openai',
              defaultModel: 'reasoner-a',
              models: [
                {
                  id: 'reasoner-a',
                  name: 'Reasoner A',
                  effortLevels: ['low', 'high'],
                },
              ],
            },
          },
          'catalog:channel-1',
        ),
      ),
    ).not.toThrow()
  })

  test('校验 CCB Runtime 模型目录响应', () => {
    expect(() =>
      assertCcbRuntimeModelCatalog({
        defaultModel: 'reasoner-a',
        models: [
          {
            value: 'reasoner-a',
            displayName: 'Reasoner A',
            description: 'Runtime model',
            contextWindow: 200_000,
            supportsEffort: true,
            supportedEffortLevels: ['low', 'high'],
            defaultEffortLevel: 'high',
            supportsAdaptiveThinking: false,
            supportsFastMode: false,
            supportsAutoMode: false,
          },
        ],
      }),
    ).not.toThrow()
  })

  test('校验带 Proma Skills 目录的 CCB Skill Catalog 命令', () => {
    expect(() =>
      assertCcbCommandEnvelope(
        commandEnvelope(
          {
            type: 'session.resolveSkillCatalog',
            options: {
              cwd: '/tmp/project',
              additionalSkillDirectories: ['/tmp/proma-skills'],
              permissionMode: 'default',
              environment: {
                variables: {},
                configDir: '/tmp/ccb',
              },
            },
          },
          'skill-catalog:project-1',
        ),
      ),
    ).not.toThrow()
  })

  test('校验 CCB Runtime Skill Catalog 响应', () => {
    expect(() =>
      assertCcbRuntimeSkillCatalog({
        projectPath: '/tmp/project',
        resolvedAt: Date.now(),
        skills: [
          {
            id: 'proma-project:documents:/tmp/proma-skills/documents',
            name: 'documents',
            description: 'Proma 文档技能',
            source: 'proma-project',
            path: '/tmp/proma-skills/documents',
            enabled: true,
            userInvocable: true,
            modelInvocable: true,
          },
          {
            id: 'ccb-project:review:/tmp/project/.claude/skills/review',
            name: 'review',
            source: 'ccb-project',
            path: '/tmp/project/.claude/skills/review',
            enabled: true,
            userInvocable: true,
            modelInvocable: true,
          },
        ],
      }),
    ).not.toThrow()
  })

  test('接受合法的 Runtime event', () => {
    expect(() =>
      assertCcbEventEnvelope(
        eventEnvelope(
          {
            type: 'runtime.log',
            level: 'info',
            message: 'ready',
          },
          'session-1',
        ),
      ),
    ).not.toThrow()
  })

  test('拒绝缺少 recoverable 的崩溃事件', () => {
    const envelope = eventEnvelope(
      {
        type: 'worker.crashed',
        exitCode: 1,
        signal: null,
        recoverable: false,
      },
      'session-1',
    ) as unknown as {
      protocolVersion: number
      requestId: string
      sessionId: string
      timestamp: number
      payload: {
        type: 'worker.crashed'
        exitCode: number
        signal: null
        recoverable?: boolean
      }
    }
    delete envelope.payload.recoverable
    expect(() => assertCcbEventEnvelope(envelope)).toThrow('recoverable')
  })
})
