/**
 * ChannelSettings - 渠道配置页
 *
 * 管理所有渠道的添加、编辑、删除与启用状态，并标识 CCB Runtime 可用性。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Cpu, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  CCB_NATIVE_CHANNEL_ID,
  PROVIDER_LABELS,
  isAgentCompatibleProvider,
} from '@proma/shared'
import type { CcbNativeModelConfiguration, Channel } from '@proma/shared'
import { getChannelLogo } from '@/lib/model-logo'
import { getEnabledAgentChannelIds } from '@/lib/agent-channel-selection'
import {
  agentChannelIdAtom,
  agentModelIdAtom,
  agentChannelIdsAtom,
} from '@/atoms/agent-atoms'
import { channelsAtom } from '@/atoms/chat-atoms'
import { SettingsSection, SettingsCard, SettingsRow } from './primitives'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ChannelForm } from './ChannelForm'
import { CcbNativeModelForm } from './CcbNativeModelForm'

/** 组件视图模式 */
type ViewMode = 'list' | 'create' | 'edit' | 'edit-ccb'

export function ChannelSettings(): React.ReactElement {
  const [channels, setChannels] = React.useState<Channel[]>([])
  const [viewMode, setViewMode] = React.useState<ViewMode>('list')
  const [editingChannel, setEditingChannel] = React.useState<Channel | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [agentChannelId, setAgentChannelId] = useAtom(agentChannelIdAtom)
  const [, setAgentModelId] = useAtom(agentModelIdAtom)
  const [agentChannelIds, setAgentChannelIds] = useAtom(agentChannelIdsAtom)
  const setGlobalChannels = useSetAtom(channelsAtom)
  const [deleteTarget, setDeleteTarget] = React.useState<Channel | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [nativeConfiguration, setNativeConfiguration] =
    React.useState<CcbNativeModelConfiguration | null>(null)
  const [nativeConfigurationLoading, setNativeConfigurationLoading] =
    React.useState(true)
  const agentChannelIdsRef = React.useRef(agentChannelIds)
  const agentChannelIdRef = React.useRef(agentChannelId)

  React.useEffect(() => {
    agentChannelIdsRef.current = agentChannelIds
  }, [agentChannelIds])

  React.useEffect(() => {
    agentChannelIdRef.current = agentChannelId
  }, [agentChannelId])

  /** 加载渠道列表 */
  const loadChannels = React.useCallback(async (): Promise<Channel[]> => {
    try {
      const list = await window.electronAPI.listChannels()
      setChannels(list)
      setGlobalChannels(list) // 同步到全局缓存
      return list
    } catch (error) {
      console.error('[渠道设置] 加载渠道列表失败:', error)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadChannels()
  }, [loadChannels])

  const loadNativeConfiguration = React.useCallback(async (): Promise<void> => {
    setNativeConfigurationLoading(true)
    try {
      setNativeConfiguration(
        await window.electronAPI.getCcbNativeModelConfiguration(),
      )
    } catch (error) {
      console.error('[模型配置] 读取 CCB 原生配置失败:', error)
      setNativeConfiguration(null)
    } finally {
      setNativeConfigurationLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadNativeConfiguration()
  }, [loadNativeConfiguration])

  // CCB 一次只支持一个 Provider。Proma 可以保存多个预设，但启用状态必须互斥。
  React.useEffect(() => {
    if (loading) return
    const derivedIds = getEnabledAgentChannelIds(channels)
    const preferredId =
      agentChannelIdRef.current && derivedIds.includes(agentChannelIdRef.current)
        ? agentChannelIdRef.current
        : derivedIds[0]
    const exclusiveIds = preferredId ? [preferredId] : []
    const currentIds = agentChannelIdsRef.current
    const unchanged = exclusiveIds.length === currentIds.length
      && exclusiveIds.every((id, index) => id === currentIds[index])
    if (!unchanged) {
      agentChannelIdsRef.current = exclusiveIds
      setAgentChannelIds(exclusiveIds)
    }

    if (derivedIds.length > 1) {
      void Promise.all(
        channels
          .filter(channel => channel.enabled && channel.id !== preferredId)
          .map(channel => window.electronAPI.updateChannel(channel.id, { enabled: false })),
      ).then(() => loadChannels()).catch(error => {
        console.error('[模型配置] 清理旧版多渠道启用状态失败:', error)
      })
    }

    const selectedId = exclusiveIds[0] ?? CCB_NATIVE_CHANNEL_ID
    const selectionChanged = agentChannelIdRef.current !== selectedId
    if (selectionChanged) {
      agentChannelIdRef.current = selectedId
      setAgentChannelId(selectedId)
      setAgentModelId(null)
    }
    if (!unchanged || selectionChanged) {
      window.electronAPI.updateSettings({
        agentChannelIds: exclusiveIds,
        agentChannelId: selectedId,
        ...(selectionChanged ? { agentModelId: undefined } : {}),
      }).catch(console.error)
    }
  }, [
    channels,
    loading,
    loadChannels,
    setAgentChannelId,
    setAgentChannelIds,
    setAgentModelId,
  ])

  const syncAgentChannelEligibility = React.useCallback(async (
    channel: Channel,
    eligible: boolean,
  ): Promise<void> => {
    if (eligible) {
      const newIds = [channel.id]
      agentChannelIdsRef.current = newIds
      setAgentChannelIds(newIds)
      agentChannelIdRef.current = channel.id
      setAgentChannelId(channel.id)
      setAgentModelId(null)
      await window.electronAPI.updateSettings({
        agentChannelIds: newIds,
        agentChannelId: channel.id,
        agentModelId: undefined,
      }).catch(console.error)
      return
    }

    if (agentChannelIdRef.current === channel.id) {
      agentChannelIdsRef.current = []
      setAgentChannelIds([])
      agentChannelIdRef.current = CCB_NATIVE_CHANNEL_ID
      setAgentChannelId(CCB_NATIVE_CHANNEL_ID)
      setAgentModelId(null)
      await window.electronAPI.updateSettings({
        agentChannelIds: [],
        agentChannelId: CCB_NATIVE_CHANNEL_ID,
        agentModelId: undefined,
      }).catch(console.error)
    }
  }, [setAgentChannelIds, setAgentChannelId, setAgentModelId])

  /** 删除渠道（通过弹窗确认） */
  const handleDeleteRequest = (channel: Channel): void => {
    setDeleteTarget(channel)
  }

  /** 确认删除 */
  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteTarget || deleting) return
    const target = deleteTarget
    setDeleting(true)
    try {
      await window.electronAPI.deleteChannel(target.id)

      if (agentChannelId === target.id) {
        agentChannelIdsRef.current = []
        setAgentChannelIds([])
        agentChannelIdRef.current = CCB_NATIVE_CHANNEL_ID
        setAgentChannelId(CCB_NATIVE_CHANNEL_ID)
        setAgentModelId(null)
        await window.electronAPI.updateSettings({
          agentChannelIds: [],
          agentChannelId: CCB_NATIVE_CHANNEL_ID,
          agentModelId: undefined,
        })
      }

      await loadChannels()
      setDeleteTarget(null)
      toast.success(`已删除模型配置「${target.name}」`)
    } catch (error) {
      console.error('[渠道设置] 删除渠道失败:', error)
      toast.error(
        error instanceof Error && error.message
          ? `删除失败：${error.message}`
          : '删除模型配置失败，请重试',
      )
    } finally {
      setDeleting(false)
    }
  }

  /** 切换渠道启用状态 */
  const handleToggle = async (channel: Channel): Promise<void> => {
    try {
      const savedChannel = await window.electronAPI.updateChannel(channel.id, { enabled: !channel.enabled })
      await syncAgentChannelEligibility(
        savedChannel,
        savedChannel.enabled && isAgentCompatibleProvider(savedChannel.provider),
      )

      await loadChannels()
    } catch (error) {
      console.error('[渠道设置] 切换渠道状态失败:', error)
    }
  }

  const handleActivateNativeConfiguration = async (): Promise<void> => {
    try {
      await Promise.all(
        channels
          .filter(channel => channel.enabled)
          .map(channel => window.electronAPI.updateChannel(channel.id, { enabled: false })),
      )
      agentChannelIdsRef.current = []
      setAgentChannelIds([])
      agentChannelIdRef.current = CCB_NATIVE_CHANNEL_ID
      setAgentChannelId(CCB_NATIVE_CHANNEL_ID)
      setAgentModelId(null)
      await window.electronAPI.updateSettings({
        agentChannelIds: [],
        agentChannelId: CCB_NATIVE_CHANNEL_ID,
        agentModelId: undefined,
      })
      await loadChannels()
    } catch (error) {
      console.error('[模型配置] 启用 CCB 原生配置失败:', error)
    }
  }

  /** 表单保存回调 */
  const handleFormSaved = async (savedChannel?: Channel): Promise<void> => {
    if (
      savedChannel
      && savedChannel.enabled
      && isAgentCompatibleProvider(savedChannel.provider)
    ) {
      await syncAgentChannelEligibility(savedChannel, true)
    }
    setViewMode('list')
    setEditingChannel(null)
    await loadChannels()
  }

  const handleNativeFormSaved = async (): Promise<void> => {
    setViewMode('list')
    await loadNativeConfiguration()
  }

  /** 取消表单 */
  const handleFormCancel = (): void => {
    setViewMode('list')
    setEditingChannel(null)
  }

  // 表单视图
  if (viewMode === 'edit-ccb') {
    return (
      <CcbNativeModelForm
        onSaved={handleNativeFormSaved}
        onCancel={handleFormCancel}
      />
    )
  }

  if (viewMode === 'create' || viewMode === 'edit') {
    return (
      <ChannelForm
        channel={editingChannel}
        onSaved={handleFormSaved}
        onAgentEligibilityChange={syncAgentChannelEligibility}
        onCancel={handleFormCancel}
      />
    )
  }

  // 列表视图
  return (
    <div className="space-y-8">
      <SettingsSection
        title="模型配置"
        description="可保存多个供应商配置，但 CCB 同一时间只会启用其中一个。CCB 原生配置与 CLI 共用。"
        action={
          <Button size="sm" onClick={() => setViewMode('create')}>
            <Plus size={16} />
            <span>添加配置</span>
          </Button>
        }
      >
        {loading && nativeConfigurationLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
        ) : (
          <SettingsCard>
            <NativeConfigurationRow
              configuration={nativeConfiguration}
              loading={nativeConfigurationLoading}
              active={
                agentChannelId === CCB_NATIVE_CHANNEL_ID
                || (!agentChannelId && channels.every(channel => !channel.enabled))
              }
              onEdit={() => setViewMode('edit-ccb')}
              onActivate={() => void handleActivateNativeConfiguration()}
            />
            {channels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                active={agentChannelId === channel.id && channel.enabled}
                onEdit={() => {
                  setEditingChannel(channel)
                  setViewMode('edit')
                }}
                onDelete={() => handleDeleteRequest(channel)}
                onToggle={() => handleToggle(channel)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      {/* 删除确认弹窗 */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除渠道？</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除渠道「{deleteTarget?.name}」？此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void handleDeleteConfirm()
              }}
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ===== 配置行子组件 =====

interface NativeConfigurationRowProps {
  configuration: CcbNativeModelConfiguration | null
  loading: boolean
  active: boolean
  onEdit: () => void
  onActivate: () => void
}

function NativeConfigurationRow({
  configuration,
  loading,
  active,
  onEdit,
  onActivate,
}: NativeConfigurationRowProps): React.ReactElement {
  const providerLabel = configuration
    ? PROVIDER_LABELS[
        configuration.modelType === 'gemini'
          ? 'google'
          : configuration.modelType === 'grok'
            ? 'openai'
            : configuration.modelType
      ]
    : '配置读取失败'
  const description = loading
    ? '正在读取 ~/.claude/settings.json'
    : [
        providerLabel,
        configuration ? `${configuration.models.length} 个模型` : undefined,
        configuration?.defaultModel
          ? `默认 ${configuration.defaultModel}`
          : undefined,
      ].filter(Boolean).join(' · ')

  return (
    <SettingsRow
      label="Claude Code Best"
      icon={
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Cpu size={16} />
        </div>
      }
      description={
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{description}</span>
          <Badge
            variant="outline"
            className="px-1.5 py-0 text-[10px] font-medium leading-5"
          >
            CLI 共用
          </Badge>
        </div>
      }
      className="group"
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onEdit}
          className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-colors hover:bg-muted/50 hover:text-foreground group-hover:opacity-100"
          title="编辑 CCB 原生配置"
        >
          <Pencil size={14} />
        </button>
        <Switch
          checked={active}
          onCheckedChange={checked => {
            if (checked) onActivate()
          }}
          aria-label="启用 CCB 原生配置"
        />
      </div>
    </SettingsRow>
  )
}

interface ChannelRowProps {
  channel: Channel
  active: boolean
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}

function ChannelRow({
  channel,
  active,
  onEdit,
  onDelete,
  onToggle,
}: ChannelRowProps): React.ReactElement {
  const enabledCount = channel.models.filter((m) => m.enabled).length
  const description = [
    PROVIDER_LABELS[channel.provider],
    enabledCount > 0 ? `${enabledCount} 个模型已启用` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <SettingsRow
      label={channel.name}
      icon={<img src={getChannelLogo(channel)} alt="" className="w-8 h-8 rounded" />}
      description={
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{description}</span>
          <CcbRuntimeChip provider={channel.provider} />
        </div>
      }
      className="group"
    >
      <div className="flex items-center gap-2">
        {/* 操作按钮 */}
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors opacity-0 group-hover:opacity-100"
          title="编辑"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
          title="删除"
        >
          <Trash2 size={14} />
        </button>

        {/* 启用/关闭开关 */}
        <Switch
          checked={active}
          onCheckedChange={onToggle}
          aria-label={`启用模型配置 ${channel.name}`}
        />
      </div>
    </SettingsRow>
  )
}

function CcbRuntimeChip({ provider }: Pick<Channel, 'provider'>): React.ReactElement | null {
  if (!isAgentCompatibleProvider(provider)) return null

  return (
    <div className="inline-flex items-center gap-1" aria-label="支持 CCB Desktop Runtime">
      <Badge
        variant="outline"
        className="px-1.5 py-0 text-[10px] font-medium leading-5"
        title="Claude Code Best Desktop Runtime"
      >
        CCB
      </Badge>
    </div>
  )
}
