import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react'
import type { EditorCore } from '@/core'
import { usePlaybackTime } from './playback-time'
import {
  findAudioVolumeKeyframeAtTime,
  getAudioLocalTime,
  getNeighborAudioVolumeKeyframe,
  toggleAudioVolumeKeyframe,
  type AudioVolumeKeyframeSource
} from './audio-keyframes'

export function AudioVolumeKeyframeControl({
  editor,
  element,
  trackId
}: {
  editor: EditorCore
  element: AudioVolumeKeyframeSource & { id: string; startTime: number }
  trackId: string
}) {
  const currentTime = usePlaybackTime(editor.playback)
  const localTime = getAudioLocalTime({ source: element, timelineTime: currentTime })
  const isKeyframed =
    findAudioVolumeKeyframeAtTime({
      keyframes: element.audioKeyframes?.volume,
      time: localTime
    }) >= 0
  const previous = getNeighborAudioVolumeKeyframe({
    source: element,
    timelineTime: currentTime,
    direction: 'previous'
  })
  const next = getNeighborAudioVolumeKeyframe({
    source: element,
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
        aria-label="上一个音量关键帧"
        title="上一个音量关键帧"
        disabled={!previous}
        onClick={() => seek(previous?.time)}
        className="text-muted-foreground hover:text-foreground inline-flex size-4 items-center justify-center rounded-sm disabled:pointer-events-none disabled:opacity-20"
      >
        <ChevronLeft className="size-3" />
      </button>
      <button
        type="button"
        aria-label={isKeyframed ? '删除当前音量关键帧' : '添加音量关键帧'}
        title={isKeyframed ? '删除当前音量关键帧' : '添加音量关键帧'}
        data-audio-keyframe-property="volume"
        data-audio-keyframe-active={isKeyframed ? 'true' : 'false'}
        onClick={() => {
          editor.timeline.updateElements({
            updates: [
              {
                trackId,
                elementId: element.id,
                updates: toggleAudioVolumeKeyframe({ source: element, timelineTime: currentTime })
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
        aria-label="下一个音量关键帧"
        title="下一个音量关键帧"
        disabled={!next}
        onClick={() => seek(next?.time)}
        className="text-muted-foreground hover:text-foreground inline-flex size-4 items-center justify-center rounded-sm disabled:pointer-events-none disabled:opacity-20"
      >
        <ChevronRight className="size-3" />
      </button>
    </span>
  )
}
