import { MAX_ATTACHMENT_SIZE } from '@proma/shared'
import type { FileDialogLargeFile, FileDialogResult, FileDialogSkippedFile } from '@proma/shared'

export interface FilePanelUploadEntry {
  filename: string
  data: string
}

export interface FilePanelReferenceResult {
  succeededPaths: string[]
  failedPaths: string[]
}

export interface FilePanelSelection {
  uploadFiles: FilePanelUploadEntry[]
  referenceFiles: FileDialogLargeFile[]
  skippedFiles: FileDialogSkippedFile[]
  oversizedFilenames: string[]
}

export function prepareFilePanelSelection(result: FileDialogResult): FilePanelSelection {
  const oversizedFilenames: string[] = []
  const uploadFiles = result.files.flatMap((file): FilePanelUploadEntry[] => {
    if (file.size > MAX_ATTACHMENT_SIZE) {
      oversizedFilenames.push(file.filename)
      return []
    }
    return [{ filename: file.filename, data: file.data }]
  })

  return {
    uploadFiles,
    referenceFiles: result.largeFiles ?? [],
    skippedFiles: result.skippedFiles ?? [],
    oversizedFilenames,
  }
}

export async function referenceFilePaths(
  filePaths: string[],
  referenceFile: (filePath: string) => Promise<void>,
  onError: (filePath: string, error: unknown) => void = (filePath, error) => {
    console.error(`[文件面板] 添加外部路径失败: ${filePath}`, error)
  },
): Promise<FilePanelReferenceResult> {
  const result: FilePanelReferenceResult = {
    succeededPaths: [],
    failedPaths: [],
  }

  for (const filePath of filePaths) {
    try {
      await referenceFile(filePath)
      result.succeededPaths.push(filePath)
    } catch (error) {
      onError(filePath, error)
      result.failedPaths.push(filePath)
    }
  }

  return result
}
