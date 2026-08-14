import * as React from 'react'
import {
  BookOpen,
  CheckCircle2,
  Cpu,
  GitBranch,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react'
import type {
  ModelCenterStatus,
  RuntimeCapability,
  RuntimeCapabilitySnapshot,
  RuntimeDefinition,
  RuntimeId,
  SystemPromptConfig,
} from '@proma/shared'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from './primitives'

const runtimeOrder: RuntimeId[] = ['pi', 'hermes', 'codex', 'claude']

const capabilityLabels: Record<RuntimeCapability, string> = {
  streaming: '流式输出',
  tools: '工具调用',
  approvals: '权限审批',
  steering: '实时引导',
  cancellation: '取消任务',
  sessionResume: '会话恢复',
  customModels: '自定义模型',
  managedCredentials: '统一凭证',
  contextUsage: '上下文用量',
  compaction: '上下文压缩',
  workTasks: '工作任务',
}

const runtimeRoles: Record<RuntimeId, string> = {
  pi: '固定基础内核',
  hermes: '动态调度内核',
  codex: '计划与审查 Harness',
  claude: '代码实施 Harness',
}

function capabilityLabel(
  snapshot: RuntimeCapabilitySnapshot | undefined,
  capability: RuntimeCapability,
): string {
  const support = snapshot?.capabilities[capability]
  if (support === 'supported') return '支持'
  if (support === 'partial') return '部分支持'
  if (support === 'unsupported') return '不支持'
  return '待运行时确认'
}

function runtimeIcon(runtimeId: RuntimeId): React.ReactElement {
  if (runtimeId === 'pi') return <Sparkles className="size-4" />
  if (runtimeId === 'hermes') return <Workflow className="size-4" />
  if (runtimeId === 'codex') return <GitBranch className="size-4" />
  return <Cpu className="size-4" />
}

function runtimeStatus(runtime: RuntimeDefinition): string {
  if (runtime.id === 'claude' && runtime.installation.source === 'bundled') return 'SDK 内置'
  if (runtime.installation.status === 'ready') return '执行就绪'
  if (runtime.installation.status === 'checking') return '检测中'
  if (runtime.installation.status === 'broken') return '需要检查'
  return '适配器已接入'
}

function runtimeStatusClass(runtime: RuntimeDefinition): string {
  if (runtime.installation.status === 'broken') return 'text-amber-600 dark:text-amber-400'
  if (runtime.installation.status === 'ready' || runtime.id !== 'claude') {
    return 'text-emerald-600 dark:text-emerald-400'
  }
  return 'text-muted-foreground'
}

export function RuntimeSettings(): React.ReactElement {
  const [runtimes, setRuntimes] = React.useState<RuntimeDefinition[]>([])
  const [capabilities, setCapabilities] = React.useState<Partial<Record<RuntimeId, RuntimeCapabilitySnapshot>>>({})
  const [modelCenter, setModelCenter] = React.useState<ModelCenterStatus | null>(null)
  const [systemPromptConfig, setSystemPromptConfig] = React.useState<SystemPromptConfig | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [nextRuntimes, nextModelCenter, nextSystemPromptConfig] = await Promise.all([
        window.electronAPI.refreshRuntimes(),
        window.electronAPI.getModelCenterStatus(),
        window.electronAPI.getSystemPromptConfig(),
      ])
      const nextCapabilities = await Promise.all(
        runtimeOrder.map(async (runtimeId): Promise<[RuntimeId, RuntimeCapabilitySnapshot]> => [
          runtimeId,
          await window.electronAPI.getRuntimeCapabilities(runtimeId),
        ]),
      )
      setRuntimes(nextRuntimes)
      setCapabilities(Object.fromEntries(nextCapabilities))
      setModelCenter(nextModelCenter)
      setSystemPromptConfig(nextSystemPromptConfig)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const defaultPrompt = systemPromptConfig?.prompts.find(
    (prompt) => prompt.id === systemPromptConfig.defaultPromptId,
  )

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Proma Runtime 中心"
        description="四个 Runtime 随 Proma 内置。Pi 始终作为基础内核，Hermes 根据策略动态调度 Codex 和 Claude Code；这里仅展示状态，不提供安装、激活、删除或路径绑定。"
        action={(
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            检测
          </Button>
        )}
      >
        <SettingsCard className="space-y-3 p-4">
          {error && (
            <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Runtime 检测部分失败：{error}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {runtimeOrder.map((runtimeId) => {
              const runtime = runtimes.find((item) => item.id === runtimeId)
              if (!runtime) return null
              const snapshot = capabilities[runtimeId]
              return (
                <div
                  key={runtimeId}
                  className="rounded-2xl bg-muted/35 p-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="rounded-lg bg-primary/10 p-2 text-primary">
                        {runtimeIcon(runtimeId)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium">{runtime.name}</div>
                        <div className="text-xs text-muted-foreground">{runtimeRoles[runtimeId]}</div>
                      </div>
                    </div>
                    <span className={`shrink-0 text-xs font-medium ${runtimeStatusClass(runtime)}`}>
                      {runtimeStatus(runtime)}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    {runtime.description}
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                    <span>
                      版本：{runtime.installation.version || '随 Proma 内置适配器'}
                    </span>
                  </div>
                  {runtimeId === 'claude' && (
                    <div className="mt-2 rounded-lg bg-primary/5 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                      Claude Code 使用内置 Claude Agent SDK 及当前平台原生包，不要求用户安装全局 Claude CLI。
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {runtime.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className="rounded-full bg-background/80 px-2 py-1 text-[10px] text-muted-foreground"
                        title={capabilityLabel(snapshot, capability)}
                      >
                        {capabilityLabels[capability]}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="统一运行时能力"
        description="Runtime 复用 Proma 现有模型中心、系统提示词、Profile、Memory、Skills、MCP 和右侧浏览器上下文。"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <SettingsCard className="p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-emerald-500" />
              模型中心
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {modelCenter?.connected
                ? `已连接，${modelCenter.usableModelCount} 个可用模型。四个 Runtime 共用当前渠道和模型配置。`
                : modelCenter?.error || '尚未配置可用模型，Runtime 将无法开始模型调用。'}
            </p>
          </SettingsCard>
          <SettingsCard className="p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <BookOpen className="size-4 text-primary" />
              System Prompt
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              当前使用：{defaultPrompt?.name || 'Proma 内置系统提示词'}。系统提示词在主进程统一编译后投影给 Pi、Hermes、Codex 和 Claude Code。
            </p>
          </SettingsCard>
          <SettingsCard className="p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Route className="size-4 text-primary" />
              Dispatch Policy
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">proma.hermes.dynamic.v1</span>
              {' '}是动态策略，不是固定 Workflow。简单对话留在 Pi，实施、计划和审查任务由 Hermes 按能力和依赖路由。
            </p>
          </SettingsCard>
        </div>
      </SettingsSection>

      <SettingsSection title="运行方式" description="Runtime 中心不承载工作流 UI，也不允许用户绕过策略手动切换 Harness。">
        <SettingsCard className="p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">Pi 基础内核</span>
            <span>→</span>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">Hermes 动态调度</span>
            <span>→</span>
            <span className="rounded-full bg-muted px-2.5 py-1">Codex / Claude Code Harness</span>
            <span>→</span>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">Pi 汇总</span>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
