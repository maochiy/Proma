import { describe, expect, test } from 'bun:test'
import {
  isPlanExecutionTool,
  isPlanModeBashReadOnly,
  shouldFinalizePlanExecution,
} from './agent-plan-execution'

describe('Agent 计划执行阶段判定', () => {
  test('Given 计划已生成 When Agent 从读取和检索开始执行 Then 识别为执行计划', () => {
    for (const toolName of [
      'Read',
      'read',
      'Glob',
      'grep',
      'find',
      'ls',
      'Bash',
      'bash',
      'Agent',
      'Skill',
      'mcp__web_search__WebSearch',
    ]) {
      expect(isPlanExecutionTool(toolName)).toBe(true)
    }
  })

  test('Given 已生成计划 When Agent 开始修改代码 Then 识别为执行计划', () => {
    for (const toolName of ['Edit', 'edit', 'NotebookEdit', 'Bash']) {
      expect(isPlanExecutionTool(toolName)).toBe(true)
    }
  })

  test('Given 计划已生成 When Agent 写入任意文件 Then 识别为执行计划', () => {
    expect(isPlanExecutionTool('Write')).toBe(true)
    expect(isPlanExecutionTool('write')).toBe(true)
  })

  test('Given 计划已生成 When 调用浏览器或普通 MCP 工具 Then 识别为执行计划', () => {
    expect(isPlanExecutionTool('mcp__chrome_devtools__take_snapshot')).toBe(true)
    expect(isPlanExecutionTool('mcp__chrome_devtools__click')).toBe(true)
    expect(isPlanExecutionTool('mcp__filesystem__write_file')).toBe(true)
  })

  test('Given 计划已生成 When 仅切换计划阶段或等待用户 Then 不误判为执行', () => {
    expect(isPlanExecutionTool('AskUserQuestion')).toBe(false)
    expect(isPlanExecutionTool('EnterPlanMode')).toBe(false)
    expect(isPlanExecutionTool('ExitPlanMode')).toBe(false)
  })

  test('Given 计划已生成 When 仅维护任务元数据 Then 暂不退出计划模式', () => {
    expect(isPlanExecutionTool('TodoWrite')).toBe(false)
    expect(isPlanExecutionTool('TaskCreate')).toBe(false)
    expect(isPlanExecutionTool('TaskUpdate')).toBe(false)
  })

  test('Given 仍在计划模式 When 判断原有 Bash 权限 Then 保持兼容的只读规则', () => {
    expect(isPlanModeBashReadOnly('rg -n "plan" src')).toBe(true)
    expect(isPlanModeBashReadOnly('mkdir -p dist')).toBe(false)
  })

  test('Given 计划已生成并仍在计划模式 When 实施工具真正获批或启动 Then 应正式退出', () => {
    expect(shouldFinalizePlanExecution({
      planModeEntered: true,
      planReady: true,
      toolName: 'Edit',
    })).toBe(true)
  })

  test('Given 计划尚未生成或仅等待用户交互 When 判断是否退出 Then 保持计划模式', () => {
    expect(shouldFinalizePlanExecution({
      planModeEntered: true,
      planReady: false,
      toolName: 'Edit',
    })).toBe(false)
    expect(shouldFinalizePlanExecution({
      planModeEntered: true,
      planReady: true,
      toolName: 'AskUserQuestion',
    })).toBe(false)
  })

  test('Given 计划已生成并仍在计划模式 When 首个工具是只读检查 Then 应正式退出', () => {
    expect(shouldFinalizePlanExecution({
      planModeEntered: true,
      planReady: true,
      toolName: 'ls',
    })).toBe(true)
    expect(shouldFinalizePlanExecution({
      planModeEntered: true,
      planReady: true,
      toolName: 'Bash',
    })).toBe(true)
  })
})
