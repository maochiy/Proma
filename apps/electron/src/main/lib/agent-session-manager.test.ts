import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

type AgentSessionManager = typeof import('./agent-session-manager')
type AgentSessionContextPrompt = typeof import('./agent-session-context-prompt')

let manager: AgentSessionManager
let contextPrompt: AgentSessionContextPrompt
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
const originalResourcesPath = process.resourcesPath

mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
  BrowserWindow: class {},
  clipboard: {},
  dialog: {},
  nativeImage: { createFromPath: () => ({}) },
  nativeTheme: {},
  powerMonitor: {},
  powerSaveBlocker: {},
  screen: {},
  shell: {},
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf-8'),
  },
}))

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function jsonl(rows: string[]): string {
  return rows.join('\n') + '\n'
}

function writeAgentSessionJsonl(sessionId: string, rows: string[]): void {
  const dir = join(tempHome, '.proma', 'agent-sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), jsonl(rows), 'utf-8')
}

function writeAgentSessionsIndex(sessions: Array<{
  id: string
  title: string
  workspaceId: string
  createdAt: number
  updatedAt: number
  runtimeSessionId?: string
  titleSource?: 'runtime' | 'generated' | 'user'
  channelId?: string
  modelId?: string
  pinned?: boolean
  archived?: boolean
  starred?: boolean
  permissionMode?: 'default' | 'bypassPermissions' | 'plan'
  planModeEnabled?: boolean
  draft?: boolean
}>): void {
  const dir = join(tempHome, '.proma')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent-sessions.json'), JSON.stringify({ version: 2, sessions }), 'utf-8')
}

function createIndexedSessions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    title: `会话 ${index}`,
    workspaceId: 'workspace-a',
    createdAt: index,
    updatedAt: index,
  }))
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-agent-session-manager-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: tempHome,
  })
  delete process.env.CLAUDE_CONFIG_DIR
  manager = await import('./agent-session-manager')
  contextPrompt = await import('./agent-session-context-prompt')
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalPromaDev === undefined) {
    delete process.env.PROMA_DEV
  } else {
    process.env.PROMA_DEV = originalPromaDev
  }
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  }
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: originalResourcesPath,
  })
  rmSync(tempHome, { recursive: true, force: true })
})

describe('Agent 会话 JSONL 读取', () => {
  test('Given 会话 JSONL 混入损坏行 When 读取 SDKMessage Then 跳过坏行并保留其它消息', () => {
    writeAgentSessionJsonl('session-with-bad-line', [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '你好' }] }, parent_tool_use_id: null }),
      '{ 这不是合法 JSON',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '仍然可读' }] }, parent_tool_use_id: null }),
    ])

    const messages = manager.getAgentSessionSDKMessages('session-with-bad-line')

    expect(messages.map((message) => message.type)).toEqual(['user', 'assistant'])
  })

  test('Given 历史消息包含 CCB 非法 thinking 正文块 When 读取 Then 恢复为标准 text 块', () => {
    writeAgentSessionJsonl('session-with-malformed-thinking-text', [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'thinking',
            thinking: '',
            signature: '',
            text: '历史正文',
          }],
        },
        parent_tool_use_id: null,
      }),
    ])

    const messages = manager.getAgentSessionSDKMessages(
      'session-with-malformed-thinking-text',
    )

    expect(messages[0]).toMatchObject({
      message: {
        content: [{ type: 'text', text: '历史正文' }],
      },
    })
  })

  test('Given CCB 自动重试原始错误已同步到本地 When 读取 Then 不展示为未知错误', () => {
    writeAgentSessionJsonl('session-with-runtime-retry-error', [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'API Error: 429 The engine is currently overloaded' }],
        },
        error: {
          status: 429,
          error: {
            message: 'The engine is currently overloaded',
            type: 'EngineOverloadedError',
          },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: '重试后执行成功' }],
        },
      }),
    ])

    const messages = manager.getAgentSessionSDKMessages(
      'session-with-runtime-retry-error',
    )

    expect(messages).toHaveLength(1)
    expect(
      (messages[0] as unknown as {
        message: { content: Array<{ text?: string }> }
      }).message.content[0]?.text,
    ).toBe('重试后执行成功')
  })

  test('Given 会话 JSONL 存在损坏行 When 截断 SDKMessage Then 抛错避免重写不完整历史', () => {
    writeAgentSessionJsonl('session-truncate-bad-line', [
      JSON.stringify({ type: 'assistant', uuid: 'assistant-1', message: { content: [{ type: 'text', text: '完成' }] } }),
      '{ 这不是合法 JSON',
    ])

    expect(() => manager.truncateSDKMessages('session-truncate-bad-line', 'assistant-1'))
      .toThrow('JSONL 第 2 行解析失败')
  })
})

