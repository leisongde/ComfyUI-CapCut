import { Plus, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@/hooks/use-editor'
import {
  createAdjustmentElement,
  isAdjustmentElement,
  isAdjustmentTrack,
  markAdjustmentTrack,
  rangesOverlap
} from './adjustment-layer'

const DEFAULT_ADJUSTMENT_DURATION = 5

export function AdjustmentView() {
  const editor = useEditor()
  const tracks = editor.timeline.getTracks()
  const layerCount = tracks.reduce(
    (count, track) => count + track.elements.filter(isAdjustmentElement).length,
    0
  )

  function createLayer(): void {
    const startTime = editor.playback.getCurrentTime()
    const timelineDuration = editor.timeline.getTotalDuration()
    const remainingDuration = timelineDuration - startTime
    const duration =
      remainingDuration > 0
        ? Math.max(0.04, Math.min(DEFAULT_ADJUSTMENT_DURATION, remainingDuration))
        : DEFAULT_ADJUSTMENT_DURATION
    const element = createAdjustmentElement({ startTime, duration })
    let targetTrack = editor.timeline
      .getTracks()
      .find(
        (track) =>
          isAdjustmentTrack(track) &&
          !track.elements.some((existing) => rangesOverlap(existing, element))
      )

    if (!targetTrack) {
      const trackId = editor.timeline.addTrack({ type: 'video', index: 0 })
      editor.timeline.updateTracks(
        editor.timeline
          .getTracks()
          .map((track) => (track.id === trackId ? markAdjustmentTrack(track) : track))
      )
      targetTrack = editor.timeline.getTrackById({ trackId }) ?? undefined
    }

    if (!targetTrack) {
      toast.error('无法创建调节轨道')
      return
    }

    const existingIds = new Set(targetTrack.elements.map((item) => item.id))
    editor.timeline.insertElement({
      placement: { mode: 'explicit', trackId: targetTrack.id },
      element
    })
    const created = editor.timeline
      .getTrackById({ trackId: targetTrack.id })
      ?.elements.find((item) => !existingIds.has(item.id) && isAdjustmentElement(item))
    if (created) {
      editor.selection.setSelectedElements({
        elements: [{ trackId: targetTrack.id, elementId: created.id }]
      })
    }
    toast.success('已新建调节层')
  }

  return (
    <div className="adjustment-library">
      <header className="adjustment-toolbar">
        <div className="adjustment-heading">
          <SlidersHorizontal size={15} />
          <strong>调节</strong>
          <span>{layerCount}</span>
        </div>
        <button type="button" className="adjustment-create" onClick={createLayer}>
          <Plus size={14} />
          <span>新建调节层</span>
        </button>
      </header>
      <div className="adjustment-scroll">
        <button
          type="button"
          className="adjustment-preset"
          onClick={createLayer}
          title="新建自定义调节层"
        >
          <span className="adjustment-preset-icon">
            <SlidersHorizontal size={25} />
          </span>
          <span>自定义调节</span>
        </button>
      </div>
    </div>
  )
}
