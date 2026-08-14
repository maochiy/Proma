import { describe, expect, test, beforeEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskboardStore, TaskboardError } from './taskboard-store'
import type { Task, TaskStatus } from '@proma/shared'

/** 每个用例使用独立临时目录，避免污染真实配置 */
function createStore(): TaskboardStore {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-test-'))
  return new TaskboardStore(dir)
}

describe('任务看板存储服务', () => {
  let store: TaskboardStore

  beforeEach(() => {
    store = createStore()
  })

  test('Given 首次访问 When 列出项目 Then 返回默认全局项目', () => {
    const projects = store.listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]!.id).toBe('local')
    expect(projects[0]!.name).toBe('全局')
    expect(projects[0]!.issueCount).toBe(0)
  })

  test('Given 创建任务 When 分配标识符 Then 按项目前缀续号', () => {
    const a = store.createTask({ id: 't1', projectId: 'local', title: '任务一' })
    const b = store.createTask({ id: 't2', projectId: 'local', title: '任务二' })
    expect(a.identifier).toBe('LOCAL-1')
    expect(b.identifier).toBe('LOCAL-2')
  })

  test('Given 新建任务 When 省略 sortOrder Then 插入到该状态列顶部（min-1000）', () => {
    const first = store.createTask({ id: 't1', projectId: 'local', title: 'A', status: 'todo' })
    const second = store.createTask({ id: 't2', projectId: 'local', title: 'B', status: 'todo' })
    expect(second.sortOrder).toBeLessThan(first.sortOrder)
  })

  test('Given 任务版本冲突 When 更新 Then 抛 VERSION_CONFLICT', () => {
    const task = store.createTask({ id: 't1', projectId: 'local', title: 'A' })
    expect(() =>
      store.updateTask({ id: 't1', version: task.version + 99, title: 'B' }),
    ).toThrowError(TaskboardError)
    try {
      store.updateTask({ id: 't1', version: task.version + 99, title: 'B' })
    } catch (error) {
      const e = error as TaskboardError
      expect(e.code).toBe('VERSION_CONFLICT')
    }
  })

  test('Given 跨列移动任务 When 不指定 sortOrder Then 插入到新列顶部', () => {
    const c = store.createTask({ id: 't3', projectId: 'local', title: 'C', status: 'in_progress' })
    const a = store.createTask({ id: 't1', projectId: 'local', title: 'A', status: 'todo' })
    const moved = store.moveTask({ id: 't1', version: a.version, status: 'in_progress' })
    expect(moved.status).toBe('in_progress')
    expect(moved.sortOrder).toBeLessThan(c.sortOrder)
  })

  test('Given 同列移动任务 When 不指定 sortOrder Then 追加到列尾（max+1000）', () => {
    const a = store.createTask({ id: 't1', projectId: 'local', title: 'A', status: 'todo' })
    const b = store.createTask({ id: 't2', projectId: 'local', title: 'B', status: 'todo' })
    const moved = store.moveTask({ id: 't1', version: a.version, status: 'todo' })
    expect(moved.sortOrder).toBeGreaterThan(b.sortOrder)
  })

  test('Given 重复任务 When 未设置截止日期 Then 抛 INVALID_FIELD', () => {
    expect(() =>
      store.createTask({
        id: 't-recur', projectId: 'local', title: 'A',
        recurrence: { interval: 1, unit: 'week' },
      }),
    ).toThrowError(TaskboardError)
  })

  test('Given 重复任务 When 设置了截止日期 Then 创建成功', () => {
    const task = store.createTask({
      id: 't1', projectId: 'local', title: 'A',
      dueDate: '2026-08-11',
      recurrence: { interval: 1, unit: 'week' },
    })
    expect(task.recurrence).toEqual({ interval: 1, unit: 'week' })
  })

  test('Given 归档任务 When 恢复 When 删除 Then 生命周期正确', () => {
    const task = store.createTask({ id: 't1', projectId: 'local', title: 'A' })
    const archived = store.archiveTask({ id: 't1', version: task.version })
    expect(archived.archivedAt).not.toBeNull()
    const restored = store.restoreTask({ id: 't1', version: archived.version })
    expect(restored.archivedAt).toBeNull()
  })

  test('Given 未归档任务 When 删除 Then 抛 TASK_NOT_ARCHIVED', () => {
    store.createTask({ id: 't1', projectId: 'local', title: 'A' })
    expect(() => store.deleteArchivedTask('t1', 1)).toThrowError(TaskboardError)
  })

  test('Given 已归档任务 When 删除 Then 任务与评论被移除', () => {
    const task = store.createTask({ id: 't1', projectId: 'local', title: 'A' })
    const archived = store.archiveTask({ id: 't1', version: task.version })
    store.createComment({ taskId: 't1', body: '评论' })
    const result = store.deleteArchivedTask('t1', archived.version)
    expect(result.task.id).toBe('t1')
    expect(store.getTask('t1')).toBeNull()
    expect(() => store.listComments('t1')).toThrowError(TaskboardError)
  })

  test('Given 父任务 When 添加子任务 When 形成环路 Then 抛 RELATION_CYCLE', () => {
    const a = store.createTask({ id: 't1', projectId: 'local', title: 'A' })
    const b = store.createTask({ id: 't2', projectId: 'local', title: 'B' })
    // A 是 B 的父
    store.addRelation({ id: 't2', version: b.version, type: 'parent', relatedTaskId: 't1' })
    // 尝试让 B 成为 A 的父 → 环路
    expect(() =>
      store.addRelation({ id: 't1', version: a.version, type: 'parent', relatedTaskId: 't2' }),
    ).toThrowError(TaskboardError)
  })

  test('Given 任务与自身 When 建立关系 Then 抛 SELF_RELATION', () => {
    const a = store.createTask({ id: 't1', projectId: 'local', title: 'A' })
    expect(() =>
      store.addRelation({ id: 't1', version: a.version, type: 'related', relatedTaskId: 't1' }),
    ).toThrowError(TaskboardError)
  })

  test('Given 跨项目任务 When 建立关系 Then 抛 CROSS_PROJECT_RELATION', () => {
    const a = store.createTask({ id: 't1', projectId: 'local', title: 'A' })
    store.createProject({ id: 'temp-p1', name: '项目甲' })
    const b = store.createTask({ id: 't2', projectId: 'temp-p1', title: 'B' })
    expect(() =>
      store.addRelation({ id: 't1', version: a.version, type: 'related', relatedTaskId: 't2' }),
    ).toThrowError(TaskboardError)
  })

  test('Given 添加关系 When 读取任务 Then 关系集合正确', () => {
    const a = store.createTask({ id: 't1', projectId: 'local', title: 'A' })
    const b = store.createTask({ id: 't2', projectId: 'local', title: 'B' })
    store.addRelation({ id: 't1', version: a.version, type: 'blocks', relatedTaskId: 't2' })
    const aRel = store.getTask('t1')!
    const bRel = store.getTask('t2')!
    expect(aRel.relations.blocks).toHaveLength(1)
    expect(aRel.relations.blocks[0]!.id).toBe('t2')
    expect(bRel.relations.blockedBy).toHaveLength(1)
    expect(bRel.relations.blockedBy[0]!.id).toBe('t1')
  })

  test('Given 状态变更 When 记录活动 Then activityKey 变化且包含变更', () => {
    const task = store.createTask({ id: 't1', projectId: 'local', title: 'A', status: 'todo' })
    const before = store.getTask('t1')!.activityKey
    const updated = store.updateTask({ id: 't1', version: task.version, status: 'in_progress' })
    const after = store.getTask('t1')!.activityKey
    expect(after).not.toBe(before)
    const activities = store.listTaskActivities('t1')
    expect(activities.some((a) => a.changes.some((c) => c.field === 'status'))).toBe(true)
    expect(updated.status).toBe('in_progress')
  })

  test('Given 新建项目 When 删除 When 项目含任务 Then 抛 PROJECT_NOT_EMPTY', () => {
    store.createProject({ id: 'temp-p1', name: '项目甲' })
    store.createTask({ id: 't1', projectId: 'temp-p1', title: 'A' })
    expect(() => store.deleteProject('temp-p1')).toThrowError(TaskboardError)
    // 删除空项目成功
    store.createProject({ id: 'temp-p2', name: '空项目' })
    expect(store.deleteProject('temp-p2').id).toBe('temp-p2')
  })

  test('Given 非 temp- 项目 When 删除 Then 抛 PROJECT_DELETE_FORBIDDEN', () => {
    expect(() => store.deleteProject('local')).toThrowError(TaskboardError)
  })

  test('Given 附件 When 写入并读取 Then 内容一致', () => {
    store.createTask({ id: 't1', projectId: 'local', title: 'A' })
    const att = store.createAttachment('t1', null, 'img.png', 'image/png', Buffer.from('hello').toString('base64'))
    const result = store.readAttachmentContent(att.id)
    expect(result.dataBase64).toBe(Buffer.from('hello').toString('base64'))
    expect(result.metadata.filename).toBe('img.png')
  })
})
