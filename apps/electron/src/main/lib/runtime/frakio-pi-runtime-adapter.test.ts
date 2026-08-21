import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compactionSystemMessage, contextCompactionConfigMessage, piWorkerSessionIdentity, resolvePiWorkerRuntimeBinding, usageSystemMessage } from './frakio-pi-runtime-adapter'

describe('Proma Pi 压缩事件转换', () => {
  test('Given Pi 开始压缩 When 收到 compaction.started Then 转换为 compacting system 消息', () => {
    const message = compactionSystemMessage('session-1', 'context.compaction.started', {
      trigger: 'threshold',
      tokensBefore: 168_000,
    })
    expect(message).toMatchObject({
      type: 'system',
      subtype: 'compacting',
      session_id: 'session-1',
      compactTrigger: 'auto',
      compactPreTokens: 168_000,
    })
  })

  test('Given Pi 手动压缩开始 When 收到 compaction.started Then trigger 为 manual', () => {
    const message = compactionSystemMessage('session-1', 'context.compaction.started', {
      trigger: 'manual',
    })
    expect(message).toMatchObject({
      subtype: 'compacting',
      compactTrigger: 'manual',
    })
  })

  test('Given Pi 压缩成功 When 收到 compaction.completed Then 转换为 compact_boundary 并携带元数据', () => {
    const message = compactionSystemMessage('session-1', 'context.compaction.completed', {
      trigger: 'threshold',
      tokensBefore: 168_000,
      tokensAfterEstimate: 24_000,
    })
    expect(message).toMatchObject({
      type: 'system',
      subtype: 'compact_boundary',
      compactTrigger: 'auto',
      compactPreTokens: 168_000,
      compactionEstimatedTokensAfter: 24_000,
      compact_metadata: {
        trigger: 'auto',
        pre_tokens: 168_000,
        post_tokens: 24_000,
      },
    })
  })

  test('Given Pi 压缩失败 When 收到 compaction.failed Then 转换为 status 并保留错误详情', () => {
    const message = compactionSystemMessage('session-1', 'context.compaction.failed', {
      trigger: 'manual',
      error: '模型调用超时',
    })
    expect(message).toMatchObject({
      type: 'system',
      subtype: 'status',
      compact_result: 'failed',
      compact_error: '模型调用超时',
    })
  })

  test('Given Pi 压缩失败且无错误信息 When 转换 Then 使用兜底文案', () => {
    const message = compactionSystemMessage('session-1', 'context.compaction.failed', {})
    expect(message).toMatchObject({
      compact_result: 'failed',
      compact_error: '上下文压缩失败',
    })
  })
})

describe('Proma Pi usage 事件转换', () => {
  test('Given Pi 上报 usage 与上下文窗口 When 转换 Then 透传 context_window', () => {
    const message = usageSystemMessage('session-1', {
      inputTokens: 12_000,
      outputTokens: 3_000,
      contextWindow: 200_000,
    })
    expect(message).toMatchObject({
      type: 'assistant',
      session_id: 'session-1',
      message: {
        content: [],
        usage: {
          input_tokens: 12_000,
          output_tokens: 3_000,
          context_window: 200_000,
        },
      },
    })
  })

  test('Given Pi 上报无上下文窗口 When 转换 Then usage 不含 context_window', () => {
    const message = usageSystemMessage('session-1', {
      inputTokens: 100,
      outputTokens: 50,
    })
    const usage = (message as { message: { usage: Record<string, unknown> } }).message.usage
    expect(usage.input_tokens).toBe(100)
    expect(usage.output_tokens).toBe(50)
    expect(usage.context_window).toBeUndefined()
  })

  test('Given Pi 上报缓存字段 When 转换 Then 透传 cache_read/cache_creation', () => {
    const message = usageSystemMessage('session-1', {
      inputTokens: 12_000,
      outputTokens: 3_000,
      cacheReadTokens: 88_000,
      cacheWriteTokens: 2_000,
      contextWindow: 200_000,
    })
    expect(message).toMatchObject({
      type: 'assistant',
      session_id: 'session-1',
      message: {
        content: [],
        usage: {
          input_tokens: 12_000,
          output_tokens: 3_000,
          cache_read_input_tokens: 88_000,
          cache_creation_input_tokens: 2_000,
          context_window: 200_000,
        },
      },
    })
  })
})

