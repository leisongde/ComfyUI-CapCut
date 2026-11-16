import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Pipette, RotateCcw } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useEditor } from '@/hooks/use-editor'
import type { ImageElement, VideoElement } from '@/types/timeline'
import {
  DEFAULT_CHROMA_KEY,
  normalizeChromaColor,
  normalizeChromaKey,
  type ChromaKeySettings
} from './chroma-key'

type VisualElementWithChromaKey = (VideoElement | ImageElement) & { chromaKey?: unknown }
type ChromaParameter = 'intensity' | 'shadow' | 'edgeSmooth' | 'spill'

interface EyeDropperResult {
  sRGBHex: string
}

interface EyeDropperInstance {
  open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult>
}

type EyeDropperConstructor = new () => EyeDropperInstance

const PARAMETER_ROWS: ReadonlyArray<{
  key: ChromaParameter
  label: string
}> = [
  { key: 'intensity', label: '强度' },
  { key: 'shadow', label: '阴影' },
  { key: 'edgeSmooth', label: '边缘' },
  { key: 'spill', label: '溢色' }
]

export function ChromaKeyProperties({
  element,
  trackId
}: {
  element: VisualElementWithChromaKey
  trackId: string
}) {
  const editor = useEditor()
  const settings = normalizeChromaKey(element.chromaKey)
  const [expanded, setExpanded] = useState(true)
  const [sampling, setSampling] = useState(false)
  const sliderStart = useRef<Partial<Record<ChromaParameter, number>>>({})

  const update = (next: ChromaKeySettings, pushHistory = true) => {
    editor.timeline.updateElements({
      updates: [
        {
          trackId,
          elementId: element.id,
          updates: { chromaKey: next }
        }
      ],
      pushHistory
    })
  }

  const commitSlider = (key: ChromaParameter, finalValue: number) => {
    const initialValue = sliderStart.current[key]
    if (initialValue === undefined) return
    delete sliderStart.current[key]
    update({ ...settings, [key]: initialValue }, false)
    update({ ...settings, [key]: finalValue }, true)
  }

  const sampleScreenColor = async () => {
    const EyeDropper = (window as typeof window & { EyeDropper?: EyeDropperConstructor }).EyeDropper
    if (!EyeDropper || sampling) return
    setSampling(true)
    try {
      const result = await new EyeDropper().open()
      update({ ...settings, color: normalizeChromaColor(result.sRGBHex), enabled: true })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('取色器未能读取颜色', error)
      }
    } finally {
      setSampling(false)
    }
  }

  return (
    <section className="border-border border-b">
      <div className="flex min-h-12 items-center gap-2 px-3">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 place-items-center rounded-sm hover:bg-accent"
          aria-label={expanded ? '收起色度抠图' : '展开色度抠图'}
          title={expanded ? '收起' : '展开'}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 text-left text-xs font-medium"
          onClick={() => setExpanded((value) => !value)}
        >
          色度抠图
        </button>
        {settings.enabled && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 place-items-center rounded-sm hover:bg-accent"
            aria-label="重置色度抠图"
            title="重置"
            onClick={() => update({ ...DEFAULT_CHROMA_KEY, enabled: true })}
          >
            <RotateCcw size={13} />
          </button>
        )}
        <Switch
          checked={settings.enabled}
          aria-label={settings.enabled ? '关闭色度抠图' : '开启色度抠图'}
          onCheckedChange={(enabled) => {
            update({ ...settings, enabled })
            if (enabled) setExpanded(true)
          }}
        />
      </div>

      {expanded && (
        <div className="border-border space-y-4 border-t px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-xs">颜色</span>
            <div className="flex items-center gap-2">
              <label
                className="border-border relative size-7 overflow-hidden rounded-sm border"
                title="选择颜色"
              >
                <span
                  className="pointer-events-none absolute inset-1 rounded-[2px]"
                  style={{ backgroundColor: settings.color }}
                />
                <input
                  type="color"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={settings.color}
                  aria-label="色度抠图颜色"
                  onChange={(event) =>
                    update({
                      ...settings,
                      color: normalizeChromaColor(event.target.value),
                      enabled: true
                    })
                  }
                />
              </label>
              <span className="text-muted-foreground w-14 font-mono text-[10px] uppercase">
                {settings.color}
              </span>
              <button
                type="button"
                className="border-border text-muted-foreground hover:bg-accent hover:text-foreground grid size-7 place-items-center rounded-sm border"
                aria-label="吸取色度抠图颜色"
                title="吸取屏幕颜色"
                disabled={
                  sampling ||
                  !(window as typeof window & { EyeDropper?: EyeDropperConstructor }).EyeDropper
                }
                onClick={() => void sampleScreenColor()}
              >
                <Pipette size={13} />
              </button>
            </div>
          </div>

          {PARAMETER_ROWS.map(({ key, label }) => {
            const value = Math.round(settings[key] * 100)
            return (
              <label key={key} className="block">
                <span className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="w-8 text-right font-variant-numeric tabular-nums">{value}</span>
                </span>
                <input
                  type="range"
                  className="w-full accent-sky-500"
                  min={0}
                  max={100}
                  step={1}
                  value={value}
                  disabled={!settings.enabled}
                  aria-label={`色度抠图${label}`}
                  onPointerDown={() => {
                    sliderStart.current[key] ??= settings[key]
                  }}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value) / 100
                    update(
                      { ...settings, [key]: nextValue },
                      sliderStart.current[key] === undefined
                    )
                  }}
                  onPointerUp={(event) =>
                    commitSlider(key, Number(event.currentTarget.value) / 100)
                  }
                  onPointerCancel={(event) =>
                    commitSlider(key, Number(event.currentTarget.value) / 100)
                  }
                />
              </label>
            )
          })}
        </div>
      )}
    </section>
  )
}
