import { useRef } from 'react'
import { RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { useEditor } from '@/hooks/use-editor'
import type { AudioElement, VideoElement } from '@/types/timeline'
import { AudioVolumeKeyframeControl } from './AudioVolumeKeyframeControl'
import { usePlaybackTime } from './playback-time'
import {
  createAudioVolumeUpdate,
  resolveAudioVolume,
  type AudioKeyframes,
  type AudioVolumeKeyframeSource
} from './audio-keyframes'

type AudioProperty = 'fadeIn' | 'fadeOut'
type AudioEditableElement = (VideoElement | AudioElement) &
  AudioVolumeKeyframeSource & {
    volume?: number
    fadeIn?: number
    fadeOut?: number
    muted?: boolean
  }

interface VolumeEditSnapshot {
  volume: number | undefined
  audioKeyframes: AudioKeyframes | undefined
  resolvedVolume: number
}

const MIN_DB = -60
const MAX_DB = 6

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function gainToDb(gain: number): number {
  if (gain <= 0) return MIN_DB
  return clamp(20 * Math.log10(gain), MIN_DB, MAX_DB)
}

function dbToGain(db: number): number {
  if (db <= MIN_DB) return 0
  return 10 ** (db / 20)
}

function displayNumber(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1)
}

export function ClipAudioProperties({
  element,
  trackId
}: {
  element: AudioEditableElement
  trackId: string
}) {
  const editor = useEditor()
  const editStart = useRef<Partial<Record<AudioProperty, number>>>({})
  const volumeEditStart = useRef<VolumeEditSnapshot | null>(null)
  const timelineTime = usePlaybackTime(editor.playback)
  const volume = resolveAudioVolume({ source: element, timelineTime })
  const fadeIn = clamp(element.fadeIn ?? 0, 0, element.duration)
  const fadeOut = clamp(element.fadeOut ?? 0, 0, element.duration)
  const volumeDb = gainToDb(volume)
  const fadeMax = Math.max(0.1, element.duration)

  const update = (updates: Partial<AudioEditableElement>, pushHistory: boolean) => {
    editor.timeline.updateElements({
      updates: [{ trackId, elementId: element.id, updates }],
      pushHistory
    })
  }

  const begin = (property: AudioProperty, value: number) => {
    if (editStart.current[property] === undefined) editStart.current[property] = value
  }

  const commit = (property: AudioProperty, value: number) => {
    const initial = editStart.current[property]
    delete editStart.current[property]
    if (initial === undefined || Math.abs(initial - value) < 0.000001) return
    update({ [property]: initial }, false)
    update({ [property]: value }, true)
  }

  const beginVolume = () => {
    volumeEditStart.current ??= {
      volume: element.volume,
      audioKeyframes: element.audioKeyframes,
      resolvedVolume: volume
    }
  }

  const changeVolume = (db: number) => {
    const gain = dbToGain(clamp(db, MIN_DB, MAX_DB))
    update(
      createAudioVolumeUpdate({
        source: element,
        timelineTime,
        value: gain
      }) as Partial<AudioEditableElement>,
      false
    )
    return gain
  }

  const commitVolume = (gain: number) => {
    const initial = volumeEditStart.current
    volumeEditStart.current = null
    if (!initial || Math.abs(initial.resolvedVolume - gain) < 0.000001) return
    const sourceAtStart = {
      ...element,
      volume: initial.volume,
      audioKeyframes: initial.audioKeyframes
    }
    const finalUpdate = createAudioVolumeUpdate({
      source: sourceAtStart,
      timelineTime,
      value: gain
    })
    update({ volume: initial.volume, audioKeyframes: initial.audioKeyframes }, false)
    update(finalUpdate as Partial<AudioEditableElement>, true)
  }

  const changeFade = (property: 'fadeIn' | 'fadeOut', value: number) => {
    const seconds = clamp(value, 0, element.duration)
    update({ [property]: seconds }, false)
    return seconds
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="border-border flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Volume2 className="size-3.5 text-sky-400" />
          基础
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-7 place-items-center rounded-sm"
          title="重置音频属性"
          aria-label="重置音频属性"
          onClick={() =>
            update({ volume: 1, audioKeyframes: {}, fadeIn: 0, fadeOut: 0, muted: false }, true)
          }
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>

      <div className="space-y-5 py-4">
        <div className="grid grid-cols-[6rem_minmax(0,1fr)_4.75rem_1.75rem] items-center gap-2">
          <div className="flex min-w-0 items-center">
            <label htmlFor={`clip-volume-${element.id}`} className="text-xs">
              音量
            </label>
            <AudioVolumeKeyframeControl editor={editor} element={element} trackId={trackId} />
          </div>
          <input
            id={`clip-volume-${element.id}`}
            type="range"
            min={MIN_DB}
            max={MAX_DB}
            step={0.1}
            value={volumeDb}
            className="h-1 min-w-0 accent-sky-500"
            onPointerDown={beginVolume}
            onKeyDown={beginVolume}
            onChange={(event) => {
              beginVolume()
              changeVolume(Number(event.currentTarget.value))
            }}
            onPointerUp={(event) =>
              commitVolume(dbToGain(clamp(Number(event.currentTarget.value), MIN_DB, MAX_DB)))
            }
            onKeyUp={(event) =>
              commitVolume(dbToGain(clamp(Number(event.currentTarget.value), MIN_DB, MAX_DB)))
            }
          />
          <div className="bg-accent flex h-7 items-center rounded-sm px-1.5">
            <input
              type="number"
              aria-label="音量分贝"
              min={MIN_DB}
              max={MAX_DB}
              step={0.1}
              value={displayNumber(volumeDb)}
              className="w-full min-w-0 bg-transparent text-right text-xs outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              onFocus={beginVolume}
              onChange={(event) => {
                const db = Number(event.currentTarget.value)
                if (Number.isFinite(db)) changeVolume(db)
              }}
              onBlur={(event) =>
                commitVolume(dbToGain(clamp(Number(event.currentTarget.value), MIN_DB, MAX_DB)))
              }
            />
            <span className="text-muted-foreground ml-1 text-[10px]">dB</span>
          </div>
          <button
            type="button"
            className={`grid size-7 place-items-center rounded-sm ${
              element.muted
                ? 'bg-sky-500/15 text-sky-400'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
            title={element.muted ? '取消静音' : '静音'}
            aria-label={element.muted ? '取消静音' : '静音'}
            aria-pressed={element.muted ?? false}
            onClick={() => update({ muted: !(element.muted ?? false) }, true)}
          >
            {element.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          </button>
        </div>

        {(
          [
            { property: 'fadeIn', label: '淡入时长', value: fadeIn },
            { property: 'fadeOut', label: '淡出时长', value: fadeOut }
          ] as const
        ).map(({ property, label, value }) => (
          <div
            key={property}
            className="grid grid-cols-[6rem_minmax(0,1fr)_4.75rem_1.75rem] items-center gap-2"
          >
            <label htmlFor={`clip-${property}-${element.id}`} className="text-xs">
              {label}
            </label>
            <input
              id={`clip-${property}-${element.id}`}
              type="range"
              min={0}
              max={fadeMax}
              step={0.1}
              value={value}
              className="h-1 min-w-0 accent-sky-500"
              onPointerDown={() => begin(property, value)}
              onKeyDown={() => begin(property, value)}
              onChange={(event) => {
                begin(property, value)
                changeFade(property, Number(event.currentTarget.value))
              }}
              onPointerUp={(event) => commit(property, Number(event.currentTarget.value))}
              onKeyUp={(event) => commit(property, Number(event.currentTarget.value))}
            />
            <div className="bg-accent flex h-7 items-center rounded-sm px-1.5">
              <input
                type="number"
                aria-label={label}
                min={0}
                max={element.duration}
                step={0.1}
                value={displayNumber(value)}
                className="w-full min-w-0 bg-transparent text-right text-xs outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                onFocus={() => begin(property, value)}
                onChange={(event) => {
                  const seconds = Number(event.currentTarget.value)
                  if (Number.isFinite(seconds)) changeFade(property, seconds)
                }}
                onBlur={(event) =>
                  commit(property, clamp(Number(event.currentTarget.value), 0, element.duration))
                }
              />
              <span className="text-muted-foreground ml-1 text-[10px]">s</span>
            </div>
            <span />
          </div>
        ))}
      </div>
    </div>
  )
}
