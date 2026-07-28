import * as React from 'react'
import {
  ArrowLeft,
  Cpu,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  AgentRuntimeModelCatalog,
  CcbNativeConfiguredModel,
  CcbNativeModelConfiguration,
  CcbNativeModelType,
} from '@proma/shared'
import { CCB_NATIVE_CHANNEL_ID } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  SettingsCard,
  SettingsInput,
  SettingsSecretInput,
  SettingsSection,
  SettingsSelect,
} from './primitives'
import { findAgentRuntimeModel } from '@/lib/agent-thinking-effort'
import { CcbConfiguredModelEditor } from './CcbConfiguredModelEditor'

interface CcbNativeModelFormProps {
  onSaved: () => void
  onCancel: () => void
}

interface EditableModel extends CcbNativeConfiguredModel {
  formKey: string
}

const PROVIDER_OPTIONS: Array<{ value: CcbNativeModelType; label: string }> = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'grok', label: 'xAI Grok' },
]

function createFormKey(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function toEditableModels(
  models: CcbNativeConfiguredModel[],
): EditableModel[] {
  return models.map(model => ({
    ...model,
    effortLevels:
      model.effortLevels === undefined
        ? undefined
        : [...model.effortLevels],
    formKey: createFormKey(),
  }))
}

function toConfiguredModels(models: EditableModel[]): CcbNativeConfiguredModel[] {
  return models.map(({ formKey: _formKey, ...model }) => model)
}

function getProviderDescription(modelType: CcbNativeModelType): string {
  switch (modelType) {
    case 'anthropic':
      return '写入 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL'
    case 'openai':
      return '写入 OPENAI_API_KEY / OPENAI_BASE_URL'
    case 'gemini':
      return '写入 GEMINI_API_KEY / GEMINI_BASE_URL'
    case 'grok':
      return '写入 GROK_API_KEY / GROK_BASE_URL'
  }
}

export function CcbNativeModelForm({
  onSaved,
  onCancel,
}: CcbNativeModelFormProps): React.ReactElement {
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [modelType, setModelType] =
    React.useState<CcbNativeModelType>('anthropic')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [secretLoaded, setSecretLoaded] = React.useState(false)
  const [defaultModel, setDefaultModel] = React.useState('')
  const [models, setModels] = React.useState<EditableModel[]>([])
  const [runtimeCatalog, setRuntimeCatalog] =
    React.useState<AgentRuntimeModelCatalog | null>(null)
  const [loadError, setLoadError] = React.useState<string>()

  const applyConfiguration = React.useCallback(
    (configuration: CcbNativeModelConfiguration): void => {
      setModelType(configuration.modelType)
      setBaseUrl(configuration.baseUrl ?? '')
      setDefaultModel(configuration.defaultModel ?? configuration.models[0]?.id ?? '')
      setModels(toEditableModels(configuration.models))
    },
    [],
  )

  const loadConfiguration = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(undefined)
    try {
      const [configuration, secret, catalog] = await Promise.all([
        window.electronAPI.getCcbNativeModelConfiguration(),
        window.electronAPI.getCcbNativeModelSecret(),
        window.electronAPI
          .getAgentRuntimeModelCatalog(CCB_NATIVE_CHANNEL_ID)
          .catch(() => null),
      ])
      applyConfiguration(configuration)
      setApiKey(secret)
      setSecretLoaded(true)
      setRuntimeCatalog(catalog)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '读取 CCB 模型配置失败')
    } finally {
      setLoading(false)
    }
  }, [applyConfiguration])

  React.useEffect(() => {
    void loadConfiguration()
  }, [loadConfiguration])

  const updateModel = React.useCallback(
    (
      formKey: string,
      update: (model: EditableModel) => EditableModel,
    ): void => {
      setModels(current =>
        current.map(model => model.formKey === formKey ? update(model) : model),
      )
    },
    [],
  )

  const addModel = (): void => {
    const next: EditableModel = {
      formKey: createFormKey(),
      id: '',
      name: '',
      description: '',
    }
    setModels(current => [...current, next])
  }

  const removeModel = (formKey: string): void => {
    setModels(current => {
      const removed = current.find(model => model.formKey === formKey)
      const next = current.filter(model => model.formKey !== formKey)
      if (removed?.id === defaultModel) {
        setDefaultModel(next[0]?.id ?? '')
      }
      return next
    })
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await window.electronAPI.updateCcbNativeModelConfiguration({
        modelType,
        defaultModel,
        baseUrl,
        ...(secretLoaded ? { apiKey } : {}),
        models: toConfiguredModels(models),
      })
      applyConfiguration(saved)
      const catalog = await window.electronAPI
        .getAgentRuntimeModelCatalog(CCB_NATIVE_CHANNEL_ID)
        .catch(() => null)
      setRuntimeCatalog(catalog)
      toast.success('CCB 模型配置已保存，CLI 与桌面端会共同使用')
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'CCB 模型配置保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在读取 CCB 模型配置...
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft size={16} />
          返回模型配置
        </Button>
        <SettingsCard divided={false}>
          <div className="space-y-3 px-4 py-10 text-center">
            <p className="text-sm font-medium text-destructive">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void loadConfiguration()}>
              <RotateCcw size={15} />
              重新读取
            </Button>
          </div>
        </SettingsCard>
      </div>
    )
  }

  const defaultModelOptions = models
    .filter(model => model.id.trim())
    .map(model => ({
      value: model.id,
      label: model.name?.trim() || model.id,
    }))

  return (
    <div className="space-y-7">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft size={16} />
          返回模型配置
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadConfiguration()}
            disabled={saving}
          >
            <RotateCcw size={15} />
            重新读取
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save size={15} />}
            保存配置
          </Button>
        </div>
      </div>

      <SettingsSection
        title="Claude Code Best"
        description="直接编辑 ~/.claude/settings.json 中的全局 Provider 和模型目录；Hooks、Plugins、权限等其他配置会原样保留。"
      >
        <SettingsCard>
          <SettingsSelect
            label="Provider 类型"
            description={getProviderDescription(modelType)}
            value={modelType}
            onValueChange={value => setModelType(value as CcbNativeModelType)}
            options={PROVIDER_OPTIONS}
          />
          <SettingsInput
            label="Base URL"
            description="留空使用 CCB 对应 Provider 的默认地址"
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder="https://api.example.com/v1"
          />
          <SettingsSecretInput
            label="API Key / Auth Token"
            description="密钥仅在 Main 进程与 CCB Runtime 之间传递"
            value={apiKey}
            onChange={setApiKey}
            placeholder="输入当前 Provider 的密钥"
          />
          <SettingsSelect
            label="默认模型"
            description="CCB CLI 和新建桌面会话默认使用的模型"
            value={defaultModel}
            onValueChange={setDefaultModel}
            options={defaultModelOptions}
            placeholder="请先添加模型"
            disabled={defaultModelOptions.length === 0}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="可用模型"
        description="模型 ID、Context Window 与思考等级会直接交给 CCB，由 CCB 内核解析最终能力。"
        action={
          <Button variant="outline" size="sm" onClick={addModel}>
            <Plus size={15} />
            添加模型
          </Button>
        }
      >
        {models.length === 0 ? (
          <SettingsCard divided={false}>
            <div className="py-12 text-center text-sm text-muted-foreground">
              暂无模型，点击“添加模型”开始配置
            </div>
          </SettingsCard>
        ) : (
          <div className="space-y-3">
            {models.map((model, index) => {
              const runtimeModel = runtimeCatalog
                ? findAgentRuntimeModel(runtimeCatalog.models, model.id)
                : undefined
              return (
                <SettingsCard key={model.formKey} divided={false}>
                  <div className="space-y-4 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Cpu size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {model.name?.trim() || model.id.trim() || `新模型 ${index + 1}`}
                          </p>
                          {model.id === defaultModel && model.id.trim() && (
                            <Badge className="mt-1 px-1.5 py-0 text-[10px]">默认</Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeModel(model.formKey)}
                      >
                        <Trash2 size={15} />
                        删除
                      </Button>
                    </div>

                    <CcbConfiguredModelEditor
                      value={model}
                      runtimeModel={runtimeModel}
                      onChange={patch => {
                        const previousId = model.id
                        updateModel(model.formKey, current => ({
                          ...current,
                          ...patch,
                        }))
                        if (
                          patch.id !== undefined
                          && defaultModel === previousId
                        ) {
                          setDefaultModel(patch.id)
                        }
                      }}
                    />
                  </div>
                </SettingsCard>
              )
            })}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
