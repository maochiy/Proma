import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { ChevronRight, Gauge } from 'lucide-react'
import type { ThinkingEffortLevel } from '@proma/shared'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  THINKING_EFFORT_LABELS,
  type AgentThinkingEffortCapability,
} from '@/lib/agent-thinking-effort'

interface AgentThinkingEffortControlProps {
  capability: AgentThinkingEffortCapability
  value: ThinkingEffortLevel
  expanded: boolean
  disabled?: boolean
  onValueChange: (value: ThinkingEffortLevel) => void
  onExpandedChange: (expanded: boolean) => void
}

interface CodexEffortSliderProps {
  levels: ThinkingEffortLevel[]
  value: number
  onValueChange: (value: number) => void
  onValueCommit: (value: number) => void
}

function CodexEffortSlider({
  levels,
  value,
  onValueChange,
  onValueCommit,
}: CodexEffortSliderProps): React.ReactElement {
  return (
    <SliderPrimitive.Root
      value={[value]}
      min={0}
      max={levels.length - 1}
      step={1}
      aria-label="思考等级"
      onValueChange={([nextValue]) => {
        if (nextValue !== undefined) onValueChange(nextValue)
      }}
      onValueCommit={([nextValue]) => {
        if (nextValue !== undefined) onValueCommit(nextValue)
      }}
      className="relative flex h-7 w-full touch-none select-none items-center"
    >
      <SliderPrimitive.Track className="relative h-7 w-full grow overflow-hidden rounded-full bg-[#e9e9e9] dark:bg-white/10">
        <SliderPrimitive.Range className="absolute h-full bg-transparent" />
        <span className="pointer-events-none absolute inset-x-3.5 top-1/2 flex -translate-y-1/2 justify-between">
          {levels.map((level) => (
            <span
              key={level}
              className="size-1 rounded-full bg-[#b7b7b7] dark:bg-white/30"
            />
          ))}
        </span>
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label="思考等级"
        className={cn(
          'block size-7 rounded-full border border-black/[0.06] bg-white',
          'shadow-[0_1px_4px_rgba(0,0,0,0.18)] transition-shadow',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
          'active:shadow-[0_1px_5px_rgba(0,0,0,0.24)]',
        )}
      />
    </SliderPrimitive.Root>
  )
}

export function AgentThinkingEffortControl({
  capability,
  value,
  expanded,
  disabled = false,
  onValueChange,
  onExpandedChange,
}: AgentThinkingEffortControlProps): React.ReactElement {
  const selectedIndex = Math.max(0, capability.levels.indexOf(value))
  const [previewIndex, setPreviewIndex] = React.useState(selectedIndex)

  React.useEffect(() => {
    setPreviewIndex(selectedIndex)
  }, [selectedIndex])

  const previewLevel = capability.levels[previewIndex] ?? value

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`思考等级：${THINKING_EFFORT_LABELS[value]}`}
          className={cn(
            'flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <Gauge className="size-3.5" />
          <span>{THINKING_EFFORT_LABELS[value]}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-56 p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium text-foreground/75">
            {THINKING_EFFORT_LABELS[previewLevel]}
          </span>
          <ChevronRight className="size-3.5 text-muted-foreground/55" />
        </div>

        <div className="py-1">
          <CodexEffortSlider
            levels={capability.levels}
            value={previewIndex}
            onValueChange={setPreviewIndex}
            onValueCommit={(index) => {
              const level = capability.levels[index]
              if (level) onValueChange(level)
            }}
          />
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-3">
          <span className="text-xs text-foreground/65">展开思考过程</span>
          <Switch
            checked={expanded}
            onCheckedChange={onExpandedChange}
            className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
