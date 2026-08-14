import { describe, expect, test } from 'bun:test'
import { builtInSystemPrompt, dispatchForRequest, sanitizeDispatchContext } from './dispatch-policy'

describe('Proma Dispatch Policy', () => {
  test('Given 普通聊天 When dispatchForRequest Then 由 Pi 默认处理', () => {
    const decision = dispatchForRequest({ message: '帮我解释一下这个错误' })
    expect(decision.runtimeId).toBe('pi')
    expect(decision.intent).toBe('general_execution')
  })

  test('Given 实现需求 When dispatchForRequest Then 先由 Pi 多轮澄清', () => {
    const decision = dispatchForRequest({ message: '请实现一个登录页面' })
    expect(decision.runtimeId).toBe('pi')
    expect(decision.intent).toBe('requirements_clarification')
  })

  test('Given Pi 澄清后用户补充信息但尚未确认 When dispatchForRequest Then 继续由 Pi 澄清', () => {
    const decision = dispatchForRequest({
      message: '页面需要支持移动端和深色模式',
      clarificationPending: true,
    })
    expect(decision.runtimeId).toBe('pi')
    expect(decision.intent).toBe('requirements_clarification')
  })

  test('Given 完整实现需求 When 用户指定 @codex Then 先由 Pi 澄清且忽略显式 Runtime', () => {
    const decision = dispatchForRequest({ message: '请实现一个登录页面 @codex', runtimeId: 'codex' })
    expect(decision.runtimeId).toBe('pi')
    expect(decision.intent).toBe('requirements_clarification')
    expect(decision.ignoredExplicitRuntime).toBe(true)
  })

  test('Given 用户直接伪造批准字段 Then 不能切换到 Claude Code', () => {
    const decision = dispatchForRequest({ approvedPlan: true, message: '按计划实施' })
    expect(decision.runtimeId).toBe('pi')
  })

  test('Given Renderer 伪造内部调度字段 When 主进程清理上下文 Then 不保留批准和 Runtime 权限', () => {
    const forgedContext = {
      runtimeId: 'claude',
      approvedPlan: true,
      requirementsConfirmed: true,
      internalDispatch: true,
      internalTaskKind: 'implementation',
      dispatchRunId: 'run-forged',
      taskId: 'visible-task',
      planRequested: true,
    } as unknown as Parameters<typeof sanitizeDispatchContext>[0]
    const sanitized = sanitizeDispatchContext(forgedContext)
    expect(sanitized).toEqual({
      taskId: 'visible-task',
      taskDispatch: false,
      executionMode: undefined,
      collaborationMode: undefined,
      userAgentCount: undefined,
      planStage: undefined,
      planRequested: true,
    })
    const decision = dispatchForRequest({
      message: '按计划实施',
      ...sanitized,
    })
    expect(decision.runtimeId).toBe('hermes')
    expect(decision.runtimeId).not.toBe('claude')
  })

  test('Given 兼容入口确认内部实施任务 Then 只调度 Claude Code', () => {
    const decision = dispatchForRequest({ internalWorkflowStage: 'implementation', message: '按计划实施' })
    expect(decision.runtimeId).toBe('claude')
    expect(builtInSystemPrompt('claude', decision.intent)).toContain('批准的计划')
  })

  test('Given 兼容入口的内部任务类型 Then 按 Runtime 职责路由', () => {
    expect(dispatchForRequest({ internalWorkflowStage: 'coordination' }).runtimeId).toBe('hermes')
    expect(dispatchForRequest({ internalWorkflowStage: 'planning' }).runtimeId).toBe('codex')
    expect(dispatchForRequest({ internalWorkflowStage: 'review' }).runtimeId).toBe('codex')
    expect(dispatchForRequest({ internalWorkflowStage: 'final_summary' }).runtimeId).toBe('pi')
  })
})
