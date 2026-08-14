import * as React from 'react'
import { Check } from 'lucide-react'
import type {
  AgentRuntimeModelInfo,
  ThinkingEffortLevel,
} from '@proma/shared'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export interface CcbConfiguredModelEditorValue {
  id: string
  name?: string
  description?: string
  contextWindow?: number
  /** 模型级上下文自动压缩触发占比（0-100，百分比）；未配置时回退供应商级。 */
  autoCompactRatio?: number
  effortLevels?: ThinkingEffortLevel[]
}

interface CcbConfiguredModelEditorProps {
  value: CcbConfiguredModelEditorValue
  onChange: (patch: Partial<CcbConfiguredModelEditorValue>) => void
  runtimeModel?: AgentRuntimeModelInfo
  idError?: string
}

const EFFORT_LEVELS: Array<{
  value: ThinkingEffortLevel
  label: string
}> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
  { value: 'max', label: '最大' },
]

export function CcbConfiguredModelEditor({
  value,
  onChange,
  runtimeModel,
  idError,
}: CcbConfiguredModelEditorProps): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <ModelField label="模型 ID" required error={idError}>
          <Input
            value={value.id}
            onChange={event => onChange({ id: event.target.value })}
            placeholder="例如 gpt-5.6-sol"
            aria-invalid={Boolean(idError)}
          />
        </ModelField>
        <ModelField label="显示名称">
          <Input
            value={value.name ?? ''}
            onChange={event => onChange({ name: event.target.value })}
            placeholder={runtimeModel?.displayName || '模型选择器中显示的名称'}
          />
        </ModelField>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_220px]">
        <ModelField label="描述">
          <Textarea
            value={value.description ?? ''}
            onChange={event => onChange({ description: event.target.value })}
            placeholder={runtimeModel?.description || '可选的模型说明'}
            className="min-h-20 resize-y"
          />
        </ModelField>
        <ModelField
          label="Context Window"
          description="Token 数，留空由 CCB 判断"
        >
          <Input
            type="number"
            min={1}
            step={1}
            value={value.contextWindow ?? ''}
            onChange={event => {
              const raw = event.target.value.trim()
              onChange({ contextWindow: raw ? Number(raw) : undefined })
            }}
            placeholder={
              runtimeModel?.contextWindow
                ? `CCB 自动：${runtimeModel.contextWindow.toLocaleString()}`
                : '例如 200000'
            }
          />
        </ModelField>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_220px]">
        <div className="md:col-span-2">
          <div className="mb-2 text-xs font-medium">上下文自动压缩</div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            达到上下文窗口的该比例时自动压缩。留空表示使用供应商级配置；都不配置时默认 80%。
          </p>
        </div>
        <ModelField
          label="压缩触发占比"
          description="百分比，0-100；留空由供应商级或默认 80% 兜底"
        >
          <Input
            type="number"
            min={0}
            max={100}
            step={5}
            value={value.autoCompactRatio ?? ''}
            onChange={event => {
              const raw = event.target.value.trim()
              onChange({ autoCompactRatio: raw ? Number(raw) : undefined })
            }}
            placeholder="默认 80%"
          />
        </ModelField>
      </div>

      <EffortLevelEditor
        value={value.effortLevels}
        onChange={effortLevels => onChange({ effortLevels })}
      />

    </div>
  )
}

interface ModelFieldProps {
  label: string
  description?: string
  required?: boolean
  error?: string
  children: React.ReactNode
}

function ModelField({
  label,
  description,
  required,
  error,
  children,
}: ModelFieldProps): React.ReactElement {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {description && (
        <span className="block text-[11px] text-muted-foreground">{description}</span>
      )}
      {children}
      {error && (
        <span className="block text-[11px] text-destructive">{error}</span>
      )}
    </label>
  )
}

interface EffortLevelEditorProps {
  value?: ThinkingEffortLevel[]
  onChange: (value: ThinkingEffortLevel[] | undefined) => void
}

function EffortLevelEditor({
  value,
  onChange,
}: EffortLevelEditorProps): React.ReactElement {
  const automatic = value === undefined

  const toggleLevel = (level: ThinkingEffortLevel): void => {
    const current = value ?? []
    onChange(
      current.includes(level)
        ? current.filter(item => item !== level)
        : [...current, level],
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium">思考等级</p>
          <p className="text-[11px] text-muted-foreground">
            自动判断表示不写 effortLevels；全部取消表示该模型不支持 Effort
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(automatic ? [] : undefined)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors',
            automatic
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:text-foreground',
          )}
        >
          {automatic && <Check size={12} />}
          由 CCB 自动判断
        </button>
      </div>
      <div className={cn('flex flex-wrap gap-2', automatic && 'opacity-45')}>
        {EFFORT_LEVELS.map(option => {
          const selected = value?.includes(option.value) ?? false
          return (
            <button
              key={option.value}
              type="button"
              disabled={automatic}
              onClick={() => toggleLevel(option.value)}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs transition-colors',
                selected
                  ? 'bg-primary/15 font-medium text-primary ring-1 ring-primary/25'
                  : 'bg-muted/65 text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
