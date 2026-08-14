/**
 * 全局任务看板监听 Hook
 *
 * 在 main.tsx 顶层挂载，订阅主进程推送的任务看板变更事件并刷新本地 atoms。
 * 永不随组件卸载销毁，确保切换到其他视图时数据保持同步。
 */

import React from 'react'
import { useSetAtom } from 'jotai'
import { taskboardProjectsAtom, taskboardTasksAtom } from '@/atoms/taskboard-atoms'

export function useGlobalTaskboardListeners(): void {
  const setProjects = useSetAtom(taskboardProjectsAtom)
  const setTasks = useSetAtom(taskboardTasksAtom)

  React.useEffect(() => {
    const load = (): void => {
      void Promise.all([
        window.electronAPI.listTaskboardProjects(),
        window.electronAPI.listTaskboardTasks(),
      ]).then(([projects, tasks]) => {
        setProjects(projects)
        setTasks(tasks)
      }).catch(console.error)
    }
    load()
    const unsub = window.electronAPI.onTaskboardChanged(load)
    return unsub
  }, [setProjects, setTasks])
}
