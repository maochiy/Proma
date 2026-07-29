import * as React from 'react'
import { FilePlus2, FolderPlus, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatFileNames } from '@/lib/file-utils'
import { cn } from '@/lib/utils'
import { prepareFilePanelSelection } from './file-panel-actions'
import type { FilePanelReferenceResult, FilePanelUploadEntry } from './file-panel-actions'

export interface FilePanelAddMenuProps {
  scope: 'session' | 'workspace'
  disabled?: boolean
  className?: string
  onSaveFiles: (files: FilePanelUploadEntry[]) => Promise<void>
  onReferenceFiles: (filePaths: string[]) => Promise<FilePanelReferenceResult>
  onAddDirectory: () => Promise<string | null>
}

export const FILE_PANEL_MENU_COPY = {
  session: {
    triggerLabel: '添加会话文件或访问目录',
    fileDescription: '复制到当前会话的工作文件目录',
    directoryDescription: '不复制文件，仅允许当前会话访问',
  },
  workspace: {
    triggerLabel: '添加工作区文件或访问目录',
    fileDescription: '复制到工作区共享文件目录',
    directoryDescription: '不复制文件，允许工作区内所有会话访问',
  },
} as const

export function FilePanelAddMenu({
  scope,
  disabled = false,
  className,
  onSaveFiles,
  onReferenceFiles,
  onAddDirectory,
}: FilePanelAddMenuProps): React.ReactElement {
  const [loading, setLoading] = React.useState(false)
  const copy = FILE_PANEL_MENU_COPY[scope]

  const handleAddFiles = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFileDialog()
      const selection = prepareFilePanelSelection(result)
      if (
        selection.uploadFiles.length === 0
        && selection.referenceFiles.length === 0
        && selection.skippedFiles.length === 0
        && selection.oversizedFilenames.length === 0
      ) return

      setLoading(true)

      if (selection.referenceFiles.length > 0) {
        const referenceResult = await onReferenceFiles(selection.referenceFiles.map(file => file.path))
        const succeededPathSet = new Set(referenceResult.succeededPaths)
        const failedPathSet = new Set(referenceResult.failedPaths)
        const succeededNames = selection.referenceFiles
          .filter(file => succeededPathSet.has(file.path))
          .map(file => file.filename)
        const failedNames = selection.referenceFiles
          .filter(file => failedPathSet.has(file.path))
          .map(file => file.filename)

        if (succeededNames.length > 0) {
          toast.success(`已添加外部文件引用：${formatFileNames(succeededNames)}`)
        }
        if (failedNames.length > 0) {
          toast.error(`以下文件引用添加失败：${formatFileNames(failedNames)}`)
        }
      }

      if (selection.skippedFiles.length > 0) {
        toast.warning(`以下文件无法读取，已跳过：${formatFileNames(selection.skippedFiles.map(file => file.filename))}`)
      }

      if (selection.oversizedFilenames.length > 0) {
        toast.error(`以下文件超过 100MB 且无法取得本地路径，已跳过：${formatFileNames(selection.oversizedFilenames)}`, {
          description: '可以改为添加文件所在的访问目录。',
        })
      }

      if (selection.uploadFiles.length > 0) {
        await onSaveFiles(selection.uploadFiles)
        toast.success(`已添加 ${selection.uploadFiles.length} 个文件`)
      }
    } catch (error) {
      console.error('[文件面板] 添加文件失败:', error)
      toast.error('添加文件失败')
    } finally {
      setLoading(false)
    }
  }, [onReferenceFiles, onSaveFiles])

  const handleAddDirectory = React.useCallback(async (): Promise<void> => {
    try {
      setLoading(true)
      const directoryName = await onAddDirectory()
      if (directoryName) {
        toast.success(`已添加访问目录：${directoryName}`)
      }
    } catch (error) {
      console.error('[文件面板] 添加访问目录失败:', error)
      toast.error('添加访问目录失败')
    } finally {
      setLoading(false)
    }
  }, [onAddDirectory])

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled || loading}
              aria-label={copy.triggerLabel}
              className={cn(className)}
            >
              {loading ? <Loader2 className="animate-spin" /> : <Plus />}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{copy.triggerLabel}</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64 p-1.5">
        <DropdownMenuItem
          className="items-start gap-3 rounded-lg px-2.5 py-2"
          onSelect={() => { void handleAddFiles() }}
        >
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70">
            <FilePlus2 className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">添加文件</span>
            <span className="block text-xs text-muted-foreground">{copy.fileDescription}</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="items-start gap-3 rounded-lg px-2.5 py-2"
          onSelect={() => { void handleAddDirectory() }}
        >
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70">
            <FolderPlus className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">添加访问目录</span>
            <span className="block text-xs text-muted-foreground">{copy.directoryDescription}</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
