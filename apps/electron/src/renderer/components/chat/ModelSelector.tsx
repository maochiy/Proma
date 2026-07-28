/**
 * ModelSelector - 模型选择器（输入区内联 Popover）
 *
 * - 不打断当前任务，不使用模态弹窗
 * - 按渠道分组并支持搜索与键盘选择
 * - 触发按钮保持紧凑，适合放在输入区工具栏
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Check, ChevronDown, Cpu, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  conversationsAtom,
  selectedModelAtom,
  channelsAtom,
  channelsLoadedAtom,
  modelSelectorOpenAtom,
} from '@/atoms/chat-atoms'
import { useConversationModelOptional } from '@/hooks/useConversationSettings'
import { useConversationIdOptional } from '@/contexts/session-context'
import { getModelLogo, getChannelLogo, DefaultLogo } from '@/lib/model-logo'
import { cn } from '@/lib/utils'
import type { Channel, ModelOption, ProviderType } from '@proma/shared'
import { ChannelPlanQuotaBadge } from './ChannelPlanQuotaBadge'
import { RuntimeModelCapabilitySummary } from '@/components/agent/RuntimeModelCapabilitySummary'

/** 从渠道列表构建扁平化的模型选项 */
export function buildModelOptions(
  channels: Channel[],
  filterChannelId?: string,
  filterChannelIds?: string[],
  excludedProviders?: readonly ProviderType[],
): ModelOption[] {
  const options: ModelOption[] = []

  for (const channel of channels) {
    if (!channel.enabled) continue
    if (filterChannelId && channel.id !== filterChannelId) continue
    if (filterChannelIds && !filterChannelIds.includes(channel.id)) continue
    if (excludedProviders?.includes(channel.provider)) continue

    for (const model of channel.models) {
      if (!model.enabled) continue

      options.push({
        channelId: channel.id,
        channelName: channel.name,
        modelId: model.id,
        modelName: model.name,
        provider: channel.provider,
        thinkingEffortLevels: model.thinkingEffortLevels,
        defaultThinkingEffortLevel: model.defaultThinkingEffortLevel,
      })
    }
  }

  return options
}

/** 按渠道分组模型选项 */
function groupByChannel(options: ModelOption[]): Map<string, ModelOption[]> {
  const groups = new Map<string, ModelOption[]>()

  for (const option of options) {
    const key = option.channelId
    const group = groups.get(key) ?? []
    group.push(option)
    groups.set(key, group)
  }

  return groups
}

/** ModelSelector 可选属性 */
interface ModelSelectorProps {
  /** 仅显示此渠道的模型 */
  filterChannelId?: string
  /** 仅显示这些渠道的模型（多渠道过滤） */
  filterChannelIds?: string[]
  /** 外部选中模型（不传则用内部 selectedModelAtom） */
  externalSelectedModel?: { channelId: string; modelId: string } | null
  /** 外部选择回调 */
  onModelSelect?: (option: ModelOption) => void
  /** 触发按钮是否显示「渠道 · 模型」（默认只显示模型名） */
  showChannelInTrigger?: boolean
  /** 不在此选择器中显示的供应商（例如 Chat 暂不支持的协议） */
  excludedProviders?: readonly ProviderType[]
  /** 是否使用全局 modelSelectorOpenAtom 控制打开状态（用于外部拉起，如错误提示按钮） */
  useSharedOpenState?: boolean
  /** Agent 模式由 CCB Runtime 返回的模型选项；传入后不再从 Channel 模型配置构建列表 */
  runtimeModelOptions?: ModelOption[]
  /** CCB Runtime 模型目录是否仍在加载 */
  runtimeModelsLoading?: boolean
  /** 触发器仅显示文字和展开箭头，用于 Codex 风格输入区 */
  textOnlyTrigger?: boolean
}

