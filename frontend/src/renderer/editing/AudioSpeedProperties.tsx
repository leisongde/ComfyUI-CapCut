import { useReducer, useRef } from 'react'
import { Gauge, RotateCcw } from 'lucide-react'
import { useEditor } from '@/hooks/use-editor'
import {
  captureFollowingElements,
  createRippleUpdates
} from '@/lib/timeline/ripple-utils'
import { SPEED_PRESETS, formatSpeedLabel } from '@/lib/timeline/speed-utils'
import type { AudioElement } from '@/types/timeline'

const MIN_SPEED = 0.25
const MAX_SPEED = 4

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function AudioSpeedProperties({
  element,
  trackId
}: {
  element: AudioElement
  trackId: string
}) {
  const editor = useEditor()
  const [, forceRender] = useReducer((value: number) => value + 1, 0)
  const initialSpeed = useRef<number | null>(null)
  const speedDraft = useRef('')
  const isEditing = useRef(false)
  const currentSpeed = element.playbackRate ?? 1
  const speedDisplay = isEditing.current
    ? speedDraft.current
    : formatSpeedLabel({ rate: currentSpeed })

  const applySpeedChange = (newRate: number, pushHistory: boolean) => {
    const liveTrack = editor.timeline.getTrackById({ trackId })
    const liveElement = liveTrack?.elements.find((candidate) => candidate.id === element.id)
    if (!liveTrack || !liveElement || liveElement.type !== 'audio') return

    const rate = clamp(newRate, MIN_SPEED, MAX_SPEED)
    const oldRate = liveElement.playbackRate ?? 1
    if (Math.abs(oldRate - rate) < 0.000001) return

    const newDuration = liveElement.duration * (oldRate / rate)
    const followingElements = captureFollowingElements({
      track: liveTrack,
      elementId: liveElement.id
    })

    editor.timeline.updateElements({
      updates: [
        {
          trackId,
          elementId: liveElement.id,
          updates: { playbackRate: rate, duration: newDuration }
        },
        ...createRippleUpdates({
          trackId,
          elements: followingElements,
          timeDelta: newDuration - liveElement.duration,
          minimumStartTime: liveElement.startTime + newDuration
        })
      ],
      pushHistory
    })
  }

  const applyPreset = (rate: number) => {
    applySpeedChange(rate, true)
  }

  const beginCustomEdit = () => {
    if (initialSpeed.current === null) initialSpeed.current = currentSpeed
  }

  const commitCustomEdit = () => {
    const originalRate = initialSpeed.current
    const parsedRate = Number.parseFloat(speedDraft.current)
    const finalRate = Number.isFinite(parsedRate)
      ? clamp(parsedRate, MIN_SPEED, MAX_SPEED)
      : currentSpeed

    if (originalRate !== null) {
      applySpeedChange(originalRate, false)
      applySpeedChange(finalRate, true)
    }

    initialSpeed.current = null
    isEditing.current = false
    speedDraft.current = ''
    forceRender()
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="border-border flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Gauge className="size-3.5 text-sky-400" />
          变速
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-7 place-items-center rounded-sm"
          title="恢复正常速度"
          aria-label="恢复正常速度"
          onClick={() => applyPreset(1)}
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>

      <div className="space-y-5 py-4">
        <div className="space-y-2">
          <div className="text-xs">播放速度</div>
          <div className="grid grid-cols-4 gap-1.5">
            {SPEED_PRESETS.map((preset) => {
              const isActive = Math.abs(currentSpeed - preset.value) < 0.001
              return (
                <button
                  key={preset.value}
                  type="button"
                  aria-pressed={isActive}
                  className={`h-7 rounded-sm px-1 text-xs transition-colors ${
                    isActive
                      ? 'bg-sky-500/15 text-sky-400'
                      : 'bg-accent text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => applyPreset(preset.value)}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
          <label htmlFor={`audio-speed-${element.id}`} className="text-xs">
            自定义
          </label>
          <div className="bg-accent flex h-7 items-center rounded-sm px-2">
            <input
              id={`audio-speed-${element.id}`}
              type="number"
              min={MIN_SPEED}
              max={MAX_SPEED}
              step={0.05}
              value={speedDisplay}
              className="w-full min-w-0 bg-transparent text-right text-xs outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              onFocus={() => {
                isEditing.current = true
                speedDraft.current = formatSpeedLabel({ rate: currentSpeed })
                forceRender()
              }}
              onChange={(event) => {
                beginCustomEdit()
                speedDraft.current = event.currentTarget.value
                const parsedRate = Number.parseFloat(event.currentTarget.value)
                if (Number.isFinite(parsedRate)) applySpeedChange(parsedRate, false)
                forceRender()
              }}
              onBlur={commitCustomEdit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
            <span className="text-muted-foreground ml-1 text-[10px]">x</span>
          </div>
        </div>
      </div>
    </div>
  )
}
