import * as React from 'react'
import { FilePlus2, FolderPlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatFileNames } from '@/lib/file-utils'
import { cn } from '@/lib/utils'
import { prepareFilePanelSelection } from './file-panel-actions'
import type {
  FilePanelReferenceResult,
  FilePanelUploadEntry,
} from './file-panel-actions'

interface FilePanelAddActionsProps {
  scope: 'session' | 'workspace'
  disabled?: boolean
  className?: string
  onSaveFiles: (files: FilePanelUploadEntry[]) => Promise<void>
  onReferenceFiles: (filePaths: string[]) => Promise<FilePanelReferenceResult>
  onAddDirectory: () => Promise<unknown>
}

export const FILE_PANEL_ACTION_COPY = {
  session: {
    fileLabel: '添加会话文件',
    fileDescription: '将所选文件复制到当前会话。',
    directoryLabel: '添加会话访问目录',
    directoryDescription: '添加当前会话可访问的目录，不复制文件。',
  },
  workspace: {
    fileLabel: '添加工作区文件',
    fileDescription: '将所选文件复制到工作区共享文件。',
    directoryLabel: '添加工作区访问目录',
    directoryDescription: '添加所有会话可访问的目录，不复制文件。',
  },
} as const

export function FilePanelAddActions({
  scope,
  disabled = false,
  className,
  onSaveFiles,
  onReferenceFiles,
  onAddDirectory,
}: FilePanelAddActionsProps): React.ReactElement {
  const [loadingAction, setLoadingAction] = React.useState<'file' | 'directory' | null>(null)
  const copy = FILE_PANEL_ACTION_COPY[scope]

  const handleAddFiles = React.useCallback(async (): Promise<void> => {
    try {
      setLoadingAction('file')
      const selection = prepareFilePanelSelection(
        await window.electronAPI.openFileDialog(),
      )
      if (selection.referenceFiles.length > 0) {
        await onReferenceFiles(selection.referenceFiles.map((file) => file.path))
      }
      if (selection.uploadFiles.length > 0) {
        await onSaveFiles(selection.uploadFiles)
      }
      if (selection.skippedFiles.length > 0) {
        toast.warning(
          `以下文件无法读取，已跳过：${formatFileNames(
            selection.skippedFiles.map((file) => file.filename),
          )}`,
        )
      }
      if (selection.oversizedFilenames.length > 0) {
        toast.error(
          `以下文件超过 100MB 且无法取得本地路径，已跳过：${formatFileNames(
            selection.oversizedFilenames,
          )}`,
        )
      }
    } catch (error) {
      console.error('[文件面板] 添加文件失败:', error)
      toast.error('添加文件失败')
    } finally {
      setLoadingAction(null)
    }
  }, [onReferenceFiles, onSaveFiles])

  const handleAddDirectory = React.useCallback(async (): Promise<void> => {
    try {
      setLoadingAction('directory')
      await onAddDirectory()
    } catch (error) {
      console.error('[文件面板] 添加访问目录失败:', error)
      toast.error('添加访问目录失败')
    } finally {
      setLoadingAction(null)
    }
  }, [onAddDirectory])

  const buttonClassName = cn(
    'size-7 rounded-md text-muted-foreground hover:bg-accent/70 hover:text-foreground',
    className,
  )

  return (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || loadingAction != null}
            aria-label={copy.fileLabel}
            className={buttonClassName}
            onClick={() => { void handleAddFiles() }}
          >
            {loadingAction === 'file'
              ? <Loader2 className="animate-spin" />
              : <FilePlus2 />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          <p>{copy.fileLabel}</p>
          <p className="text-xs text-muted-foreground">{copy.fileDescription}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || loadingAction != null}
            aria-label={copy.directoryLabel}
            className={buttonClassName}
            onClick={() => { void handleAddDirectory() }}
          >
            {loadingAction === 'directory'
              ? <Loader2 className="animate-spin" />
              : <FolderPlus />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          <p>{copy.directoryLabel}</p>
          <p className="text-xs text-muted-foreground">{copy.directoryDescription}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
