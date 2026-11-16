import type { ImageElement, TimelineElement, TimelineTrack, VideoTrack } from '@/types/timeline'
import { createNeutralColorAdjustment } from './color-adjustment'
import { createNeutralClipFilter } from './clip-filters'

export const ADJUSTMENT_MEDIA_ID = '__desktop_adjustment_layer__'
export const ADJUSTMENT_ELEMENT_KIND = 'adjustment'
export const ADJUSTMENT_TRACK_KIND = 'adjustment'

export type DesktopAdjustmentElement = ImageElement & {
  desktopElementKind: typeof ADJUSTMENT_ELEMENT_KIND
  colorFilter?: unknown
  colorAdjustment?: unknown
  colorAdjustmentMask?: unknown
  colorAdjustmentCustomMask?: unknown
  effects?: unknown
}

export type CreateDesktopAdjustmentElement = Omit<DesktopAdjustmentElement, 'id'>

export type DesktopAdjustmentTrack = VideoTrack & {
  desktopTrackKind: typeof ADJUSTMENT_TRACK_KIND
}

export function isAdjustmentElement(value: unknown): value is DesktopAdjustmentElement {
  if (!value || typeof value !== 'object') return false
  const element = value as Partial<DesktopAdjustmentElement>
  return (
    element.type === 'image' &&
    (element.desktopElementKind === ADJUSTMENT_ELEMENT_KIND ||
      element.mediaId === ADJUSTMENT_MEDIA_ID)
  )
}

export function isAdjustmentTrack(value: unknown): value is DesktopAdjustmentTrack {
  if (!value || typeof value !== 'object') return false
  const track = value as Partial<DesktopAdjustmentTrack> & { elements?: unknown[] }
  if (track.type !== 'video') return false
  if (track.desktopTrackKind === ADJUSTMENT_TRACK_KIND) return true
  return Boolean(track.elements?.length && track.elements.every(isAdjustmentElement))
}

export function markAdjustmentTrack(track: TimelineTrack): DesktopAdjustmentTrack {
  return {
    ...track,
    name: '调节轨道',
    desktopTrackKind: ADJUSTMENT_TRACK_KIND
  } as DesktopAdjustmentTrack
}

export function createAdjustmentElement(input: {
  startTime: number
  duration: number
}): CreateDesktopAdjustmentElement {
  return {
    type: 'image',
    name: '调节层',
    mediaId: ADJUSTMENT_MEDIA_ID,
    desktopElementKind: ADJUSTMENT_ELEMENT_KIND,
    startTime: Math.max(0, input.startTime),
    duration: Math.max(0.04, input.duration),
    trimStart: 0,
    trimEnd: 0,
    hidden: false,
    transform: {
      scale: 1,
      position: { x: 0, y: 0 },
      rotate: 0
    },
    opacity: 1,
    colorFilter: createNeutralClipFilter(),
    colorAdjustment: createNeutralColorAdjustment()
  }
}

export function rangesOverlap(
  first: { startTime: number; duration: number },
  second: { startTime: number; duration: number }
): boolean {
  return (
    first.startTime < second.startTime + second.duration &&
    second.startTime < first.startTime + first.duration
  )
}

export function getAdjustmentLayers(tracks: TimelineTrack[]): Array<{
  trackIndex: number
  element: DesktopAdjustmentElement
}> {
  return tracks
    .flatMap((track, trackIndex) =>
      track.elements
        .filter(isAdjustmentElement)
        .filter((element) => !element.hidden)
        .map((element) => ({ trackIndex, element }))
    )
    .sort((left, right) => {
      if (left.trackIndex !== right.trackIndex) return right.trackIndex - left.trackIndex
      if (left.element.startTime !== right.element.startTime) {
        return left.element.startTime - right.element.startTime
      }
      return left.element.id.localeCompare(right.element.id)
    })
}

export function isAdjustmentCompatible(input: {
  element: TimelineElement
  track: TimelineTrack
}): boolean {
  return isAdjustmentElement(input.element) === isAdjustmentTrack(input.track)
}
