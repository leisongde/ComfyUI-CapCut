import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleSlash, Play, Search, Trash2 } from 'lucide-react'
import { useEditor } from '@/hooks/use-editor'
import type { ImageElement, VideoElement } from '@/types/timeline'
import {
  CLIP_ANIMATION_CATEGORIES,
  CLIP_ANIMATION_CATEGORY_LABELS,
  getClipAnimationDurationBounds,
  getClipAnimationPreset,
  getClipAnimationPresets,
  normalizeClipAnimations,
  setClipAnimation,
  type ClipAnimationCategory,
  type ClipAnimations
} from './clip-animations'

type AnimatedClipElement = (VideoElement | ImageElement) & {
  clipAnimations?: ClipAnimations
}

function displayDuration(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1)
}

export function ClipAnimationsProperties({
  element,
  trackId
}: {
  element: AnimatedClipElement
  trackId: string
}) {
  const editor = useEditor()
  const [category, setCategory] = useState<ClipAnimationCategory>('in')
  const [query, setQuery] = useState('')
  const durationStart = useRef<number | null>(null)
  const previewTimer = useRef<number | null>(null)
  const animations = normalizeClipAnimations(element.clipAnimations, element.duration)
  const selection = animations?.[category]
  const selectedPreset = getClipAnimationPreset(selection?.presetId)
  const durationBounds = selectedPreset
    ? getClipAnimationDurationBounds({ preset: selectedPreset, clipDuration: element.duration })
    : null
  const presets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
    return getClipAnimationPresets(category).filter(
      (preset) =>
        !normalizedQuery || preset.name.toLocaleLowerCase('zh-CN').includes(normalizedQuery)
    )
  }, [category, query])

  useEffect(
    () => () => {
      if (previewTimer.current === null) return
      window.clearTimeout(previewTimer.current)
      previewTimer.current = null
      editor.playback.pause()
    },
    [editor]
  )

  const updateAnimations = (next: ClipAnimations | undefined, pushHistory: boolean) => {
    editor.timeline.updateElements({
      updates: [
        {
          trackId,
          elementId: element.id,
          updates: { clipAnimations: next } as Partial<AnimatedClipElement>
        }
      ],
      pushHistory
    })
  }

  const preview = (targetCategory: ClipAnimationCategory, animationDuration: number) => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
    editor.playback.pause()
    const previewDuration = Math.min(
      element.duration,
      targetCategory === 'combo' ? animationDuration : Math.max(0.2, animationDuration)
    )
    const startTime =
      targetCategory === 'out'
        ? element.startTime + Math.max(0, element.duration - previewDuration)
        : element.startTime
    const endTime = Math.min(element.startTime + element.duration, startTime + previewDuration)
    editor.playback.seek({ time: startTime })
    window.requestAnimationFrame(() => editor.playback.play())
    previewTimer.current = window.setTimeout(
      () => {
        editor.playback.pause()
        editor.playback.seek({ time: endTime })
        previewTimer.current = null
      },
      previewDuration * 1000 + 60
    )
  }

  const applyPreset = (presetId: string | undefined) => {
    const next = setClipAnimation({
      animations,
      category,
      presetId,
      clipDuration: element.duration
    })
    updateAnimations(next, true)
    const applied = next?.[category]
    if (applied) preview(category, applied.duration)
  }

  const updateDuration = (duration: number, pushHistory: boolean) => {
    if (!selection) return
    updateAnimations(
      setClipAnimation({
        animations,
        category,
        presetId: selection.presetId,
        duration,
        clipDuration: element.duration
      }),
      pushHistory
    )
  }

  const beginDurationEdit = () => {
    if (selection && durationStart.current === null) durationStart.current = selection.duration
  }

  const commitDurationEdit = (duration: number) => {
    const initial = durationStart.current
    durationStart.current = null
    if (!selection || initial === null || Math.abs(initial - duration) < 0.000001) return
    updateDuration(initial, false)
    updateDuration(duration, true)
  }

  return (
    <div className="clip-animation-panel">
      <div className="clip-animation-category-tabs" role="tablist" aria-label="动画类型">
        {CLIP_ANIMATION_CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={category === item}
            className={category === item ? 'active' : ''}
            onClick={() => setCategory(item)}
          >
            {CLIP_ANIMATION_CATEGORY_LABELS[item]}
          </button>
        ))}
      </div>

      <div className="clip-animation-toolbar">
        <span>全部</span>
        <label className="clip-animation-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="搜索动画"
            aria-label="搜索动画"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>

      <div className="clip-animation-preset-grid" role="list">
        {!query && (
          <button
            type="button"
            role="listitem"
            aria-pressed={!selection}
            className={`clip-animation-preset ${!selection ? 'active' : ''}`}
            onClick={() => applyPreset(undefined)}
          >
            <span className="clip-animation-thumbnail clip-animation-none">
              <CircleSlash aria-hidden="true" />
            </span>
            <span>无</span>
          </button>
        )}
        {presets.map((preset) => {
          const active = selection?.presetId === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              role="listitem"
              aria-pressed={active}
              className={`clip-animation-preset ${active ? 'active' : ''}`}
              onClick={() => applyPreset(preset.id)}
            >
              <span className="clip-animation-thumbnail">
                <span
                  className={`clip-animation-preview clip-animation-preview-${preset.preview}`}
                  aria-hidden="true"
                >
                  <span />
                </span>
              </span>
              <span title={preset.name}>{preset.name}</span>
            </button>
          )
        })}
      </div>

      {selection && selectedPreset && durationBounds && (
        <div className="clip-animation-settings">
          <div className="clip-animation-settings-heading">
            <strong>{selectedPreset.name}</strong>
            <div>
              <button
                type="button"
                title="预览动画"
                aria-label="预览动画"
                onClick={() => preview(category, selection.duration)}
              >
                <Play aria-hidden="true" />
              </button>
              <button
                type="button"
                title="删除动画"
                aria-label="删除动画"
                onClick={() => applyPreset(undefined)}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="clip-animation-duration-row">
            <label htmlFor={`clip-animation-duration-${element.id}-${category}`}>时长</label>
            <input
              id={`clip-animation-duration-${element.id}-${category}`}
              type="range"
              min={durationBounds.minimum}
              max={durationBounds.maximum}
              step={0.1}
              value={selection.duration}
              onPointerDown={beginDurationEdit}
              onKeyDown={beginDurationEdit}
              onChange={(event) => {
                beginDurationEdit()
                updateDuration(Number(event.currentTarget.value), false)
              }}
              onPointerUp={(event) => commitDurationEdit(Number(event.currentTarget.value))}
              onKeyUp={(event) => commitDurationEdit(Number(event.currentTarget.value))}
            />
            <div className="clip-animation-duration-input">
              <input
                type="number"
                min={durationBounds.minimum}
                max={durationBounds.maximum}
                step={0.1}
                value={displayDuration(selection.duration)}
                aria-label="动画时长"
                onFocus={beginDurationEdit}
                onChange={(event) => {
                  const duration = Number(event.currentTarget.value)
                  if (Number.isFinite(duration)) updateDuration(duration, false)
                }}
                onBlur={(event) => commitDurationEdit(Number(event.currentTarget.value))}
              />
              <span>s</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
