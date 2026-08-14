/**
 * FeedbackDialog - 用户反馈弹窗
 *
 * 只收集表单和关联会话信息；会话文件读取、脱敏与网络提交由主进程负责。
 */

import * as React from 'react'
import { Loader2, MessageSquareText } from 'lucide-react'
import { toast } from 'sonner'
import type { FeedbackSessionType } from '@proma/shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface FeedbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSessionId?: string
  initialSessionType?: FeedbackSessionType
  initialSessionTitle?: string
}

interface FeedbackFormState {
  title: string
  content: string
  sessionId: string
  sessionType?: FeedbackSessionType
  includeTranscript: boolean
}

const EMPTY_FORM: FeedbackFormState = {
  title: '',
  content: '',
  sessionId: '',
  sessionType: undefined,
  includeTranscript: true,
}

export function FeedbackDialog({
  open,
  onOpenChange,
  initialSessionId,
  initialSessionType,
  initialSessionTitle,
}: FeedbackDialogProps): React.ReactElement {
  const [form, setForm] = React.useState<FeedbackFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setForm({
      ...EMPTY_FORM,
      sessionId: initialSessionId ?? '',
      sessionType: initialSessionType,
    })
    setSubmitting(false)
  }, [initialSessionId, initialSessionType, open])

  const canSubmit =
    form.title.trim().length > 0
    && form.content.trim().length > 0
    && form.sessionId.trim().length > 0
    && !submitting

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    try {
      const result = await window.electronAPI.submitFeedback({
        title: form.title,
        content: form.content,
        sessionId: form.sessionId,
        sessionType: form.sessionType,
        includeTranscript: form.includeTranscript,
        locale: navigator.language,
      })
      toast.success('反馈已提交', {
        description: `反馈编号：${result.feedbackId}`,
      })
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : '请稍后重试'
      toast.error('反馈提交失败', { description: message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!submitting) onOpenChange(nextOpen) }}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader className="bg-gradient-to-br from-primary/14 via-primary/[0.06] to-transparent px-6 pb-5 pt-6">
            <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-sm">
              <MessageSquareText size={20} />
            </div>
            <DialogTitle>提交反馈</DialogTitle>
            <DialogDescription>
              描述你遇到的问题。关联会话会在本地脱敏和截断后再提交。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">标题</span>
              <Input
                autoFocus
                maxLength={120}
                value={form.title}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))}
                placeholder="用一句话概括问题"
              />
              <span className="block text-right text-[11px] text-muted-foreground">
                {form.title.length}/120
              </span>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">内容</span>
              <Textarea
                className="min-h-[150px] resize-y"
                maxLength={20_000}
                value={form.content}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  content: event.target.value,
                }))}
                placeholder="请描述实际表现、预期结果和复现步骤"
              />
            </label>

            <div className="space-y-3 rounded-xl bg-muted/55 p-4 shadow-sm">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">会话 ID</span>
                <Input
                  value={form.sessionId}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    sessionId: event.target.value,
                    // 手动改过 ID 后不再沿用右键菜单传入的会话类型，由主进程重新识别。
                    sessionType: undefined,
                  }))}
                  placeholder="输入需要反馈的 Chat 或 Agent 会话 ID"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </label>

              {initialSessionId
                && initialSessionTitle
                && form.sessionId === initialSessionId && (
                <div className="truncate text-xs text-muted-foreground">
                  已关联：{initialSessionTitle}
                </div>
              )}

              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.includeTranscript}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    includeTranscript: event.target.checked,
                  }))}
                  className="mt-0.5 size-4 rounded border-border accent-primary"
                />
                <span>
                  附带最近会话记录
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    提交时按上述 ID 查找本地会话，最多导出 50 条；密钥、Token 和本地用户名路径会自动隐藏。
                  </span>
                </span>
              </label>
            </div>
          </div>

          <DialogFooter className="border-t border-border/50 bg-muted/25 px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting && <Loader2 className="animate-spin" />}
              {submitting ? '正在提交' : '提交反馈'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
