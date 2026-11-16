import type { DesktopClipEffect } from '../clip-effects'
import { normalizeClipEffects, upsertClipEffect } from '../clip-effects'
import type { DesktopClipFilter } from '../clip-filters'
import { normalizeClipFilter } from '../clip-filters'

export interface EffectDragData {
  type: 'effect'
  id: string
  name: string
  effect: DesktopClipEffect
}

export interface FilterDragData {
  type: 'filter'
  id: string
  name: string
  filter: DesktopClipFilter | null
}

export type TimelineAppearanceDragData = EffectDragData | FilterDragData

export function isEffectDragData(value: unknown): value is EffectDragData {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EffectDragData>
  return (
    candidate.type === 'effect' &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    normalizeClipEffects([candidate.effect]).length === 1
  )
}

export function isFilterDragData(value: unknown): value is FilterDragData {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<FilterDragData>
  return (
    candidate.type === 'filter' &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    (candidate.filter === null || normalizeClipFilter(candidate.filter) !== null)
  )
}

export function isTimelineAppearanceDragData(value: unknown): value is TimelineAppearanceDragData {
  return isEffectDragData(value) || isFilterDragData(value)
}

interface TimelineEditor {
  timeline: {
    getTrackById(input: { trackId: string }): {
      elements: Array<{
        id: string
        type: string
        desktopElementKind?: unknown
        effects?: unknown
        colorFilter?: unknown
      }>
    } | null
    updateElements(input: {
      updates: Array<{
        trackId: string
        elementId: string
        updates: Partial<Record<string, unknown>>
      }>
    }): void
  }
}

function getDropTarget(input: { editor: TimelineEditor; eventTarget: EventTarget | null }): {
  trackId: string
  elementId: string
  element: NonNullable<ReturnType<TimelineEditor['timeline']['getTrackById']>>['elements'][number]
} | null {
  const target =
    typeof Element !== 'undefined' && input.eventTarget instanceof Element
      ? input.eventTarget.closest<HTMLElement>('[data-timeline-track-id][data-timeline-element-id]')
      : null
  if (!target) return null

  const trackId = target.dataset.timelineTrackId
  const elementId = target.dataset.timelineElementId
  if (!trackId || !elementId) return null

  const track = input.editor.timeline.getTrackById({ trackId })
  const element = track?.elements.find((item) => item.id === elementId)
  if (!element || (element.type !== 'video' && element.type !== 'image')) return null
  return { trackId, elementId, element }
}

export function applyEffectDrop(input: {
  editor: TimelineEditor
  eventTarget: EventTarget | null
  dragData: EffectDragData
}): boolean {
  const target = getDropTarget(input)
  if (!target) return false

  input.editor.timeline.updateElements({
    updates: [
      {
        trackId: target.trackId,
        elementId: target.elementId,
        updates: {
          effects: upsertClipEffect(target.element.effects, input.dragData.effect)
        }
      }
    ]
  })
  return true
}

export function applyFilterDrop(input: {
  editor: TimelineEditor
  eventTarget: EventTarget | null
  dragData: FilterDragData
}): boolean {
  const target = getDropTarget(input)
  if (!target) return false
  input.editor.timeline.updateElements({
    updates: [
      {
        trackId: target.trackId,
        elementId: target.elementId,
        updates: { colorFilter: input.dragData.filter }
      }
    ]
  })
  return true
}

export function applyTimelineAppearanceDrop(input: {
  editor: TimelineEditor
  eventTarget: EventTarget | null
  dragData: TimelineAppearanceDragData
}): boolean {
  return input.dragData.type === 'effect'
    ? applyEffectDrop({ ...input, dragData: input.dragData })
    : applyFilterDrop({ ...input, dragData: input.dragData })
}
