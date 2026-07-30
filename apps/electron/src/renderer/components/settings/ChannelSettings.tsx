/**
 * ChannelSettings - 渠道配置页
 *
 * 管理 App 侧渠道的添加、编辑、删除与启用状态。
 * CLI 共用配置（~/.claude/settings.json）不在此展示；App 登录会单独创建模型配置。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  PROVIDER_LABELS,
  isAgentCompatibleProvider,
} from '@proma/shared'
import type { Channel } from '@proma/shared'
import { getChannelLogo } from '@/lib/model-logo'
import { getEnabledAgentChannelIds } from '@/lib/agent-channel-selection'
import { resolveAgentSessionModelBinding } from '@/lib/agent-model-configuration'
import {
  agentChannelIdAtom,
  agentModelIdAtom,
  agentChannelIdsAtom,
  agentRuntimeModelCatalogsAtom,
  agentRuntimeModelCatalogRevisionAtom,
  agentSessionsAtom,
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

/** 组件视图模式 */
type ViewMode = 'list' | 'create' | 'edit'

export function ChannelSettings(): React.ReactElement {
  const [channels, setChannels] = React.useState<Channel[]>([])
  const [viewMode, setViewMode] = React.useState<ViewMode>('list')
  const [editingChannel, setEditingChannel] = React.useState<Channel | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [agentChannelId, setAgentChannelId] = useAtom(agentChannelIdAtom)
  const [, setAgentModelId] = useAtom(agentModelIdAtom)
  const [agentChannelIds, setAgentChannelIds] = useAtom(agentChannelIdsAtom)
  const setGlobalChannels = useSetAtom(channelsAtom)
  const refreshRuntimeModelCatalog = useSetAtom(
    agentRuntimeModelCatalogRevisionAtom,
  )
  const setRuntimeModelCatalogs = useSetAtom(agentRuntimeModelCatalogsAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const [deleteTarget, setDeleteTarget] = React.useState<Channel | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const agentChannelIdsRef = React.useRef(agentChannelIds)
  const agentChannelIdRef = React.useRef(agentChannelId)

  React.useEffect(() => {
    agentChannelIdsRef.current = agentChannelIds
  }, [agentChannelIds])

  React.useEffect(() => {
    agentChannelIdRef.current = agentChannelId
  }, [agentChannelId])

  /** 清除所有项目的旧模型目录，并通知已打开与新建会话重新向 CCB 读取。 */
  const invalidateRendererModelCatalogs = React.useCallback((): void => {
    setRuntimeModelCatalogs(new Map())
    refreshRuntimeModelCatalog(revision => revision + 1)
  }, [refreshRuntimeModelCatalog, setRuntimeModelCatalogs])

  /**
   * CCB Desktop 同一时间只启用一个 Provider，因此切换配置时同步现有会话绑定。
   * 运行中的 Turn 不受影响，更新后的绑定从下一轮开始使用。
   */
  const synchronizeSessionsToChannel = React.useCallback(async (
    channelId: string,
    modelIds: string[],
    defaultModelId?: string,
  ): Promise<void> => {
    const sessions = await window.electronAPI.listAgentSessions()
    const synchronized = await Promise.all(sessions.map(async session => {
      const binding = resolveAgentSessionModelBinding(
        session,
        channelId,
        modelIds,
        defaultModelId,
      )
      if (
        session.channelId === binding.channelId
        && session.modelId === binding.modelId
      ) {
        return session
      }
      return window.electronAPI.updateAgentSessionModel(
        session.id,
        binding.channelId,
        binding.modelId,
      )
    }))
    setAgentSessions(synchronized)
  }, [setAgentSessions])

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
  }, [setGlobalChannels])

  React.useEffect(() => {
    void loadChannels()
  }, [loadChannels])

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

    // 无 App 渠道时运行时仍回退 CLI 配置，但 UI 不再单独展示该条目
    const selectedId = exclusiveIds[0] ?? null
    const selectionChanged = agentChannelIdRef.current !== selectedId
    if (selectionChanged) {
      agentChannelIdRef.current = selectedId
      setAgentChannelId(selectedId)
      setAgentModelId(null)
    }
    if (!unchanged || selectionChanged) {
      window.electronAPI.updateSettings({
        agentChannelIds: exclusiveIds,
        agentChannelId: selectedId ?? undefined,
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
      const enabledModelIds = channel.models
        .filter(model => model.enabled)
        .map(model => model.id)
      await synchronizeSessionsToChannel(
        channel.id,
        enabledModelIds,
        channel.defaultModelId,
      )
      return
    }

    if (agentChannelIdRef.current === channel.id) {
      agentChannelIdsRef.current = []
      setAgentChannelIds([])
      agentChannelIdRef.current = null
      setAgentChannelId(null)
      setAgentModelId(null)
      await window.electronAPI.updateSettings({
        agentChannelIds: [],
        agentChannelId: undefined,
        agentModelId: undefined,
      }).catch(console.error)
    }
  }, [
    setAgentChannelIds,
    setAgentChannelId,
    setAgentModelId,
    synchronizeSessionsToChannel,
  ])

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
        agentChannelIdRef.current = null
        setAgentChannelId(null)
        setAgentModelId(null)
        await window.electronAPI.updateSettings({
          agentChannelIds: [],
          agentChannelId: undefined,
          agentModelId: undefined,
        })
      }

      await loadChannels()
      invalidateRendererModelCatalogs()
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

  /** 切换渠道启用状态；允许全部关闭，会话侧再提示无可用模型。 */
  const handleToggle = async (channel: Channel): Promise<void> => {
    try {
      const savedChannel = await window.electronAPI.updateChannel(channel.id, { enabled: !channel.enabled })
      await syncAgentChannelEligibility(
        savedChannel,
        savedChannel.enabled && isAgentCompatibleProvider(savedChannel.provider),
      )

      await loadChannels()
      invalidateRendererModelCatalogs()
    } catch (error) {
      console.error('[渠道设置] 切换渠道状态失败:', error)
      toast.error('切换模型配置失败，请重试')
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
    invalidateRendererModelCatalogs()
  }

  /** 取消表单 */
  const handleFormCancel = (): void => {
    setViewMode('list')
    setEditingChannel(null)
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

  // 列表视图：仅展示 App 创建/登录生成的模型配置
  return (
    <div className="space-y-8">
      <SettingsSection
        title="模型配置"
        description="可保存多个供应商配置，但 CCB 同一时间只会启用其中一个。"
        action={
          <Button size="sm" onClick={() => setViewMode('create')}>
            <Plus size={16} />
            <span>添加配置</span>
          </Button>
        }
      >
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
        ) : channels.length === 0 ? (
          <SettingsCard>
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              暂无模型配置。登录账号或点击「添加配置」创建。
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard>
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
    channel.defaultModelId ? `默认 ${channel.defaultModelId}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <SettingsRow
      label={channel.name}
      icon={<img src={getChannelLogo(channel)} alt="" className="w-8 h-8 rounded" />}
      description={description}
      className="group"
    >
      <div className="flex items-center gap-2">
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

        <Switch
          checked={active}
          onCheckedChange={onToggle}
          aria-label={`启用模型配置 ${channel.name}`}
        />
      </div>
    </SettingsRow>
  )
}