describe('Agent 会话元数据', () => {
  test('Given 新建空白任务 When 标记为 draft Then 会话保持临时状态直到首条消息', () => {
    const session = manager.createAgentSession(
      '空白任务',
      undefined,
      'workspace-a',
      undefined,
      true,
    )

    expect(session.draft).toBe(true)
    expect(manager.getAgentSessionMeta(session.id)?.draft).toBe(true)

    const activated = manager.updateAgentSessionMeta(session.id, { draft: false })
    expect(activated.draft).toBe(false)
  })

  test('Given 会话切换审批与计划模式 When 更新元数据 Then 不刷新侧边栏顺序', () => {
    const session = manager.createAgentSession('计划设置')
    const originalUpdatedAt = session.updatedAt

    const updated = manager.updateAgentSessionMeta(session.id, {
      permissionMode: 'default',
      planModeEnabled: true,
    })

    expect(updated).toMatchObject({
      permissionMode: 'default',
      planModeEnabled: true,
      updatedAt: originalUpdatedAt,
    })
  })

  test('Given 历史会话把 plan 存在审批字段 When 读取索引 Then 拆分为请求批准与独立计划模式', () => {
    writeAgentSessionsIndex([
      {
        id: 'legacy-plan-session',
        title: '历史计划会话',
        workspaceId: 'workspace-a',
        permissionMode: 'plan',
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    expect(manager.getAgentSessionMeta('legacy-plan-session')).toMatchObject({
      permissionMode: 'default',
      planModeEnabled: true,
    })
  })

  test('Given a session When star state is updated Then it persists without changing freshness or archive state', () => {
    const session = manager.createAgentSession('星标会话')
    const archived = manager.updateAgentSessionMeta(session.id, { archived: true })

    const updated = manager.updateAgentSessionMeta(session.id, { starred: true })

    expect(updated).toMatchObject({ starred: true, archived: true })
    expect(updated.updatedAt).toBe(archived.updatedAt)
    expect(manager.getAgentSessionMeta(session.id)).toMatchObject({ starred: true, archived: true })
  })

  test('Given 会话按最近活动排序 When 批量切换渠道和模型 Then 保留顺序与归档状态', () => {
    writeAgentSessionsIndex([
      {
        id: 'recent-session',
        title: '最近会话',
        workspaceId: 'workspace-a',
        channelId: 'channel-old',
        modelId: 'model-old',
        archived: true,
        createdAt: 10,
        updatedAt: 200,
      },
      {
        id: 'older-session',
        title: '较早会话',
        workspaceId: 'workspace-a',
        channelId: 'channel-old',
        modelId: 'model-old',
        createdAt: 5,
        updatedAt: 100,
      },
    ])

    const updated = manager.updateAgentSessionMeta('recent-session', {
      channelId: 'channel-new',
      modelId: 'model-new',
    })

    expect(updated).toMatchObject({
      channelId: 'channel-new',
      modelId: 'model-new',
      archived: true,
      updatedAt: 200,
    })
    expect(manager.listAgentSessions().map(session => session.id)).toEqual([
      'recent-session',
      'older-session',
    ])
  })

  test('Given CCB 会话目录 When 同步 UI 投影 Then 导入 Runtime 会话并保留 Proma 桌面字段与排序时间', () => {
    writeAgentSessionsIndex([
      {
        id: 'proma-session',
        runtimeSessionId: 'ccb-session',
        title: 'Proma 本地标题',
        workspaceId: 'workspace-old',
        channelId: 'channel-1',
        modelId: 'model-1',
        pinned: true,
        archived: true,
        starred: true,
        createdAt: 10,
        updatedAt: 20,
      },
      {
        id: 'ccb-imported-session',
        runtimeSessionId: 'ccb-imported-session',
        title: 'CCB 旧标题',
        workspaceId: 'workspace-old',
        createdAt: 5,
        updatedAt: 15,
      },
    ])

    manager.syncRuntimeSessionCatalog('workspace-new', [
      {
        runtimeSessionId: 'ccb-session',
        title: 'CCB 新标题',
        summary: 'CCB 摘要',
        cwd: '/tmp/project',
        createdAt: 1,
        updatedAt: 100,
      },
      {
        runtimeSessionId: 'ccb-imported-session',
        title: 'CCB 更新标题',
        summary: 'CCB 更新摘要',
        cwd: '/tmp/project',
        createdAt: 5,
        updatedAt: 80,
      },
      {
        runtimeSessionId: 'ccb-new-session',
        title: 'CCB 新会话',
        summary: '新会话摘要',
        cwd: '/tmp/project',
        createdAt: 50,
        updatedAt: 60,
      },
    ])

    expect(manager.getAgentSessionMeta('proma-session')).toMatchObject({
      runtimeSessionId: 'ccb-session',
      title: 'Proma 本地标题',
      workspaceId: 'workspace-new',
      channelId: 'channel-1',
      modelId: 'model-1',
      pinned: true,
      archived: true,
      starred: true,
      createdAt: 10,
      updatedAt: 20,
    })
    expect(manager.getAgentSessionMeta('ccb-imported-session')).toMatchObject({
      title: 'CCB 更新标题',
      titleSource: 'runtime',
      workspaceId: 'workspace-new',
      updatedAt: 80,
    })
    expect(manager.listAgentSessions()).toContainEqual(
      expect.objectContaining({
        id: 'ccb-new-session',
        runtimeSessionId: 'ccb-new-session',
        workspaceId: 'workspace-new',
        runtimeWorkerState: 'cold',
      }),
    )
  })

  test('Given CCB 导入会话已手动改名 When 再次同步目录 Then 保留用户标题', () => {
    writeAgentSessionsIndex([
      {
        id: 'ccb-session',
        runtimeSessionId: 'ccb-session',
        title: '用户自定义标题',
        titleSource: 'user',
        workspaceId: 'workspace-a',
        createdAt: 10,
        updatedAt: 20,
      },
    ])

    manager.syncRuntimeSessionCatalog('workspace-a', [{
      runtimeSessionId: 'ccb-session',
      title: 'CCB Transcript 标题',
      summary: 'CCB Transcript 标题',
      cwd: '/tmp/project',
      createdAt: 10,
      updatedAt: 30,
    }])

    expect(manager.getAgentSessionMeta('ccb-session')).toMatchObject({
      title: '用户自定义标题',
      titleSource: 'user',
      updatedAt: 30,
    })
  })

  test('Given Proma 创建的会话已绑定 CCB Runtime When 后台同步 Catalog Then 保持本地侧栏时间顺序', () => {
    writeAgentSessionsIndex([
      {
        id: 'proma-session',
        runtimeSessionId: 'ccb-runtime-session',
        title: 'Proma 本地会话',
        titleSource: 'generated',
        workspaceId: 'workspace-a',
        createdAt: 10,
        updatedAt: 200,
      },
    ])

    manager.syncRuntimeSessionCatalog('workspace-a', [{
      runtimeSessionId: 'ccb-runtime-session',
      title: 'CCB Transcript 标题',
      summary: 'CCB Transcript 标题',
      cwd: '/tmp/project',
      createdAt: 10,
      updatedAt: 50,
    }])

    expect(manager.getAgentSessionMeta('proma-session')).toMatchObject({
      title: 'Proma 本地会话',
      titleSource: 'generated',
      updatedAt: 200,
    })
  })

  test('Given CCB Catalog 暂时为空 When 同步会话目录 Then 不得删除 Proma 本地会话', () => {
    writeAgentSessionsIndex([
      {
        id: 'proma-session',
        runtimeSessionId: 'ccb-session',
        title: '不能消失的会话',
        workspaceId: 'workspace-a',
        createdAt: 10,
        updatedAt: 20,
      },
    ])
    writeAgentSessionJsonl('proma-session', [
      JSON.stringify({
        type: 'user',
        uuid: 'local-user',
        message: { content: [{ type: 'text', text: '本地消息' }] },
        parent_tool_use_id: null,
      }),
    ])

    manager.syncRuntimeSessionCatalog('workspace-a', [])

    expect(manager.getAgentSessionMeta('proma-session')).toBeDefined()
    expect(manager.getAgentSessionSDKMessages('proma-session')).toHaveLength(1)
  })
})

describe('Agent Transcript 增量合并', () => {
  test('Given Runtime Transcript 包含 CCB 非法 thinking 正文块 When 合并 Then 转换为标准 text 块', () => {
    const merged = manager.mergeAgentSessionSDKMessages(
      'merge-malformed-thinking-text',
      [{
        type: 'assistant',
        message: {
          content: [{
            type: 'thinking',
            thinking: '',
            signature: '',
            text: 'Runtime 正文',
          }],
        },
        parent_tool_use_id: null,
        uuid: 'assistant-malformed',
      } as never],
    )

    expect(merged[0]).toMatchObject({
      message: {
        content: [{ type: 'text', text: 'Runtime 正文' }],
      },
    })
  })

  test('Given Runtime Transcript 包含自动重试原始错误 When 最终成功 Then 不合并未知错误卡片', () => {
    writeAgentSessionJsonl('merge-runtime-retry-error', [
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: '执行测试' }] },
        parent_tool_use_id: null,
        _createdAt: 100,
      }),
    ])

    const merged = manager.mergeAgentSessionSDKMessages(
      'merge-runtime-retry-error',
      [
        {
          type: 'user',
          message: { role: 'user', content: '执行测试' },
          parent_tool_use_id: null,
          uuid: 'runtime-user',
        } as never,
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'API Error: 429 The engine is currently overloaded' }],
          },
          error: {
            status: 429,
            error: {
              message: 'The engine is currently overloaded',
              type: 'EngineOverloadedError',
            },
          },
        } as never,
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: '任务执行成功' }],
          },
          parent_tool_use_id: null,
          uuid: 'assistant-success',
        } as never,
      ],
    )

    expect(merged.some(message =>
      Boolean((message as unknown as { error?: unknown }).error),
    )).toBe(false)
    expect(merged.map(message => message.type)).toEqual(['user', 'assistant'])
  })

  test('Given CCB Transcript 尚未落盘 When 返回空 Transcript Then 保留本地用户消息', () => {
    writeAgentSessionJsonl('lagging-transcript', [
      JSON.stringify({
        type: 'user',
        uuid: 'local-user',
        message: { content: [{ type: 'text', text: '刚发送的消息' }] },
        parent_tool_use_id: null,
        _createdAt: 100,
      }),
    ])

    const merged = manager.mergeAgentSessionSDKMessages(
      'lagging-transcript',
      [],
    )

    expect(
      merged.map(message =>
        (message as unknown as { uuid?: string }).uuid,
      ),
    ).toEqual(['local-user'])
    expect(manager.getAgentSessionSDKMessages('lagging-transcript'))
      .toHaveLength(1)
  })

  test('Given Runtime Transcript 比本地投影滞后 When 合并 Then 补齐 Runtime 消息且不覆盖本地尾部消息', () => {
    writeAgentSessionJsonl('merge-transcript', [
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-1',
        message: { content: [{ type: 'text', text: '本地旧内容' }] },
        parent_tool_use_id: null,
        _channelModelId: 'model-a',
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'local-user-2',
        message: { content: [{ type: 'text', text: '尚未落盘的新消息' }] },
        parent_tool_use_id: null,
      }),
    ])

    const merged = manager.mergeAgentSessionSDKMessages(
      'merge-transcript',
      [
        {
          type: 'assistant',
          uuid: 'assistant-1',
          message: { content: [{ type: 'text', text: 'Runtime 完整内容' }] },
          parent_tool_use_id: null,
        } as never,
      ],
    )

    expect(
      merged.map(message =>
        (message as unknown as { uuid?: string }).uuid,
      ),
    ).toEqual(['assistant-1', 'local-user-2'])
    expect(
      (merged[0] as unknown as { _channelModelId?: string })._channelModelId,
    ).toBe('model-a')
    expect(
      (merged[0] as unknown as {
        message: { content: Array<{ text?: string }> }
      }).message.content[0]?.text,
    ).toBe('Runtime 完整内容')
  })

  test('Given Runtime 与 Proma 都保存了同一条用户消息 When 合并 Then 只保留 Proma 本地投影', () => {
    writeAgentSessionJsonl('dedupe-user-transcript', [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: '同一条消息' },
        uuid: 'runtime-user',
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: '同一条消息' }] },
        uuid: 'proma-user',
        _createdAt: 100,
      }),
    ])

    const merged = manager.mergeAgentSessionSDKMessages(
      'dedupe-user-transcript',
      [
        {
          type: 'user',
          message: { role: 'user', content: '同一条消息' },
          uuid: 'runtime-user',
        } as never,
      ],
    )

    expect(merged).toHaveLength(1)
    expect(
      (merged[0] as unknown as { uuid?: string }).uuid,
    ).toBe('proma-user')
  })

  test('Given Runtime 用户消息包含工具引用上下文 When 同步完成 Then 用户原文仍位于对应回复之前', () => {
    writeAgentSessionJsonl('merge-mentioned-tools-prompt', [
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: '<mentioned_tools>\n- Skill: open-computer-use\n</mentioned_tools>\n\n请检查审核结果',
        },
        uuid: 'runtime-user',
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-final',
        message: {
          id: 'assistant-message',
          content: [{ type: 'text', text: '审核结果如下' }],
        },
        _createdAt: 200,
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'text', text: '请检查审核结果' }],
        },
        parent_tool_use_id: null,
        _createdAt: 100,
      }),
      JSON.stringify({
        type: 'result',
        uuid: 'result-1',
        subtype: 'success',
        result: '审核结果如下',
        _createdAt: 200,
      }),
    ])

    const merged = manager.mergeAgentSessionSDKMessages(
      'merge-mentioned-tools-prompt',
      [
        {
          type: 'user',
          message: {
            role: 'user',
            content: '<mentioned_tools>\n- Skill: open-computer-use\n</mentioned_tools>\n\n请检查审核结果',
          },
          uuid: 'runtime-user',
        } as never,
        {
          type: 'assistant',
          uuid: 'assistant-final',
          message: {
            id: 'assistant-message',
            content: [{ type: 'text', text: '审核结果如下' }],
          },
          _createdAt: 200,
        } as never,
      ],
    )

    expect(merged.map(message => message.type))
      .toEqual(['user', 'assistant', 'result'])
    expect(
      (merged[0] as unknown as {
        message: { content: Array<{ text?: string }> }
      }).message.content[0]?.text,
    ).toBe('请检查审核结果')
  })

  test('Given 两轮用户输入内容相同 When 合并增强 Prompt Then 按 Runtime 顺序各保留一次', () => {
    writeAgentSessionJsonl('merge-repeated-user-prompt', [
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: '继续' }] },
        uuid: 'proma-user-1',
        _createdAt: 100,
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-1',
        message: {
          id: 'assistant-message-1',
          content: [{ type: 'text', text: '第一轮' }],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: '继续' }] },
        uuid: 'proma-user-2',
        _createdAt: 200,
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-2',
        message: {
          id: 'assistant-message-2',
          content: [{ type: 'text', text: '第二轮' }],
        },
      }),
    ])

    const merged = manager.mergeAgentSessionSDKMessages(
      'merge-repeated-user-prompt',
      [
        {
          type: 'user',
          uuid: 'runtime-user-1',
          message: {
            role: 'user',
            content: '<mentioned_tools>\n- Skill: example\n</mentioned_tools>\n\n继续',
          },
        } as never,
        {
          type: 'assistant',
          uuid: 'assistant-1',
          message: {
            id: 'assistant-message-1',
            content: [{ type: 'text', text: '第一轮' }],
          },
        } as never,
        {
          type: 'user',
          uuid: 'runtime-user-2',
          message: {
            role: 'user',
            content: '<mentioned_tools>\n- Skill: example\n</mentioned_tools>\n\n继续',
          },
        } as never,
        {
          type: 'assistant',
          uuid: 'assistant-2',
          message: {
            id: 'assistant-message-2',
            content: [{ type: 'text', text: '第二轮' }],
          },
        } as never,
      ],
    )

    expect(
      merged.map(message =>
        (message as unknown as { uuid?: string }).uuid,
      ),
    ).toEqual([
      'proma-user-1',
      'assistant-1',
      'proma-user-2',
      'assistant-2',
    ])
  })

  test('Given 相同文本曾在运行中重复发送 When 后续再次正常发送 Then 不得把旧重复消息匹配到新 Turn', () => {
    writeAgentSessionJsonl('merge-repeated-prompt-with-rejected-send', [
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: '计划审批测试' }] },
        uuid: 'proma-user-1',
        _createdAt: 100,
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: '计划审批测试' }] },
        uuid: 'rejected-duplicate-user',
        _createdAt: 110,
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-1',
        message: {
          id: 'assistant-message-1',
          content: [{ type: 'text', text: '第一次计划被拒绝后的回复' }],
        },
        _createdAt: 200,
      }),
      JSON.stringify({
        type: 'result',
        uuid: 'result-1',
        subtype: 'success',
        _createdAt: 200,
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: '计划审批测试' }] },
        uuid: 'proma-user-2',
        _createdAt: 500,
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-2',
        message: {
          id: 'assistant-message-2',
          content: [{ type: 'text', text: '第二次计划回复' }],
        },
        _createdAt: 600,
      }),
      JSON.stringify({
        type: 'result',
        uuid: 'result-2',
        subtype: 'success',
        _createdAt: 600,
      }),
    ])

    const merged = manager.mergeAgentSessionSDKMessages(
      'merge-repeated-prompt-with-rejected-send',
      [
        {
          type: 'user',
          uuid: 'runtime-user-1',
          timestamp: new Date(120).toISOString(),
          message: { role: 'user', content: '计划审批测试' },
        } as never,
        {
          type: 'assistant',
          uuid: 'runtime-assistant-1',
          message: {
            id: 'assistant-message-1',
            content: [{ type: 'text', text: '第一次计划被拒绝后的回复' }],
          },
        } as never,
        {
          type: 'user',
          uuid: 'runtime-user-2',
          timestamp: new Date(520).toISOString(),
          message: { role: 'user', content: '计划审批测试' },
        } as never,
        {
          type: 'assistant',
          uuid: 'runtime-assistant-2',
          message: {
            id: 'assistant-message-2',
            content: [{ type: 'text', text: '第二次计划回复' }],
          },
        } as never,
      ],
    )

    expect(
      merged.map(message =>
        (message as unknown as { uuid?: string }).uuid,
      ),
    ).toEqual([
      'proma-user-1',
      'rejected-duplicate-user',
      'assistant-1',
      'result-1',
      'proma-user-2',
      'assistant-2',
      'result-2',
    ])
  })

  test('Given 本地完成元数据已被旧同步打乱 When 再次合并 Then 按 Turn 时间恢复消息顺序', () => {
    writeAgentSessionJsonl('merge-out-of-order-results', [
      JSON.stringify({
        type: 'user',
        uuid: 'user-1',
        message: { content: [{ type: 'text', text: '第一轮' }] },
        _createdAt: 100,
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-1',
        message: {
          id: 'assistant-message-1',
          content: [{ type: 'text', text: '第一轮回复' }],
        },
        _createdAt: 200,
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'user-2',
        message: { content: [{ type: 'text', text: '第二轮' }] },
        _createdAt: 300,
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-2',
        message: {
          id: 'assistant-message-2',
          content: [{ type: 'text', text: '第二轮回复' }],
        },
        _createdAt: 400,
      }),
      JSON.stringify({
        type: 'result',
        uuid: 'result-2',
        subtype: 'success',
        _createdAt: 400,
      }),
      JSON.stringify({
        type: 'system',
        subtype: 'context_compaction_config',
        uuid: 'context-config-1',
        _createdAt: 200,
      }),
      JSON.stringify({
        type: 'result',
        uuid: 'result-1',
        subtype: 'success',
        _createdAt: 200,
      }),
    ])

    const merged = manager.mergeAgentSessionSDKMessages(
      'merge-out-of-order-results',
      [
        {
          type: 'user',
          uuid: 'runtime-user-1',
          message: { role: 'user', content: '第一轮' },
        } as never,
        {
          type: 'assistant',
          uuid: 'runtime-assistant-1',
          message: {
            id: 'assistant-message-1',
            content: [{ type: 'text', text: '第一轮回复' }],
          },
        } as never,
        {
          type: 'user',
          uuid: 'runtime-user-2',
          message: { role: 'user', content: '第二轮' },
        } as never,
        {
          type: 'assistant',
          uuid: 'runtime-assistant-2',
          message: {
            id: 'assistant-message-2',
            content: [{ type: 'text', text: '第二轮回复' }],
          },
        } as never,
      ],
    )

    expect(
      merged.map(message =>
        (message as unknown as { uuid?: string }).uuid,
      ),
    ).toEqual([
      'user-1',
      'assistant-1',
      'context-config-1',
      'result-1',
      'user-2',
      'assistant-2',
      'result-2',
    ])
  })

  test('Given Runtime Assistant 与桌面拆分消息使用同一 message id When 合并 Then 只保留桌面拆分消息', () => {
    writeAgentSessionJsonl('dedupe-assistant-transcript', [
      JSON.stringify({
        type: 'assistant',
        uuid: 'runtime-assistant',
        message: {
          id: 'message-1',
          content: [
            { type: 'thinking', thinking: '思考' },
            { type: 'text', text: '回答' },
          ],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'desktop-thinking',
        message: {
          id: 'message-1',
          content: [{ type: 'thinking', thinking: '思考' }],
        },
        _createdAt: 100,
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'desktop-text',
        message: {
          id: 'message-1',
          content: [{ type: 'text', text: '回答' }],
        },
        _createdAt: 100,
      }),
    ])

    const merged = manager.mergeAgentSessionSDKMessages(
      'dedupe-assistant-transcript',
      [
        {
          type: 'assistant',
          uuid: 'runtime-assistant',
          message: {
            id: 'message-1',
            content: [
              { type: 'thinking', thinking: '思考' },
              { type: 'text', text: '回答' },
            ],
          },
        } as never,
      ],
    )

    expect(
      merged.map(message =>
        (message as unknown as { uuid?: string }).uuid,
      ),
    ).toEqual(['desktop-thinking', 'desktop-text'])
  })
})

