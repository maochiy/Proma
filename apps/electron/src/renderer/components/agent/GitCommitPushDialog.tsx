/**
 * 提交 / 推送对话框
 *
 * - 可切换分支
 * - 多 remote 时显示远程选择
 * - 提交信息可手写；留空则 AI 自动生成
 * - 支持仅提交、提交并推送、仅推送
 */

import * as React from 'react'
import { Check, ChevronDown, GitBranch, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SessionGitBranchMenu } from './SessionGitBranchMenu'

export interface GitCommitPushDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dirPath: string
  sessionId: string
  currentBranch: string | null
  additions: number
  deletions: number
  filesChanged: number
  channelId: string | null
  modelId: string | null
  onCompleted?: () => void
  onBranchChanged?: (branch: string) => void
}

export function GitCommitPushDialog({
  open,
  onOpenChange,
  dirPath,
  sessionId,
  currentBranch,
  additions,
  deletions,
  filesChanged,
  channelId,
  modelId,
  onCompleted,
  onBranchChanged,
}: GitCommitPushDialogProps): React.ReactElement {
  const [message, setMessage] = React.useState('')
  const [includeUnstaged, setIncludeUnstaged] = React.useState(true)
  const [branch, setBranch] = React.useState<string | null>(currentBranch)
  const [remotes, setRemotes] = React.useState<string[]>([])
  const [selectedRemote, setSelectedRemote] = React.useState<string | null>(null)
  const [remoteOpen, setRemoteOpen] = React.useState(false)
  const [branchMenuOpen, setBranchMenuOpen] = React.useState(false)
  const [busyAction, setBusyAction] = React.useState<'commit' | 'commit-push' | 'push' | null>(null)
  const nestedMenuOpen = branchMenuOpen || remoteOpen

  const showRemoteSelector = remotes.length > 1
  const hasChanges = filesChanged > 0 || additions > 0 || deletions > 0

  React.useEffect(() => {
    if (!open) return
    setMessage('')
    setIncludeUnstaged(true)
    setBranch(currentBranch)
    setBusyAction(null)
    setBranchMenuOpen(false)
    setRemoteOpen(false)

    let cancelled = false
    void (async () => {
      try {
        const result = await window.electronAPI.listGitRemotes(dirPath, sessionId)
        if (cancelled) return
        setRemotes(result.remotes)
        const preferred = result.upstreamRemote
          && result.remotes.includes(result.upstreamRemote)
          ? result.upstreamRemote
          : result.remotes.includes('origin')
            ? 'origin'
            : result.remotes[0] ?? null
        setSelectedRemote(preferred)
      } catch {
        if (cancelled) return
        setRemotes([])
        setSelectedRemote(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, dirPath, sessionId, currentBranch])

  const resolveMessage = React.useCallback(async (): Promise<string | null> => {
    const trimmed = message.trim()
    if (trimmed) return trimmed

    if (!channelId || !modelId) {
      // 无渠道时让主进程用启发式回退
      const result = await window.electronAPI.generateGitCommitMessage({
        dirPath,
        channelId: channelId || '',
        modelId: modelId || '',
        includeUnstaged,
        sessionId,
      })
      if (!result.ok || !result.message) {
        toast.error(result.error || '无法自动生成提交信息')
        return null
      }
      setMessage(result.message)
      return result.message
    }

    const result = await window.electronAPI.generateGitCommitMessage({
      dirPath,
      channelId,
      modelId,
      includeUnstaged,
      sessionId,
    })
    if (!result.ok || !result.message) {
      toast.error(result.error || '无法自动生成提交信息')
      return null
    }
    setMessage(result.message)
    return result.message
  }, [channelId, dirPath, includeUnstaged, message, modelId, sessionId])

  const runCommit = React.useCallback(async (alsoPush: boolean) => {
    if (busyAction) return
    setBusyAction(alsoPush ? 'commit-push' : 'commit')
    try {
      const finalMessage = await resolveMessage()
      if (!finalMessage) return

      const result = alsoPush
        ? await window.electronAPI.gitCommitAndPush({
            dirPath,
            message: finalMessage,
            includeUnstaged,
            push: true,
            remote: selectedRemote ?? undefined,
            sessionId,
          })
        : await window.electronAPI.gitCommit({
            dirPath,
            message: finalMessage,
            includeUnstaged,
            sessionId,
          })

      if (!result.ok) {
        toast.error(result.error || (alsoPush ? '提交并推送失败' : '提交失败'))
        return
      }

      toast.success(alsoPush ? '提交并推送成功' : '提交成功')
      onCompleted?.()
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusyAction(null)
    }
  }, [
    busyAction,
    dirPath,
    includeUnstaged,
    onCompleted,
    onOpenChange,
    resolveMessage,
    selectedRemote,
    sessionId,
  ])

  const runPushOnly = React.useCallback(async () => {
    if (busyAction) return
    setBusyAction('push')
    try {
      const result = await window.electronAPI.gitPush({
        dirPath,
        remote: selectedRemote ?? undefined,
        sessionId,
      })
      if (!result.ok) {
        toast.error(result.error || '推送失败')
        return
      }
      toast.success('推送成功')
      onCompleted?.()
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '推送失败')
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, dirPath, onCompleted, onOpenChange, selectedRemote, sessionId])

  const busy = busyAction !== null

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (busy) return
      onOpenChange(next)
    }}>
      <DialogContent
        className="max-w-[420px] gap-3 overflow-visible !rounded-[24px] p-4 sm:!rounded-[24px]"
        hideClose={false}
        onPointerDownOutside={(event) => {
          // 子菜单打开时：只收起菜单，不关闭提交弹窗
          if (nestedMenuOpen) {
            event.preventDefault()
            setBranchMenuOpen(false)
            setRemoteOpen(false)
          }
        }}
        onInteractOutside={(event) => {
          if (nestedMenuOpen) {
            event.preventDefault()
          }
        }}
        onEscapeKeyDown={(event) => {
          if (nestedMenuOpen) {
            event.preventDefault()
            setBranchMenuOpen(false)
            setRemoteOpen(false)
          }
        }}
      >
        <DialogHeader className="space-y-2 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <SessionGitBranchMenu
              dirPath={dirPath}
              sessionId={sessionId}
              currentBranch={branch}
              disabled={busy}
              portalled={false}
              open={branchMenuOpen}
              onOpenChange={(next) => {
                setBranchMenuOpen(next)
                if (next) setRemoteOpen(false)
              }}
              onBranchChanged={(next) => {
                setBranch(next)
                onBranchChanged?.(next)
              }}
              trigger={(
                <button
                  type="button"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2 py-1 text-xs hover:bg-accent/50"
                >
                  <GitBranch className="size-3.5 text-muted-foreground" />
                  <span className="max-w-[180px] truncate font-medium">{branch ?? 'HEAD'}</span>
                  <ChevronDown className="size-3 text-muted-foreground" />
                </button>
              )}
              align="start"
            />

            {showRemoteSelector && (
              <Popover
                open={remoteOpen}
                onOpenChange={(next) => {
                  setRemoteOpen(next)
                  if (next) setBranchMenuOpen(false)
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2 py-1 text-xs hover:bg-accent/50 disabled:opacity-50"
                  >
                    <Upload className="size-3.5 text-muted-foreground" />
                    <span className="max-w-[120px] truncate">{selectedRemote ?? '选择远程'}</span>
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  portalled={false}
                  className="w-[200px] max-h-[240px] overflow-y-auto !rounded-[24px] p-1"
                  onWheel={(event) => event.stopPropagation()}
                >
                  {remotes.map((remote) => (
                    <button
                      key={remote}
                      type="button"
                      onClick={() => {
                        setSelectedRemote(remote)
                        setRemoteOpen(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/60',
                        remote === selectedRemote && 'bg-accent/35 font-medium',
                      )}
                    >
                      <span className="flex-1 truncate">{remote}</span>
                      {remote === selectedRemote && <Check className="size-3.5" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>
          <DialogTitle className="text-sm font-medium">提交更改</DialogTitle>
          <DialogDescription className="sr-only">
            编写提交信息，或留空由 AI 自动生成，然后提交或推送。
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="提交信息（留空将自动生成）…"
          disabled={busy}
          className="min-h-[96px] resize-none text-sm"
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => setIncludeUnstaged((value) => !value)}
          className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-xs hover:bg-accent/40 disabled:opacity-50"
        >
          <span
            className={cn(
              'flex size-4 items-center justify-center rounded border',
              includeUnstaged
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border/70 bg-background',
            )}
          >
            {includeUnstaged && <Check className="size-3" />}
          </span>
          <span className="flex-1 text-muted-foreground">包含未暂存的更改</span>
          {(additions > 0 || deletions > 0) && (
            <span className="tabular-nums">
              {additions > 0 && (
                <span className="text-emerald-500">+{additions.toLocaleString()}</span>
              )}
              {additions > 0 && deletions > 0 && ' '}
              {deletions > 0 && (
                <span className="text-red-500">-{deletions.toLocaleString()}</span>
              )}
            </span>
          )}
          {filesChanged > 0 && additions === 0 && deletions === 0 && (
            <span className="text-muted-foreground tabular-nums">{filesChanged} 个文件</span>
          )}
        </button>

        <div className="flex flex-col gap-1.5 pt-1">
          <Button
            type="button"
            variant="outline"
            disabled={(busy && busyAction !== 'commit') || !hasChanges}
            onClick={() => void runCommit(false)}
            className={cn(
              'h-9 justify-start rounded-lg hover:bg-accent/90',
              busyAction === 'commit'
                ? 'border-primary text-primary font-semibold'
                : '',
            )}
          >
            {busyAction === 'commit' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            提交
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={(busy && busyAction !== 'commit-push') || !hasChanges || remotes.length === 0}
            onClick={() => void runCommit(true)}
            className={cn(
              'h-9 justify-start rounded-lg hover:bg-accent/90',
              busyAction === 'commit-push'
                ? 'border-primary text-primary font-semibold'
                : '',
            )}
          >
            {busyAction === 'commit-push' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            提交并推送
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={(busy && busyAction !== 'push') || remotes.length === 0}
            onClick={() => void runPushOnly()}
            className={cn(
              'h-9 justify-start rounded-lg hover:bg-accent/90',
              busyAction === 'push'
                ? 'border-primary text-primary font-semibold'
                : '',
            )}
          >
            {busyAction === 'push' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            推送
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
