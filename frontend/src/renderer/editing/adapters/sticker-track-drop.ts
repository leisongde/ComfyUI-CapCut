export interface StickerTrackDropIntent {
  preferredIndex: number
  insertAbove: boolean
}

export function getStickerTrackCreationIntent({
  mouseY,
  tracks,
  trackHeights,
  trackGap
}: {
  mouseY: number
  tracks: Array<{ type: string }>
  trackHeights: Record<string, number>
  trackGap: number
}): StickerTrackDropIntent | null {
  if (!tracks.length) return null
  if (mouseY < 0) return { preferredIndex: 0, insertAbove: true }

  let top = 0
  for (let index = 0; index < tracks.length; index++) {
    const track = tracks[index]
    const height = trackHeights[track.type] ?? 0
    const bottom = top + height

    if (mouseY < bottom) {
      if (track.type === 'sticker') return null
      return {
        preferredIndex: index,
        insertAbove: mouseY - top < height / 2
      }
    }

    if (index < tracks.length - 1 && mouseY < bottom + trackGap) {
      return { preferredIndex: index, insertAbove: false }
    }

    top = bottom + trackGap
  }

  return { preferredIndex: tracks.length - 1, insertAbove: false }
}

export function getDefaultStickerTrackIndex(tracks: Array<{ type: string }>): number {
  const firstVideoIndex = tracks.findIndex((track) => track.type === 'video')
  if (firstVideoIndex >= 0) return firstVideoIndex

  const firstAudioIndex = tracks.findIndex((track) => track.type === 'audio')
  if (firstAudioIndex >= 0) return firstAudioIndex

  return 0
}
