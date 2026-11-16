import { Trash2 } from 'lucide-react'
import { PropertyGroup } from '@/components/editor/panels/properties/property-item'
import { useEditor } from '@/hooks/use-editor'
import type { ImageElement, VideoElement } from '@/types/timeline'
import type { DesktopClipEffect } from './clip-effects'
import { normalizeClipEffects } from './clip-effects'

type VisualElementWithEffects = (VideoElement | ImageElement) & { effects?: unknown }

export function ClipEffectsProperties({
  element,
  trackId,
  title = '片段特效'
}: {
  element: VisualElementWithEffects
  trackId: string
  title?: string
}) {
  const editor = useEditor()
  const effects = normalizeClipEffects(element.effects)
  if (!effects.length) return null

  const updateEffects = (nextEffects: DesktopClipEffect[]) => {
    editor.timeline.updateElements({
      updates: [
        {
          trackId,
          elementId: element.id,
          updates: { effects: nextEffects }
        }
      ]
    })
  }

  return (
    <PropertyGroup title={`${title} (${effects.length})`} collapsible={false}>
      <div className="space-y-3">
        {effects.map((effect) => (
          <div className="border-border border-b pb-3 last:border-b-0 last:pb-0" key={effect.id}>
            <div className="flex min-w-0 items-center gap-2">
              <input
                type="checkbox"
                checked={effect.enabled}
                aria-label={`${effect.enabled ? '禁用' : '启用'} ${effect.name}`}
                title={effect.enabled ? '禁用特效' : '启用特效'}
                onChange={(event) =>
                  updateEffects(
                    effects.map((item) =>
                      item.id === effect.id ? { ...item, enabled: event.target.checked } : item
                    )
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate text-xs" title={effect.name}>
                {effect.name}
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive flex size-6 items-center justify-center rounded-sm"
                aria-label={`删除 ${effect.name}`}
                title="删除特效"
                onClick={() => updateEffects(effects.filter((item) => item.id !== effect.id))}
              >
                <Trash2 size={13} />
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2">
              <span className="text-muted-foreground w-8 text-[10px]">强度</span>
              <input
                className="min-w-0 flex-1 accent-current"
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(effect.intensity * 100)}
                aria-label={`${effect.name}强度`}
                onChange={(event) => {
                  const intensity = Number(event.target.value) / 100
                  updateEffects(
                    effects.map((item) => (item.id === effect.id ? { ...item, intensity } : item))
                  )
                }}
              />
              <span className="text-muted-foreground w-7 text-right text-[10px]">
                {Math.round(effect.intensity * 100)}
              </span>
            </label>
          </div>
        ))}
      </div>
    </PropertyGroup>
  )
}
