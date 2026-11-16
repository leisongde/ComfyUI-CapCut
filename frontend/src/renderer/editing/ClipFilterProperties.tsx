import { Trash2 } from 'lucide-react'
import { PropertyGroup } from '@/components/editor/panels/properties/property-item'
import { useEditor } from '@/hooks/use-editor'
import type { ImageElement, VideoElement } from '@/types/timeline'
import { normalizeClipFilter } from './clip-filters'
import type { DesktopClipFilter } from './clip-filters'

type VisualElementWithFilter = (VideoElement | ImageElement) & { colorFilter?: unknown }

export function ClipFilterProperties({
  element,
  trackId
}: {
  element: VisualElementWithFilter
  trackId: string
}) {
  const editor = useEditor()
  const filter = normalizeClipFilter(element.colorFilter)
  if (!filter) return null

  const updateFilter = (nextFilter: DesktopClipFilter | null, pushHistory = true) => {
    editor.timeline.updateElements({
      updates: [
        {
          trackId,
          elementId: element.id,
          updates: { colorFilter: nextFilter }
        }
      ],
      pushHistory
    })
  }

  return (
    <PropertyGroup title="片段滤镜" collapsible={false}>
      <div className="space-y-3">
        <div className="flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            checked={filter.enabled}
            aria-label={`${filter.enabled ? '禁用' : '启用'} ${filter.name}`}
            title={filter.enabled ? '禁用滤镜' : '启用滤镜'}
            onChange={(event) => updateFilter({ ...filter, enabled: event.target.checked })}
          />
          <span className="min-w-0 flex-1 truncate text-xs" title={filter.name}>
            {filter.name}
          </span>
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive flex size-6 items-center justify-center rounded-sm"
            aria-label={`删除 ${filter.name}`}
            title="删除滤镜"
            onClick={() => updateFilter(null)}
          >
            <Trash2 size={13} />
          </button>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground w-8 text-[10px]">强度</span>
          <input
            className="min-w-0 flex-1 accent-current"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(filter.intensity * 100)}
            aria-label={`${filter.name}强度`}
            onChange={(event) =>
              updateFilter({ ...filter, intensity: Number(event.target.value) / 100 })
            }
          />
          <span className="text-muted-foreground w-7 text-right text-[10px]">
            {Math.round(filter.intensity * 100)}
          </span>
        </label>
      </div>
    </PropertyGroup>
  )
}
