import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react'
import type { EditorCore } from '@/core'
import { usePlaybackTime } from './playback-time'
import {
  findVisualKeyframeAtTime,
  getNeighborVisualKeyframe,
  getVisualKeyframeTimes,
  getVisualLocalTime,
  toggleVisualKeyframe,
  type VisualKeyframeProperty,
  type VisualKeyframeSource
} from './visual-keyframes'
import { getClipMaskKeyframeTimes } from './clip-mask'
import { getClipAnimationMarkerTimes } from './clip-animations'
import { getAudioVolumeKeyframeTimes } from './audio-keyframes'
import { getColorAdjustmentKeyframeTimes } from './color-adjustment'

export function VisualKeyframeControl({
  editor,
  element,
  trackId,
  property,
  label
}: {
  editor: EditorCore
  element: VisualKeyframeSource & { id: string; startTime: number }
  trackId: string
  property: VisualKeyframeProperty
  label: string
}) {
  const currentTime = usePlaybackTime(editor.playback)
  const localTime = getVisualLocalTime({ source: element, timelineTime: currentTime })
  const keyframes = element.visualKeyframes?.[property]
  const isKeyframed = findVisualKeyframeAtTime({ keyframes, time: localTime }) >= 0
  const previous = getNeighborVisualKeyframe({
    source: element,
    property,
    timelineTime: currentTime,
    direction: 'previous'
  })
  const next = getNeighborVisualKeyframe({
    source: element,
    property,
    timelineTime: currentTime,
    direction: 'next'
  })

  const seek = (time: number | undefined) => {
    if (time === undefined) return
    editor.playback.seek({ time: element.startTime + time })
  }

  return (
    <span className="ml-1 inline-flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label={`上一个${label}关键帧`}
        title={`上一个${label}关键帧`}
        disabled={!previous}
        onClick={() => seek(previous?.time)}
        className="text-muted-foreground hover:text-foreground inline-flex size-4 items-center justify-center rounded-sm disabled:pointer-events-none disabled:opacity-20"
      >
        <ChevronLeft className="size-3" />
      </button>
      <button
        type="button"
        aria-label={isKeyframed ? `删除当前${label}关键帧` : `添加${label}关键帧`}
        title={isKeyframed ? `删除当前${label}关键帧` : `添加${label}关键帧`}
        data-visual-keyframe-property={property}
        data-visual-keyframe-active={isKeyframed ? 'true' : 'false'}
        onClick={() => {
          editor.timeline.updateElements({
            updates: [
              {
                trackId,
                elementId: element.id,
                updates: toggleVisualKeyframe({
                  source: element,
                  property,
                  timelineTime: currentTime
                })
              }
            ]
          })
        }}
        className={`inline-flex size-4 items-center justify-center rounded-sm transition-colors ${
          isKeyframed
            ? 'bg-sky-500/15 text-sky-500'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
      >
        <Diamond className={`size-2.5 ${isKeyframed ? 'fill-current' : ''}`} />
      </button>
      <button
        type="button"
        aria-label={`下一个${label}关键帧`}
        title={`下一个${label}关键帧`}
        disabled={!next}
        onClick={() => seek(next?.time)}
        className="text-muted-foreground hover:text-foreground inline-flex size-4 items-center justify-center rounded-sm disabled:pointer-events-none disabled:opacity-20"
      >
        <ChevronRight className="size-3" />
      </button>
      <span className="sr-only">{getVisualKeyframeTimes(element).length} 个视觉关键帧</span>
    </span>
  )
}

export function VisualKeyframeMarkers({
  editor,
  element
}: {
  editor: EditorCore
  element: VisualKeyframeSource & { startTime: number }
}) {
  const times = Array.from(
    new Set([
      ...getVisualKeyframeTimes(element),
      ...getAudioVolumeKeyframeTimes(element),
      ...getClipAnimationMarkerTimes({
        animations: element.clipAnimations,
        clipDuration: element.duration
      }),
      ...getClipMaskKeyframeTimes(
        (element as VisualKeyframeSource & { clipMask?: unknown }).clipMask
      ),
      ...getClipMaskKeyframeTimes(
        (element as VisualKeyframeSource & { colorAdjustmentMask?: unknown })
          .colorAdjustmentMask
      ),
      ...getColorAdjustmentKeyframeTimes(
        (element as VisualKeyframeSource & { colorAdjustment?: unknown }).colorAdjustment
      )
    ])
  ).sort((left, right) => left - right)
  if (times.length === 0 || element.duration <= 0) return null

  return (
    <span className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
      {times.map((time) => {
        const isCurrent =
          Math.abs(editor.playback.getCurrentTime() - (element.startTime + time)) <= 1 / 120
        return (
          <span
            key={time}
            className={`absolute bottom-1 size-2 -translate-x-1/2 rotate-45 border ${
              isCurrent ? 'border-sky-300 bg-sky-400' : 'border-sky-400/80 bg-sky-500/60'
            }`}
            style={{ left: `${Math.max(0, Math.min(100, (time / element.duration) * 100))}%` }}
          />
        )
      })}
    </span>
  )
}
