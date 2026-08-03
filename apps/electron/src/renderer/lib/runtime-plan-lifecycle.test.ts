import { describe, expect, test } from 'bun:test'
import type {
  AgentRuntimePlanSessionState,
  AgentRuntimeTodoItem,
} from '@proma/shared'
import {
  activateRuntimePlanTodo,
  applyRuntimePlanGraph,
  beginRuntimePlanTurn,
  getExplicitRuntimePlanActivationTodoId,
  getVisibleRuntimePlanTodos,
  interruptRuntimePlan,
  pruneExpiredRuntimePlans,
} from './runtime-plan-lifecycle'

const TODOS: AgentRuntimeTodoItem[] = [
  { id: '1', content: '完成实现', status: 'completed' },
  { id: '2', content: '真机验证', status: 'in_progress' },
]

describe('运行时计划生命周期', () => {
  test('Given TaskUpdate 只修改负责人或描述 When 判断是否续做 Then 不恢复旧计划', () => {
    expect(getExplicitRuntimePlanActivationTodoId({
      taskId: '2',
      owner: 'reviewer',
    })).toBeUndefined()
    expect(getExplicitRuntimePlanActivationTodoId({
      taskId: '2',
      status: 'pending',
    })).toBeUndefined()
    expect(getExplicitRuntimePlanActivationTodoId({
      taskId: '2',
      status: 'in_progress',
    })).toBe('2')
  })

  test('Given 上一轮计划被中断 When 新一轮开始且模型未明确续做 Then 当前计划隐藏但数据保留', () => {
    const created = applyRuntimePlanGraph(
      { archived: [], turnEpoch: 100 },
      TODOS,
      100,
    )!
    const interrupted = interruptRuntimePlan(created, 200)!
    expect(interrupted.current?.visible).toBe(true)
    expect(interrupted.current?.status).toBe('interrupted')

    const nextTurn = beginRuntimePlanTurn(interrupted, 300, 300)
    expect(nextTurn.current?.visible).toBe(false)
    expect(nextTurn.current?.status).toBe('interrupted')
    expect(nextTurn.current?.todos).toEqual(TODOS)
    expect(getVisibleRuntimePlanTodos(nextTurn, TODOS)).toEqual([])
  })

  test('Given 旧计划已在下一轮隐藏 When 模型明确 TaskUpdate 同一任务 Then 恢复显示继续执行', () => {
    const hidden = beginRuntimePlanTurn(
      interruptRuntimePlan(
        applyRuntimePlanGraph(
          { archived: [], turnEpoch: 100 },
          TODOS,
          100,
        ),
        200,
      ),
      300,
      300,
    )

    const resumed = activateRuntimePlanTodo(hidden, '2', 400)!
    expect(resumed.current?.visible).toBe(true)
    expect(resumed.current?.status).toBe('active')
    expect(resumed.current?.lastActivatedTurnEpoch).toBe(300)
  })

  test('Given 隐藏计划原任务已是 in_progress When 执行图只更新负责人 Then 不误恢复', () => {
    const hidden = beginRuntimePlanTurn(
      interruptRuntimePlan(
        applyRuntimePlanGraph(
          { archived: [], turnEpoch: 100 },
          TODOS,
          100,
        ),
        200,
      ),
      300,
      300,
    )
    const ownerUpdated = applyRuntimePlanGraph(
      hidden,
      TODOS.map((todo) => (
        todo.id === '2' ? { ...todo, owner: 'reviewer' } : todo
      )),
      400,
    )!

    expect(ownerUpdated.current?.visible).toBe(false)
    expect(ownerUpdated.current?.status).toBe('interrupted')
  })

  test('Given 旧计划处于待继续 When 本轮创建新计划 Then 旧计划归档且新计划成为当前计划', () => {
    const oldPlan = beginRuntimePlanTurn(
      interruptRuntimePlan(
        applyRuntimePlanGraph(
          { archived: [], turnEpoch: 100 },
          TODOS,
          100,
        ),
        200,
      ),
      300,
      300,
    )
    const newTodos: AgentRuntimeTodoItem[] = [
      { id: '10', content: '处理新需求', status: 'in_progress' },
    ]

    const replaced = applyRuntimePlanGraph(oldPlan, newTodos, 400)!
    expect(replaced.current?.todos).toEqual(newTodos)
    expect(replaced.current?.visible).toBe(true)
    expect(replaced.current?.status).toBe('active')
    expect(replaced.archived).toHaveLength(1)
    expect(replaced.archived[0]?.status).toBe('archived')
    // 归档不能因为新一轮或新计划反复延长原有过期时间。
    expect(replaced.archived[0]?.expiresAt).toBe(
      oldPlan.current?.expiresAt,
    )
  })

  test('Given 模型在同一轮逐步创建多条任务 When 计划身份扩展 Then 不产生中间归档快照', () => {
    const first = applyRuntimePlanGraph(
      { archived: [], turnEpoch: 300 },
      [{ id: '1', content: '第一步', status: 'in_progress' }],
      310,
    )!
    const second = applyRuntimePlanGraph(
      first,
      [
        { id: '1', content: '第一步', status: 'in_progress' },
        { id: '2', content: '第二步', status: 'pending' },
      ],
      320,
    )!

    expect(second.archived).toEqual([])
    expect(second.current?.todos).toHaveLength(2)
  })

  test('Given 本轮已有活动计划 When 模型用全新任务替换 Then 旧计划归档', () => {
    const oldPlan = applyRuntimePlanGraph(
      { archived: [], turnEpoch: 300 },
      [{ id: '1', content: '旧计划', status: 'in_progress' }],
      310,
    )!
    const replaced = applyRuntimePlanGraph(
      oldPlan,
      [{ id: '10', content: '新计划', status: 'in_progress' }],
      320,
    )!

    expect(replaced.archived).toHaveLength(1)
    expect(replaced.archived[0]?.todos[0]?.content).toBe('旧计划')
    expect(replaced.current?.todos[0]?.content).toBe('新计划')
  })

  test('Given 上一轮完成计划已归档 When 旧执行图延迟重放 Then 不重新创建当前计划', () => {
    const completedTodos = TODOS.map((todo) => ({
      ...todo,
      status: 'completed',
    }))
    const active = applyRuntimePlanGraph(
      { archived: [], turnEpoch: 100 },
      TODOS,
      105,
    )!
    const completed = applyRuntimePlanGraph(
      active,
      completedTodos,
      110,
    )!
    const nextTurn = beginRuntimePlanTurn(completed, 200, 200)

    const replayed = applyRuntimePlanGraph(nextTurn, completedTodos, 210)!

    expect(replayed.current).toBeUndefined()
    expect(replayed.archived).toHaveLength(1)
    expect(replayed.archived[0]?.status).toBe('completed')
  })

  test('Given 旧计划在本轮未明确续做 When 本轮结束 Then 仍保持隐藏而不显示待继续', () => {
    const previousTurn = interruptRuntimePlan(
      applyRuntimePlanGraph(
        { archived: [], turnEpoch: 100 },
        TODOS,
        100,
      ),
      150,
    )!
    const hidden = beginRuntimePlanTurn(previousTurn, 200, 200)

    const completedTurn = interruptRuntimePlan(hidden, 250)!

    expect(completedTurn.current?.status).toBe('interrupted')
    expect(completedTurn.current?.visible).toBe(false)
    expect(completedTurn.current?.lastActivatedTurnEpoch).toBe(100)
  })

  test('Given 持久化数据误将未续做旧计划标为可见 When 加载清理 Then 自动恢复隐藏', () => {
    const state: AgentRuntimePlanSessionState = {
      current: {
        id: 'old-plan',
        todos: TODOS,
        status: 'interrupted',
        visible: true,
        createdAt: 1,
        updatedAt: 2,
        lastActivatedTurnEpoch: 100,
        interruptedAt: 2,
        expiresAt: 3_000,
      },
      archived: [],
      turnEpoch: 200,
    }

    const pruned = pruneExpiredRuntimePlans(
      new Map([['session', state]]),
      10,
    )

    expect(pruned.get('session')?.current?.visible).toBe(false)
  })

  test('Given 归档计划已经超过保留期限 When 清理历史 Then 删除过期记录', () => {
    const state: AgentRuntimePlanSessionState = {
      archived: [{
        id: 'expired',
        todos: TODOS,
        status: 'archived',
        visible: false,
        createdAt: 1,
        updatedAt: 1,
        archivedAt: 1,
        expiresAt: 10,
      }],
      turnEpoch: 100,
    }
    const pruned = pruneExpiredRuntimePlans(
      new Map([['session', state]]),
      11,
    )

    expect(pruned.has('session')).toBe(false)
  })
})
