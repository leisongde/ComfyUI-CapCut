export type VerticalDragDirection = 'up' | 'down' | null

export interface InternalTrackEdgeDropTarget {
  preferredIndex: number
  insertAbove: boolean
}

export function getInternalTrackEdgeDropTarget({
  isExternalDrop,
  mouseY,
  totalTracksHeight,
  trackCount,
  verticalDragDirection
}: {
  isExternalDrop: boolean
  mouseY: number
  totalTracksHeight: number
  trackCount: number
  verticalDragDirection?: VerticalDragDirection
}): InternalTrackEdgeDropTarget | null {
  if (isExternalDrop || trackCount === 0 || !verticalDragDirection) return null

  if (mouseY < 0 && verticalDragDirection === 'up') {
    return { preferredIndex: 0, insertAbove: true }
  }

  if (mouseY >= totalTracksHeight && verticalDragDirection === 'down') {
    return { preferredIndex: trackCount - 1, insertAbove: false }
  }

  return null
}