describe('Proma Pi context_compaction_config 消息', () => {
  test('Given 压缩策略齐全 When 转换 Then 生成可持久化的 config system 消息', () => {
    const message = contextCompactionConfigMessage({
      enabled: true,
      threshold: 160_000,
      contextWindow: 200_000,
    }, 'session-1')
    expect(message).toMatchObject({
      type: 'system',
      subtype: 'context_compaction_config',
      session_id: 'session-1',
      autoCompactEnabled: true,
      autoCompactThreshold: 160_000,
      effectiveContextWindow: 200_000,
    })
  })

  test('Given 压缩未启用 When 转换 Then 返回 undefined', () => {
    expect(contextCompactionConfigMessage({
      enabled: false,
      threshold: 160_000,
      contextWindow: 200_000,
    }, 'session-1')).toBeUndefined()
  })

  test('Given 缺少阈值或窗口 When 转换 Then 返回 undefined', () => {
    expect(contextCompactionConfigMessage({ enabled: true, threshold: 160_000 }, 'session-1')).toBeUndefined()
    expect(contextCompactionConfigMessage({ enabled: true, contextWindow: 200_000 }, 'session-1')).toBeUndefined()
  })
})

describe('Proma Pi Worker 身份', () => {
  test('Given Context Packet 带有用户名 When 构建 Worker 身份 Then 模型可见名称固定为 Proma', () => {
    const identity = piWorkerSessionIdentity({
      contextPacket: { packetId: 'context-1' },
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: '你运行在 Proma 桌面应用中。',
      },
    })
    expect(identity.profileSnapshot).toMatchObject({
      name: 'Proma',
      role: 'Proma Pi 基础内核',
      revision: 'context-1',
    })
    expect(identity.profileSnapshot.name).not.toBe('wanglang')
    expect(identity.hostSystemPrompt).toContain('你运行在 Proma 桌面应用中。')
  })

  test('Given 没有 Context Packet When 构建 Worker 身份 Then 仍使用 Proma 作为默认身份', () => {
    const identity = piWorkerSessionIdentity({
      systemPrompt: 'Proma host prompt',
    })
    expect(identity.profileSnapshot.name).toBe('Proma')
    expect(identity.profileSnapshot.revision).toBe('proma')
    expect(identity.hostSystemPrompt).toBe('Proma host prompt')
  })
})


describe('Proma Pi Worker Runtime Binding', () => {
  test('Given PATH/active 声称 0.82.0 When 解析 Worker Binding Then expected 仍来自即将加载的内置 package.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-pi-binding-'))
    const packageDir = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: '@earendil-works/pi-coding-agent',
      version: '0.80.9',
    }))
    const previousRoot = process.env.PROMA_PI_DEPENDENCY_ROOT
    const previousFrakio = process.env.FRAKIO_PI_RUNTIME_VERSION
    const previousProma = process.env.PROMA_PI_RUNTIME_VERSION
    process.env.PROMA_PI_DEPENDENCY_ROOT = root
    process.env.FRAKIO_PI_RUNTIME_VERSION = '0.82.0'
    process.env.PROMA_PI_RUNTIME_VERSION = '0.82.0'
    try {
      const binding = resolvePiWorkerRuntimeBinding()
      expect(binding.runtimeDir).toBe(root)
      expect(binding.runtimeVersion).toBe('0.80.9')
      expect(binding.runtimeBuildId).toBe('pi-bundled-0.80.9')
    } finally {
      if (previousRoot === undefined) delete process.env.PROMA_PI_DEPENDENCY_ROOT
      else process.env.PROMA_PI_DEPENDENCY_ROOT = previousRoot
      if (previousFrakio === undefined) delete process.env.FRAKIO_PI_RUNTIME_VERSION
      else process.env.FRAKIO_PI_RUNTIME_VERSION = previousFrakio
      if (previousProma === undefined) delete process.env.PROMA_PI_RUNTIME_VERSION
      else process.env.PROMA_PI_RUNTIME_VERSION = previousProma
      rmSync(root, { recursive: true, force: true })
    }
  })
})
