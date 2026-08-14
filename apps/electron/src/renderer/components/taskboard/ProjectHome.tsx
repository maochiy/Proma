/**
 * ProjectHome — 任务看板项目选择首页
 *
 * 复刻 dashi 任务面板的「项目首页」视觉与交互：
 * - 顶部标题「选择项目」
 * - 按「已有议题 / 尚未添加议题」分组展示项目卡片
 * - 卡片显示首字母头像、项目名、类型与议题数、打开按钮
 * - 空状态：还没有项目时给出引导与「创建项目」入口
 *
 * 点击卡片即进入该项目看板；创建项目后自动进入。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { ChevronRight, FolderPlus, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { Project } from '@proma/shared'
import type { AgentWorkspace } from '@proma/shared'
import { cn } from '@/lib/utils'
import {
  taskboardProjectsAtom,
} from '@/atoms/taskboard-atoms'

interface ProjectHomeProps {
  projects: Project[]
  /** 加载中占位 */
  loading?: boolean
  onOpenProject: (projectId: string) => void
}

/** 默认全局项目复用 local 标识（与 ProjectSwitcher 一致） */
export const GLOBAL_PROJECT_ID = 'local'

function ProjectCard({
  project,
  onOpen,
}: {
  project: Project
  onOpen: () => void
}): React.ReactElement {
  const isGlobal = project.id === GLOBAL_PROJECT_ID
  const label = isGlobal ? '全局' : project.issueCount > 0 ? 'Codex 项目' : '已保存的项目'
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm transition-colors hover:border-foreground/20 hover:bg-accent/40">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
        onClick={onOpen}
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold',
            isGlobal ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.08] text-foreground/70',
          )}
          aria-hidden="true"
        >
          {isGlobal ? '全' : (project.name.slice(0, 1).toUpperCase())}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <strong className="truncate text-[13px] font-medium text-foreground">
            {isGlobal ? '全局' : project.name}
          </strong>
          <span className="text-[11px] text-foreground/40">
            {label}
            {project.issueCount > 0 ? ` · ${project.issueCount} 个议题` : ''}
          </span>
        </span>
        <ChevronRight size={15} className="shrink-0 text-foreground/35 transition-colors group-hover:text-foreground/60" />
      </button>
    </div>
  )
}

export function ProjectHome({
  projects, loading, onOpenProject,
}: ProjectHomeProps): React.ReactElement {
  const setProjects = useSetAtom(taskboardProjectsAtom)
  const [creating, setCreating] = React.useState(false)
  const [projectName, setProjectName] = React.useState('')

  // 将用户已有的 Agent 工作区同步为任务看板项目，让项目首页能展示"当前已有的项目"。
  // 仅在有新工作区缺失对应项目时创建；已存在则复用。
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [workspaces, currentProjects] = await Promise.all([
          window.electronAPI.listAgentWorkspaces(),
          window.electronAPI.listTaskboardProjects(),
        ])
        if (cancelled) return
        const existing = new Set(currentProjects.map((p) => p.id))
        const missing = workspaces.filter((w) => !existing.has(w.id))
        if (missing.length === 0) return
        const created = await Promise.all(
          missing.map((w) => window.electronAPI.createTaskboardProject({
            id: w.id,
            name: w.name,
            workspacePath: w.path,
          }).catch(() => null)),
        )
        if (cancelled) return
        const createdProjects = created.filter((p): p is Project => p !== null)
        if (createdProjects.length > 0) {
          setProjects((current) => {
            const ids = new Set(current.map((p) => p.id))
            return [...current, ...createdProjects.filter((p) => !ids.has(p.id))]
          })
        }
      } catch (error) {
        console.error('[ProjectHome] 同步工作区为项目失败', error)
      }
    })()
    return () => { cancelled = true }
    // 仅在挂载时同步一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const global = projects.find((p) => p.id === GLOBAL_PROJECT_ID)
  const rest = projects.filter((p) => p.id !== GLOBAL_PROJECT_ID)
  const withIssues = rest.filter((p) => p.issueCount > 0)
  const withoutIssues = rest.filter((p) => p.issueCount === 0)

  function openProject(project: Project): void {
    onOpenProject(project.id)
  }

  async function createProject(): Promise<void> {
    const name = projectName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const id = `temp-${window.crypto.randomUUID()}`
      const project = await window.electronAPI.createTaskboardProject({ id, name })
      setProjects((current) => [...current, project])
      setProjectName('')
      onOpenProject(project.id)
      toast(`项目「${project.name}」已创建。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建项目失败')
    } finally {
      setCreating(false)
    }
  }

  const groups = [
    { id: 'with-issues', title: '已有议题', projects: [...(global ? [global] : []), ...withIssues] },
    { id: 'without-issues', title: '尚未添加议题', projects: withoutIssues },
  ]

  return (
    <div className="flex h-full flex-col overflow-auto bg-content-area p-8">
      <div className="mx-auto w-full max-w-[920px]">
        <header className="mb-6">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-foreground/40">
            任务面板
          </span>
          <h1 className="mt-1.5 text-[21px] font-semibold tracking-tight text-foreground">
            选择项目
          </h1>
          <p className="mt-1 text-[12px] text-foreground/45">
            从已有项目开始，或创建一个新项目，继续管理任务。
          </p>
        </header>

        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[92px] animate-pulse rounded-xl border border-border/60 bg-muted/40" />
            ))}
          </div>
        ) : projects.length > 0 ? (
          <div className="flex flex-col gap-7">
            {groups.map((group) => (
              <section key={group.id}>
                <div className="flex items-center gap-2 border-b border-border/60 pb-2">
                  <h2 className="text-[11px] font-semibold text-foreground/70">{group.title}</h2>
                  <span className="text-[10px] text-foreground/40">{group.projects.length}</span>
                </div>
                {group.projects.length > 0 ? (
                  <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
                    {group.projects.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        onOpen={() => openProject(project)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] text-foreground/40">暂无项目</p>
                )}
              </section>
            ))}

            {/* 创建新项目 */}
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-border/80 bg-background/40 px-3.5 py-3">
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createProject()
                }}
                placeholder="输入项目名称，回车创建"
                maxLength={80}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground/35"
              />
              <button
                type="button"
                disabled={!projectName.trim() || creating}
                onClick={() => void createProject()}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {creating ? <LoaderCircle size={13} className="animate-spin" /> : <FolderPlus size={13} />}
                新建项目
              </button>
            </div>
          </div>
        ) : (
          <div className="grid min-h-[260px] place-items-center text-center">
            <div>
              <h2 className="text-[14px] font-medium text-foreground">还没有项目</h2>
              <p className="mt-1 text-[11px] text-foreground/45">创建一个项目，开始整理任务。</p>
              <button
                type="button"
                disabled={creating}
                onClick={() => void createProject()}
                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {creating ? <LoaderCircle size={14} className="animate-spin" /> : <FolderPlus size={14} />}
                新建项目
              </button>
              <div className="mt-2.5">
                <input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void createProject()
                  }}
                  placeholder="项目名称"
                  maxLength={80}
                  className="w-52 rounded-md border border-border/70 bg-background px-3 py-1.5 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 placeholder:text-foreground/35"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
