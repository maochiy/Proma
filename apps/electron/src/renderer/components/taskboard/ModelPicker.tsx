/**
 * ModelPicker — 任务看板「执行模型」选择器
 *
 * 在创建/编辑任务时选择用于自动执行（拖入处理中）的 Agent 渠道与模型。
 * 复用 TaskPropertyPicker（与状态下拉同款 Portal 定位），保证在任务编辑
 * 对话框内也不会被覆盖。
 */

import * as React from 'react'
import { Bot } from 'lucide-react'
import type { ModelOption } from '@proma/shared'
import { TaskPropertyPicker } from './TaskPropertyPicker'

/** 默认模型（跟随设置）的哨兵值 */
const DEFAULT_MODEL = '__default__'

interface ModelPickerProps {
  modelId: string | null
  options: ModelOption[]
  loading?: boolean
  onChange: (modelId: string | null) => void
}

export function ModelPicker({
  modelId, options, loading, onChange,
}: ModelPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((option) => option.modelId === modelId) ?? null

  return (
    <TaskPropertyPicker
      value={modelId ?? DEFAULT_MODEL}
      options={[
        {
          value: DEFAULT_MODEL,
          label: loading ? '加载中…' : '默认模型（跟随设置）',
          icon: <Bot size={12} className="text-primary/70" />,
        },
        ...options.map((option) => ({
          value: option.modelId,
          label: option.modelName,
          icon: <Bot size={12} className="text-primary/70" />,
        })),
      ]}
      open={open}
      triggerClassName="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[12px] text-foreground/80 hover:bg-foreground/5"
      ariaLabel="选择执行模型"
      title={selected ? `执行模型：${selected.modelName}` : '选择执行 Agent 模型'}
      onOpenChange={setOpen}
      onChange={(value) => onChange(value === DEFAULT_MODEL ? null : value)}
    />
  )
}
