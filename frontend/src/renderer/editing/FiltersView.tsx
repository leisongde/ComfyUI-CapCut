import { Check, Palette } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useEditor } from '@/hooks/use-editor'
import { clearDragData, setDragData } from '@/lib/drag-data'
import previewImage from './assets/transition-preview-3.jpg'
import {
  CLIP_FILTER_CATEGORIES,
  CLIP_FILTER_PRESETS,
  createClipFilter,
  normalizeClipFilter
} from './clip-filters'
import type { ClipFilterCategory, ClipFilterPreset } from './clip-filters'

type FilterableElement = {
  type: string
  colorFilter?: unknown
}

export function FiltersView() {
  const editor = useEditor()
  const [category, setCategory] = useState<'all' | ClipFilterCategory>('all')
  const presets = useMemo(
    () =>
      category === 'all'
        ? CLIP_FILTER_PRESETS
        : CLIP_FILTER_PRESETS.filter((preset) => preset.category === category),
    [category]
  )
  const selected = editor.timeline
    .getElementsWithTracks({ elements: editor.selection.getSelectedElements() })
    .filter(({ element }) => element.type === 'video' || element.type === 'image')
  const selectedFilterIds = selected.map(({ element }) => {
    const filter = normalizeClipFilter((element as FilterableElement).colorFilter)
    return filter?.id ?? 'original'
  })
  const activeFilterId =
    selectedFilterIds.length > 0 && selectedFilterIds.every((id) => id === selectedFilterIds[0])
      ? selectedFilterIds[0]
      : null

  function applyPreset(preset: ClipFilterPreset): void {
    if (!selected.length) {
      toast.info('请先在时间线选择一个视频或图片片段')
      return
    }
    const colorFilter = preset.id === 'original' ? null : createClipFilter(preset)
    editor.timeline.updateElements({
      updates: selected.map(({ track, element }) => ({
        trackId: track.id,
        elementId: element.id,
        updates: { colorFilter }
      }))
    })
    toast.success(
      preset.id === 'original'
        ? selected.length === 1
          ? '已恢复原片'
          : `已将 ${selected.length} 个片段恢复为原片`
        : selected.length === 1
          ? `${preset.name}已应用到片段`
          : `${preset.name}已应用到 ${selected.length} 个片段`
    )
  }

  function startFilterDrag(event: React.DragEvent<HTMLButtonElement>, preset: ClipFilterPreset) {
    event.dataTransfer.effectAllowed = 'copy'
    setDragData({
      dataTransfer: event.dataTransfer,
      dragData: {
        type: 'filter',
        id: preset.id,
        name: preset.name,
        filter: preset.id === 'original' ? null : createClipFilter(preset)
      } as never
    })
  }

  return (
    <div className="filters-panel">
      <header className="filters-toolbar">
        <div className="filters-heading">
          <Palette size={15} />
          <strong>滤镜</strong>
          <span>{CLIP_FILTER_PRESETS.length - 1}</span>
        </div>
        <div className="filters-categories" role="tablist" aria-label="滤镜分类">
          {CLIP_FILTER_CATEGORIES.map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={category === item.id}
              className={category === item.id ? 'active' : ''}
              key={item.id}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>
      <div className="filters-selection-status">
        {selected.length
          ? `已选择 ${selected.length} 个可应用片段`
          : '请先选择时间线中的视频或图片'}
      </div>
      <div className="filters-scroll">
        <div className="filters-grid">
          {presets.map((preset) => {
            const active = activeFilterId === preset.id
            return (
              <button
                type="button"
                className={`filter-preset${active ? ' active' : ''}`}
                draggable
                aria-pressed={active}
                title={`${preset.name}，可拖到时间线片段或调节层`}
                key={preset.id}
                onClick={() => applyPreset(preset)}
                onDragStart={(event) => startFilterDrag(event, preset)}
                onDragEnd={() => clearDragData()}
              >
                <span className="filter-preview">
                  <img
                    src={previewImage}
                    alt=""
                    draggable={false}
                    style={{ filter: preset.previewFilter }}
                  />
                  {active && (
                    <span className="filter-selected-mark" aria-hidden="true">
                      <Check size={12} strokeWidth={2.6} />
                    </span>
                  )}
                </span>
                <span>{preset.name}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
