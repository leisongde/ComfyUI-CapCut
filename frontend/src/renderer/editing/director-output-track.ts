import type { TimelineTrack } from '@/types/timeline'
import { findAvailableVideoTrackAbove } from '@/lib/timeline/element-utils'

type AddVideoTrack = (options: { type: 'video'; index?: number }) => string

export function chooseDirectorOutputTrack({
  tracks,
  startTime,
  duration,
  addTrack,
  sourceTrackId
}: {
  tracks: TimelineTrack[]
  startTime: number
  duration: number
  addTrack: AddVideoTrack
  sourceTrackId?: string
}): string {
  const source = sourceTrackId
    ? tracks.find((track) => track.id === sourceTrackId)
    : tracks.find((track) => track.type === 'video' && track.isMain)
  const availableAbove = source
    ? findAvailableVideoTrackAbove({
        tracks,
        sourceTrackId: source.id,
        startTime,
        endTime: startTime + duration
      })
    : null

  // Never insert into the source or a lower track. A new track is placed at
  // index 0 so the generated result remains above every existing video.
  return availableAbove ?? addTrack({ type: 'video', index: 0 })
}
