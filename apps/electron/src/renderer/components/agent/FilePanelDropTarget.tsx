import * as React from 'react'
import { UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { MAX_ATTACHMENT_SIZE } from '@proma/shared'
import { fileToBase64, formatFileNames } from '@/lib/file-utils'
import { cn } from '@/lib/utils'
import type {
  FilePanelReferenceResult,
  FilePanelUploadEntry,
} from './file-panel-actions'

interface FilePanelDropTargetProps {
  children: React.ReactNode
  disabled?: boolean
  className?: string
  onSaveFiles: (files: FilePanelUploadEntry[]) => Promise<void>
  onReferenceFiles: (filePaths: string[]) => Promise<FilePanelReferenceResult>
  onAddDirectories: (directoryPaths: string[]) => Promise<FilePanelReferenceResult>
}

function getPathName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath
}

function getResultNames(paths: string[], result: FilePanelReferenceResult): {
  succeededNames: string[]
  failedNames: string[]
} {
  const succeededPathSet = new Set(result.succeededPaths)
  const failedPathSet = new Set(result.failedPaths)
  return {
    succeededNames: paths.filter(path => succeededPathSet.has(path)).map(getPathName),
    failedNames: paths.filter(path => failedPathSet.has(path)).map(getPathName),
  }
}

export function FilePanelDropTarget({
  children,
  disabled = false,
  className,
  onSaveFiles,
  onReferenceFiles,
  onAddDirectories,
}: FilePanelDropTargetProps): React.ReactElement {
  const [isDragging, setIsDragging] = React.useState(false)
  const [isProcessing, setIsProcessing] = React.useState(false)
  const dragDepthRef = React.useRef(0)

  const handleDragEnter = React.useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    if (disabled) return
    dragDepthRef.current += 1
    setIsDragging(true)
  }, [disabled])

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    if (disabled) return
    event.dataTransfer.dropEffect = 'copy'
  }, [disabled])

  const handleDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    if (disabled) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragging(false)
  }, [disabled])

  const handleDrop = React.useCallback(async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setIsDragging(false)
    if (disabled || isProcessing) return

    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.length === 0) return

    setIsProcessing(true)
    try {
      const pathToFile = new Map<string, globalThis.File>()
      const pathlessFiles: globalThis.File[] = []
      for (const file of droppedFiles) {
        try {
          const filePath = window.electronAPI.getPathForFile(file)
          if (filePath) {
            pathToFile.set(filePath, file)
          } else {
            pathlessFiles.push(file)
          }
        } catch {
          pathlessFiles.push(file)
        }
      }

      const droppedPaths = [...pathToFile.keys()]
      let pathTypes: { directories: string[]; files: string[] } = {
        directories: [],
        files: droppedPaths,
      }
      if (droppedPaths.length > 0) {
        try {
          pathTypes = await window.electronAPI.checkPathsType(droppedPaths)
        } catch (error) {
          console.warn('[文件面板] 无法识别拖入路径类型，按普通文件处理:', error)
        }
      }

      if (pathTypes.directories.length > 0) {
        const directoryResult = await onAddDirectories(pathTypes.directories)
        const { succeededNames, failedNames } = getResultNames(pathTypes.directories, directoryResult)
        if (succeededNames.length > 0) {
          toast.success(`已添加访问目录：${formatFileNames(succeededNames)}`)
        }
        if (failedNames.length > 0) {
          toast.error(`以下访问目录添加失败：${formatFileNames(failedNames)}`)
        }
      }

      const classifiedPaths = new Set([...pathTypes.directories, ...pathTypes.files])
      const unresolvedPaths = droppedPaths.filter(path => !classifiedPaths.has(path))
      const regularFiles = [...pathTypes.files, ...unresolvedPaths].flatMap((filePath) => {
        const file = pathToFile.get(filePath)
        return file ? [{ file, filePath }] : []
      })
      regularFiles.push(...pathlessFiles.map(file => ({ file, filePath: '' })))
      const uploadFiles: FilePanelUploadEntry[] = []
      const referencePaths: string[] = []
      const oversizedFilenames: string[] = []

      for (const { file, filePath } of regularFiles) {
        if (file.size > MAX_ATTACHMENT_SIZE) {
          if (filePath) {
            referencePaths.push(filePath)
          } else {
            oversizedFilenames.push(file.name)
          }
          continue
        }
        uploadFiles.push({
          filename: file.name,
          data: await fileToBase64(file),
        })
      }

      if (referencePaths.length > 0) {
        const referenceResult = await onReferenceFiles(referencePaths)
        const { succeededNames, failedNames } = getResultNames(referencePaths, referenceResult)
        if (succeededNames.length > 0) {
          toast.success(`已添加外部文件引用：${formatFileNames(succeededNames)}`)
        }
        if (failedNames.length > 0) {
          toast.error(`以下文件引用添加失败：${formatFileNames(failedNames)}`)
        }
      }

      if (oversizedFilenames.length > 0) {
        toast.error(`以下文件超过 100MB 且无法取得本地路径，已跳过：${formatFileNames(oversizedFilenames)}`, {
          description: '可以改为添加文件所在的访问目录。',
        })
      }

      if (uploadFiles.length > 0) {
        await onSaveFiles(uploadFiles)
        toast.success(`已添加 ${uploadFiles.length} 个文件`)
      }
    } catch (error) {
      console.error('[文件面板] 处理拖入内容失败:', error)
      toast.error('添加拖入内容失败')
    } finally {
      setIsProcessing(false)
    }
  }, [disabled, isProcessing, onAddDirectories, onReferenceFiles, onSaveFiles])

  return (
    <div
      className={cn('relative flex min-h-0 flex-1 flex-col', className)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => { void handleDrop(event) }}
    >
      {children}
      {isDragging && (
        <div className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center rounded-xl border border-dashed border-primary/60 bg-background/90 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <UploadCloud className="size-5 text-primary" />
            <span className="text-xs font-medium">松开以添加文件或访问目录</span>
            <span className="text-[10px] text-muted-foreground">文件会复制，目录仅授权直接访问</span>
          </div>
        </div>
      )}
    </div>
  )
}
