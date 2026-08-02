import * as React from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatFileNames } from '@/lib/file-utils'
import { cn } from '@/lib/utils'
import { prepareFilePanelSelection } from './file-panel-actions'
import type { FilePanelReferenceResult, FilePanelUploadEntry } from './file-panel-actions'

export interface FilePanelAddButtonProps {
  scope: 'session' | 'workspace'
  disabled?: boolean
  className?: string
  onSaveFiles: (files: FilePanelUploadEntry[]) => Promise<void>
  onReferenceFiles: (filePaths: string[]) => Promise<FilePanelReferenceResult>
  onReferenceDirectories: (directoryPaths: string[]) => Promise<FilePanelReferenceResult>
}

export const FILE_PANEL_ADD_COPY = {
  session: {
    label: '添加会话文件或访问目录',
    description: '文件复制到当前会话，文件夹作为当前会话的访问目录',
  },
  workspace: {
    label: '添加工作区文件或访问目录',
    description: '文件复制到工作区，文件夹作为所有会话的访问目录',
  },
} as const

export function FilePanelAddButton({
  scope,
  disabled = false,
  className,
  onSaveFiles,
  onReferenceFiles,
  onReferenceDirectories,
}: FilePanelAddButtonProps): React.ReactElement {
  const [loading, setLoading] = React.useState(false)
  const copy = FILE_PANEL_ADD_COPY[scope]

  const handleAdd = React.useCallback(async (): Promise<void> => {
    try {
      setLoading(true)
      const result = await window.electronAPI.openFileOrDirectoryDialog()
      const selection = prepareFilePanelSelection(result)
      if (
        selection.uploadFiles.length === 0
        && selection.referenceFiles.length === 0
        && selection.skippedFiles.length === 0
        && selection.oversizedFilenames.length === 0
        && result.directories.length === 0
      ) return

      if (result.directories.length > 0) {
        const directoryResult = await onReferenceDirectories(result.directories.map(directory => directory.path))
        const succeededPathSet = new Set(directoryResult.succeededPaths)
        const failedPathSet = new Set(directoryResult.failedPaths)
        const succeededNames = result.directories
          .filter(directory => succeededPathSet.has(directory.path))
          .map(directory => directory.name)
        const failedNames = result.directories
          .filter(directory => failedPathSet.has(directory.path))
          .map(directory => directory.name)

        if (succeededNames.length > 0) {
          toast.success(`已添加访问目录：${formatFileNames(succeededNames)}`)
        }
        if (failedNames.length > 0) {
          toast.error(`以下访问目录添加失败：${formatFileNames(failedNames)}`)
        }
      }

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
      console.error('[文件面板] 添加文件或文件夹失败:', error)
      toast.error('添加文件或文件夹失败')
    } finally {
      setLoading(false)
    }
  }, [onReferenceDirectories, onReferenceFiles, onSaveFiles])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || loading}
          aria-label={copy.label}
          className={cn(className)}
          onClick={() => { void handleAdd() }}
        >
          {loading ? <Loader2 className="animate-spin" /> : <Plus />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        <p>{copy.label}</p>
        <p className="text-xs text-muted-foreground">{copy.description}</p>
      </TooltipContent>
    </Tooltip>
  )
}