export function ModelSelector({
  filterChannelId,
  filterChannelIds,
  externalSelectedModel,
  onModelSelect,
  showChannelInTrigger = false,
  excludedProviders,
  useSharedOpenState = false,
  runtimeModelOptions,
  runtimeModelsLoading = false,
  textOnlyTrigger = false,
}: ModelSelectorProps = {}): React.ReactElement {
  const [conversationModel, setConversationModel] = useConversationModelOptional()
  const conversationId = useConversationIdOptional()
  const setConversations = useSetAtom(conversationsAtom)
  const setGlobalModel = useSetAtom(selectedModelAtom)
  const channels = useAtomValue(channelsAtom)
  const channelsLoaded = useAtomValue(channelsLoadedAtom)
  const setChannels = useSetAtom(channelsAtom)
  const [localOpen, setLocalOpen] = React.useState(false)
  const [sharedOpen, setSharedOpen] = useAtom(modelSelectorOpenAtom)
  const open = useSharedOpenState ? sharedOpen : localOpen
  const setOpen = useSharedOpenState ? setSharedOpen : setLocalOpen
  const [search, setSearch] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  // 外部模型优先 → per-conversation 模型
  const selectedModel = externalSelectedModel !== undefined ? externalSelectedModel : conversationModel

  // 每次打开菜单时刷新渠道列表，确保最新
  React.useEffect(() => {
    if (open) {
      window.electronAPI.listChannels().then(setChannels).catch(console.error)
      setSearch('')
    }
  }, [open, setChannels])

  const modelOptions = React.useMemo(
    () => runtimeModelOptions
      ?? buildModelOptions(
        channels,
        filterChannelId,
        filterChannelIds,
        excludedProviders,
      ),
    [
      channels,
      excludedProviders,
      filterChannelId,
      filterChannelIds,
      runtimeModelOptions,
    ],
  )
  const grouped = React.useMemo(() => groupByChannel(modelOptions), [modelOptions])

  // 搜索过滤
  const filteredGrouped = React.useMemo(() => {
    if (!search.trim()) return grouped

    const query = search.toLowerCase()
    const filtered = new Map<string, ModelOption[]>()

    for (const [channelId, options] of grouped.entries()) {
      const matchedOptions = options.filter(
        (o) =>
          o.modelName.toLowerCase().includes(query) ||
          o.channelName.toLowerCase().includes(query)
      )
      if (matchedOptions.length > 0) {
        filtered.set(channelId, matchedOptions)
      }
    }

    return filtered
  }, [grouped, search])

  // 扁平化过滤后的模型列表，用于键盘导航
  const flatOptions = React.useMemo(() => {
    const result: ModelOption[] = []
    for (const options of filteredGrouped.values()) {
      result.push(...options)
    }
    return result
  }, [filteredGrouped])

  // 键盘高亮索引
  const [highlightIndex, setHighlightIndex] = React.useState(-1)
  const itemRefs = React.useRef<Map<number, HTMLButtonElement>>(new Map())

  // 搜索变化时重置高亮
  React.useEffect(() => {
    setHighlightIndex(-1)
  }, [search])

  // 高亮项变化时滚动到可见区域
  React.useEffect(() => {
    if (highlightIndex < 0) return
    const el = itemRefs.current.get(highlightIndex)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex])

  // 查找当前选中的模型信息
  const currentModelInfo = React.useMemo(() => {
    if (!selectedModel) return null
    const exact = modelOptions.find(
      (o) => o.channelId === selectedModel.channelId && o.modelId === selectedModel.modelId
    )
    if (exact || runtimeModelOptions === undefined) return exact ?? null

    const normalizedModelId = selectedModel.modelId.replace(/\[1m\]$/i, '')
    return modelOptions.find(
      (o) =>
        o.channelId === selectedModel.channelId
        && o.modelId === normalizedModelId,
    ) ?? null
  }, [selectedModel, modelOptions, runtimeModelOptions])

  // 保持上次有效的模型信息，避免渠道未加载时闪烁"选择模型"
  const stableModelInfoRef = React.useRef(currentModelInfo)
  if (currentModelInfo) stableModelInfoRef.current = currentModelInfo
  const displayModelInfo = currentModelInfo ?? stableModelInfoRef.current

  /** 选择模型并持久化到当前对话 */
  const handleSelect = (option: ModelOption): void => {
    if (onModelSelect) {
      onModelSelect(option)
      setOpen(false)
      return
    }

    // Chat 模式：写入 per-conversation Map + 同步全局默认值
    if (setConversationModel) {
      setConversationModel({ channelId: option.channelId, modelId: option.modelId })
    }
    setGlobalModel({ channelId: option.channelId, modelId: option.modelId })
    setOpen(false)

    // 将模型/渠道选择保存到当前对话元数据
    if (conversationId) {
      window.electronAPI
        .updateConversationModel(conversationId, option.modelId, option.channelId)
        .then((updated) => {
          setConversations((prev) =>
            prev.map((c) => (c.id === updated.id ? updated : c))
          )
        })
        .catch(console.error)
    }
  }

  /** 搜索框键盘导航 */
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (flatOptions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev < flatOptions.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev > 0 ? prev - 1 : flatOptions.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = flatOptions[highlightIndex >= 0 ? highlightIndex : 0]
      if (target) handleSelect(target)
    }
  }

  if (runtimeModelsLoading && modelOptions.length === 0) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
        <Cpu className="size-3.5 animate-pulse" />
        <span>加载模型...</span>
      </div>
    )
  }

  if ((runtimeModelOptions !== undefined || channelsLoaded) && modelOptions.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1">
        <Cpu className="size-3.5" />
        <span>暂无可用模型</span>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={displayModelInfo ? `当前模型：${displayModelInfo.modelName}` : '选择模型'}
          aria-expanded={open}
          className="model-selector-trigger flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
        >
          {!textOnlyTrigger && (
            displayModelInfo ? (
              runtimeModelOptions ? (
                <Cpu className="size-3.5 text-muted-foreground/80" />
              ) : (
                <img
                  src={getModelLogo(displayModelInfo.modelId, displayModelInfo.provider)}
                  alt=""
                  className="size-4 rounded object-cover"
                />
              )
            ) : (
              <Cpu className="size-3.5 text-muted-foreground/80" />
            )
          )}
          <span className="min-w-0 max-w-[160px] truncate">
            {displayModelInfo
              ? (showChannelInTrigger ? `${displayModelInfo.channelName} · ${displayModelInfo.modelName}` : displayModelInfo.modelName)
              : '选择模型'}
          </span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className={cn(
          'overflow-hidden p-0',
          runtimeModelOptions ? 'w-[292px]' : 'w-[320px]',
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          requestAnimationFrame(() => searchInputRef.current?.focus())
        }}
      >
        <div className="flex items-center gap-2 border-b border-border/55 px-3 py-2">
            <Search className="size-4 flex-shrink-0 text-muted-foreground/55" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="搜索模型..."
              className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </div>

          <div className="max-h-[360px] overflow-y-auto p-1.5 scrollbar-thin">
            {filteredGrouped.size === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                未找到模型
              </div>
            ) : (
              (() => {
                let flatIndex = 0
                return Array.from(filteredGrouped.entries()).map(([channelId, options]) => {
                const first = options[0]
                if (!first) return null
                const channel = channels.find((c) => c.id === channelId)

                return (
                  <div key={channelId} className="mb-1 last:mb-0">
                    <div className={cn(
                      'flex items-center gap-2 px-2',
                      runtimeModelOptions ? 'pb-1 pt-1.5' : 'py-1.5',
                    )}>
                      {runtimeModelOptions ? (
                        null
                      ) : (
                        <img
                          src={channel ? getChannelLogo(channel) : DefaultLogo}
                          alt=""
                          className="size-4 rounded object-cover"
                        />
                      )}
                      <span className={cn(
                        'min-w-0 truncate font-medium text-muted-foreground',
                        runtimeModelOptions
                          ? 'text-[10px] uppercase tracking-[0.08em]'
                          : 'text-[11px]',
                      )}>
                        {first.channelName}
                      </span>
                      {!runtimeModelOptions && channel
                        ? <ChannelPlanQuotaBadge channel={channel} />
                        : null}
                    </div>

                    {/* 该渠道下的模型列表 */}
                    {options.map((option) => {
                      const isSelected =
                        selectedModel?.channelId === option.channelId &&
                        selectedModel?.modelId === option.modelId
                      const currentFlatIndex = flatIndex++
                      const isHighlighted = currentFlatIndex === highlightIndex

                      return (
                        <button
                          key={`${option.channelId}:${option.modelId}`}
                          ref={(el) => {
                            if (el) itemRefs.current.set(currentFlatIndex, el)
                            else itemRefs.current.delete(currentFlatIndex)
                          }}
                          type="button"
                          onClick={() => handleSelect(option)}
                          onMouseEnter={() => setHighlightIndex(currentFlatIndex)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                            'hover:bg-accent',
                            isHighlighted && 'bg-accent',
                            isSelected && 'bg-accent/80'
                          )}
                        >
                          {runtimeModelOptions ? (
                            <span
                              aria-hidden
                              className={cn(
                                'size-1.5 shrink-0 rounded-full',
                                isSelected ? 'bg-foreground/75' : 'bg-muted-foreground/35',
                              )}
                            />
                          ) : (
                            <img
                              src={getModelLogo(option.modelId, option.provider)}
                              alt=""
                              className="size-4 flex-shrink-0 rounded object-cover"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className={cn(
                              'truncate text-sm',
                              isSelected ? 'font-medium text-foreground' : 'text-foreground/80',
                            )}>
                              {option.modelName}
                            </div>
                            <RuntimeModelCapabilitySummary
                              model={option.runtimeModelInfo}
                              compact
                            />
                          </div>
                          {isSelected && <Check className="size-3.5 shrink-0 text-foreground/65" />}
                        </button>
                      )
                    })}
                  </div>
                )
              })
              })()
            )}
          </div>
      </PopoverContent>
    </Popover>
  )
}
