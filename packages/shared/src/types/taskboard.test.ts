import { describe, expect, test } from 'bun:test'
import {
  TASKBOARD_IPC_CHANNELS,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASKBOARD_DEFAULT_PROJECT_ID,
  TASKBOARD_LOCAL_USER,
} from './taskboard'

describe('任务看板共享类型与通道常量', () => {
  test('Given 状态/优先级常量 When 引用 Then 值域完整', () => {
    expect(TASK_STATUSES).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled'])
    expect(TASK_PRIORITIES).toEqual(['none', 'urgent', 'high', 'medium', 'low'])
  })

  test('Given 默认项目/用户 When 引用 Then 语义正确', () => {
    expect(TASKBOARD_DEFAULT_PROJECT_ID).toBe('local')
    expect(TASKBOARD_LOCAL_USER.id).toBe('local-user')
    expect(TASKBOARD_LOCAL_USER.type).toBe('user')
  })

  test('Given IPC 通道常量 When 引用 Then 通道名唯一且带前缀', () => {
    const values = Object.values(TASKBOARD_IPC_CHANNELS)
    expect(new Set(values).size).toBe(values.length)
    expect(TASKBOARD_IPC_CHANNELS.LIST_PROJECTS).toBe('taskboard:list-projects')
    expect(TASKBOARD_IPC_CHANNELS.CHANGED).toBe('taskboard:changed')
  })
})
