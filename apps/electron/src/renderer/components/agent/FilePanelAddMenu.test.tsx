import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  FILE_PANEL_MENU_COPY,
  FilePanelAddMenu,
} from './FilePanelAddMenu'
import { prepareFilePanelSelection, referenceFilePaths } from './file-panel-actions'
import { MAX_ATTACHMENT_SIZE } from '@proma/shared'
import type { FileDialogResult } from '@proma/shared'

function renderMenu(scope: 'session' | 'workspace'): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <FilePanelAddMenu
        scope={scope}
        onSaveFiles={async () => undefined}
        onReferenceFiles={async filePaths => ({
          succeededPaths: filePaths,
          failedPaths: [],
        })}
        onAddDirectory={async () => null}
      />
    </TooltipProvider>,
  )
}

describe('FilePanelAddMenu 文件面板统一入口', () => {
  test('Given 会话文件面板 When 渲染添加入口 Then 使用会话级说明', () => {
    const html = renderMenu('session')

    expect(html).toContain(`aria-label="${FILE_PANEL_MENU_COPY.session.triggerLabel}"`)
    expect(FILE_PANEL_MENU_COPY.session.fileDescription).toContain('当前会话')
    expect(FILE_PANEL_MENU_COPY.session.directoryDescription).toContain('不复制文件')
  })

  test('Given 工作区文件面板 When 渲染添加入口 Then 明确工作区共享范围', () => {
    const html = renderMenu('workspace')

    expect(html).toContain(`aria-label="${FILE_PANEL_MENU_COPY.workspace.triggerLabel}"`)
    expect(FILE_PANEL_MENU_COPY.workspace.fileDescription).toContain('工作区共享')
    expect(FILE_PANEL_MENU_COPY.workspace.directoryDescription).toContain('所有会话')
  })

  test('Given 选择小文件 When 解析文件选择结果 Then 复制到目标文件目录', () => {
    const result: FileDialogResult = {
      files: [{
        filename: 'notes.md',
        mediaType: 'text/markdown',
        data: 'bm90ZXM=',
        size: 5,
      }],
    }

    expect(prepareFilePanelSelection(result)).toEqual({
      uploadFiles: [{ filename: 'notes.md', data: 'bm90ZXM=' }],
      referenceFiles: [],
      skippedFiles: [],
      oversizedFilenames: [],
    })
  })

  test('Given 选择大文件 When 解析文件选择结果 Then 保留本地路径作为引用', () => {
    const result: FileDialogResult = {
      files: [],
      largeFiles: [{
        filename: 'archive.zip',
        mediaType: 'application/zip',
        size: MAX_ATTACHMENT_SIZE + 1,
        path: '/tmp/archive.zip',
      }],
    }

    const selection = prepareFilePanelSelection(result)
    expect(selection.referenceFiles.map(file => file.path)).toEqual(['/tmp/archive.zip'])
    expect(selection.uploadFiles).toEqual([])
  })

  test('Given 多个外部文件 When 部分引用失败 Then 分别返回成功与失败路径', async () => {
    const result = await referenceFilePaths(
      ['/tmp/ok.bin', '/tmp/failed.bin', '/tmp/also-ok.bin'],
      async (filePath) => {
        if (filePath.includes('failed')) throw new Error('模拟引用失败')
      },
      () => undefined,
    )

    expect(result).toEqual({
      succeededPaths: ['/tmp/ok.bin', '/tmp/also-ok.bin'],
      failedPaths: ['/tmp/failed.bin'],
    })
  })

  test('Given 取消文件选择 When 解析空结果 Then 不产生任何待处理文件', () => {
    expect(prepareFilePanelSelection({ files: [] })).toEqual({
      uploadFiles: [],
      referenceFiles: [],
      skippedFiles: [],
      oversizedFilenames: [],
    })
  })

  test('Given 跳过与超限文件 When 解析结果 Then 保留明确的失败分类', () => {
    const result: FileDialogResult = {
      files: [{
        filename: 'oversized.dat',
        mediaType: 'application/octet-stream',
        data: '',
        size: MAX_ATTACHMENT_SIZE + 1,
      }],
      skippedFiles: [{
        filename: 'unreadable.txt',
        reason: 'unreadable',
        message: '权限不足',
      }],
    }

    const selection = prepareFilePanelSelection(result)
    expect(selection.uploadFiles).toEqual([])
    expect(selection.oversizedFilenames).toEqual(['oversized.dat'])
    expect(selection.skippedFiles.map(file => file.filename)).toEqual(['unreadable.txt'])
  })
})
