type TimelineTrackLike = {
  elements?: unknown[]
  isMain?: boolean
}

/**
 * Remove tracks that no longer contain timeline elements.
 *
 * The main video track is kept as the timeline's required container even when
 * it is empty. Other tracks are transient editing lanes and should disappear
 * as soon as their last element is gone.
 */
export function removeEmptyTimelineTracks<T extends TimelineTrackLike>(tracks: T[]): T[] {
  const cleaned = tracks.filter(
    (track) => track.isMain === true || (track.elements?.length ?? 0) > 0
  )
  return cleaned.length === tracks.length ? tracks : cleaned
}
