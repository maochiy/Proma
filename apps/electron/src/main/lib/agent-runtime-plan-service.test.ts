import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntimePlanPersistedStore } from '@proma/shared'

type RuntimePlanServiceModule = typeof import('./agent-runtime-plan-service')

let service: RuntimePlanServiceModule
let tempDir: string
let storePath: string

mock.module('./config-paths', () => ({
  getAgentRuntimePlansPath: () => storePath,
}))

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'proma-runtime-plan-store-'))
  storePath = join(tempDir, 'agent-runtime-plans.json')
  service = await import('./agent-runtime-plan-service')
})

beforeEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  mkdirSync(tempDir, { recursive: true })
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('Agent 计划生命周期持久化', () => {
  test('Given 配置文件不存在 When 连续读取 Then 返回彼此独立的空状态', () => {
    const first = service.getAgentRuntimePlanStore()
    first.sessions.changed = { archived: [] }

    expect(service.getAgentRuntimePlanStore()).toEqual({
      sessions: {},
      updatedAt: 0,
    })
  })

  test('Given 有效生命周期状态 When 保存后读取 Then 完整恢复', () => {
    const store: AgentRuntimePlanPersistedStore = {
      sessions: {
        session: {
          current: {
            id: 'plan',
            todos: [{
              id: 'todo',
              content: '继续验证',
              status: 'in_progress',
            }],
            status: 'interrupted',
            visible: false,
            createdAt: 1,
            updatedAt: 2,
            interruptedAt: 2,
            expiresAt: 3,
          },
          archived: [],
          turnEpoch: 100,
        },
      },
      updatedAt: 200,
    }

    service.saveAgentRuntimePlanStore(store)

    expect(service.getAgentRuntimePlanStore()).toEqual(store)
    expect(JSON.parse(readFileSync(storePath, 'utf-8'))).toEqual(store)
  })

  test('Given 主文件在后续写入后损坏 When 读取 Then 从原子备份恢复上一份有效状态', () => {
    const previous: AgentRuntimePlanPersistedStore = {
      sessions: {
        previous: {
          archived: [],
          turnEpoch: 100,
        },
      },
      updatedAt: 100,
    }
    const latest: AgentRuntimePlanPersistedStore = {
      sessions: {
        latest: {
          archived: [],
          turnEpoch: 200,
        },
      },
      updatedAt: 200,
    }
    service.saveAgentRuntimePlanStore(previous)
    service.saveAgentRuntimePlanStore(latest)
    writeFileSync(storePath, '{not-json', 'utf-8')

    expect(service.getAgentRuntimePlanStore()).toEqual(previous)
    expect(JSON.parse(readFileSync(storePath, 'utf-8'))).toEqual(previous)
  })

  test('Given 配置文件损坏或 sessions 不是对象 When 读取 Then 安全降级为空状态', () => {
    const originalConsoleError = console.error
    const originalConsoleWarn = console.warn
    console.error = () => undefined
    console.warn = () => undefined
    try {
      writeFileSync(storePath, '{not-json', 'utf-8')
      expect(service.getAgentRuntimePlanStore()).toEqual({
        sessions: {},
        updatedAt: 0,
      })

      writeFileSync(storePath, JSON.stringify({
        sessions: [],
        updatedAt: 10,
      }), 'utf-8')
      expect(service.getAgentRuntimePlanStore()).toEqual({
        sessions: {},
        updatedAt: 10,
      })
    } finally {
      console.error = originalConsoleError
      console.warn = originalConsoleWarn
    }
  })
})
