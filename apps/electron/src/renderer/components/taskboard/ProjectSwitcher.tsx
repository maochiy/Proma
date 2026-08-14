/**
 * ProjectSwitcher — 任务看板项目切换器
 *
 * 从 dashi 项目的「header-project-switcher」移植：
 * - 顶部下拉展示「全局」+ 所有项目（含任务数）
 * - 支持创建临时项目（temp- 前缀，可删除）
 * - 切换项目后看板按项目过滤任务
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Check, ChevronDown, FolderKanban, FolderPlus, Globe, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Project } from '@proma/shared'
import { cn } from '@/lib/utils'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  taskboardProjectsAtom,
  rememberTaskboardProject,
} from '@/atoms/taskboard-atoms'

interface ProjectSwitcherProps {
  projects: Project[]
  currentProjectId: string
  onSelect: (projectId: string) => void
}

/** 全局项目复用 local 的标识 */
const GLOBAL_PROJECT_ID = 'local'

export function ProjectSwitcher({
  projects, currentProjectId, onSelect,
}: ProjectSwitcherProps): React.ReactElement {
  const setProjects = useSetAtom(taskboardProjectsAtom)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [projectName, setProjectName] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  const sortedProjects = React.useMemo(() => {
    const global = projects.find((p) => p.id === GLOBAL_PROJECT_ID)
    const rest = projects.filter((p) => p.id !== GLOBAL_PROJECT_ID)
    return [...(global ? [global] : []), ...rest]
  }, [projects])

  const currentName = React.useMemo(() => {
    const project = projects.find((p) => p.id === currentProjectId)
    if (project?.id === GLOBAL_PROJECT_ID) return '全局'
    return project?.name ?? '全局'
  }, [projects, currentProjectId])

  async function handleCreateProject(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const name = projectName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const id = `temp-${window.crypto.randomUUID()}`
      const project = await window.electronAPI.createTaskboardProject({ id, name })
      setProjects((current) => [...current, project])
      rememberTaskboardProject(project.id)
      onSelect(project.id)
      setCreateOpen(false)
      setProjectName('')
      toast(`项目「${project.name}」已创建。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建项目失败')
    } finally {
      setCreating(false)
    }
  }

  async function handleDeleteProject(event: React.MouseEvent, project: Project): Promise<void> {
    event.stopPropagation()
    if (deletingId) return
    setDeletingId(project.id)
    try {
      await window.electronAPI.deleteTaskboardProject(project.id)
      setProjects((current) => current.filter((p) => p.id !== project.id))
      if (currentProjectId === project.id) {
        rememberTaskboardProject(GLOBAL_PROJECT_ID)
        onSelect(GLOBAL_PROJECT_ID)
      }
      toast(`项目「${project.name}」已删除。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除项目失败')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted/60"
            aria-label="切换项目"
          >
            {currentProjectId === GLOBAL_PROJECT_ID
              ? <Globe size={13} className="text-foreground/60" />
              : <FolderKanban size={13} className="text-foreground/60" />}
            <span>{currentName}</span>
            <ChevronDown size={13} className="text-foreground/40" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[9999] w-60 p-1">
          <DropdownMenuLabel className="px-2 py-1.5 text-[11px] font-medium text-foreground/50">
            切换项目
          </DropdownMenuLabel>
          {sortedProjects.map((project) => {
            const isGlobal = project.id === GLOBAL_PROJECT_ID
            const isTemp = project.id.startsWith('temp-')
            const active = project.id === currentProjectId
            return (
              <DropdownMenuItem
                key={project.id}
                className="flex items-center gap-2 py-1.5 text-[13px]"
                onClick={() => onSelect(project.id)}
              >
                <span className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded',
                  isGlobal ? 'bg-primary/10 text-primary' : 'bg-foreground/5 text-foreground/60',
                )}>
                  {isGlobal ? <Globe size={12} /> : <FolderKanban size={12} />}
                </span>
                <span className="flex-1 truncate">{isGlobal ? '全局' : project.name}</span>
                <span className="text-[11px] tabular-nums text-foreground/40">
                  {project.issueCount}
                </span>
                {active && <Check size={13} className="text-primary" />}
                {isTemp && (
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded text-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`删除项目 ${project.name}`}
                    title="删除项目"
                    onClick={(event) => void handleDeleteProject(event, project)}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="flex items-center gap-2 py-1.5 text-[13px] text-primary"
            onSelect={(event) => {
              event.preventDefault()
              setCreateOpen(true)
            }}
          >
            <FolderPlus size={13} />
            创建项目
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-[420px]">
          <DialogHeader>
            <DialogTitle>创建项目</DialogTitle>
          </DialogHeader>
          <form onSubmit={(event) => void handleCreateProject(event)}>
            <label className="block text-[13px] font-medium text-foreground/80">
              项目名称
              <input
                autoFocus
                maxLength={120}
                required
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="输入项目名称"
                className="mt-1.5 w-full rounded-md border border-border/70 bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
              />
            </label>
            <DialogFooter className="mt-4">
              <button
                type="button"
                className="rounded-md border border-border/70 px-3 py-1.5 text-[13px] text-foreground/70 transition-colors hover:bg-muted/60"
                onClick={() => setCreateOpen(false)}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!projectName.trim() || creating}
                className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {creating ? '创建中…' : '创建'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