describe('Agent 会话引用搜索', () => {
  test('Given 工作区有超过 20 个会话 When 请求最近 200 条 Then 按更新时间返回 200 条', () => {
    writeAgentSessionsIndex(createIndexedSessions(220))

    const results = manager.searchAgentSessionReferences({
      workspaceId: 'workspace-a',
      limit: 200,
    })

    expect(results).toHaveLength(200)
    expect(results[0]?.sessionId).toBe('session-219')
    expect(results.at(-1)?.sessionId).toBe('session-20')
    expect(results.every((result) => result.matchSource === 'recent')).toBe(true)
  })

  test('Given 请求数量超过性能上限 When 搜索可引用会话 Then 最多返回 200 条', () => {
    writeAgentSessionsIndex(createIndexedSessions(220))

    const results = manager.searchAgentSessionReferences({
      workspaceId: 'workspace-a',
      limit: 500,
    })

    expect(results).toHaveLength(200)
  })
})

describe('Agent 会话 ID 引用', () => {
  test('Given 用户复制了其他项目的已归档会话 ID When 新会话明确引用 Then 仍注入本地历史读取信息', () => {
    writeAgentSessionsIndex([
      {
        id: 'current-session',
        title: '当前会话',
        workspaceId: 'workspace-a',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'archived-cross-workspace-session',
        title: '其他项目的历史会话',
        workspaceId: 'workspace-b',
        createdAt: 2,
        updatedAt: 2,
        archived: true,
      },
    ])

    const prompt = contextPrompt.buildReferencedSessionsPrompt(
      'current-session',
      ['archived-cross-workspace-session'],
      'workspace-a',
    )

    expect(prompt).toContain('id="archived-cross-workspace-session"')
    expect(prompt).toContain('其他项目的历史会话')
    expect(prompt).toContain('CLI target: archived-cross-workspace-session')
  })
})
