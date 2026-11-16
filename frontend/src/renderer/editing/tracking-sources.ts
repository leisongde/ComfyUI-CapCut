import type { MediaAsset } from '@/types/assets'
import type {
  ImageElement,
  StickerElement,
  TextElement,
  TimelineTrack,
  VideoElement
} from '@/types/timeline'
import {
  getObjectLockSampleAtTime,
  mapObjectLockSampleToCanvas,
  type ObjectLockSample,
  type ObjectLockSettings
} from './object-lock'
import { resolveVisualState } from './visual-keyframes'

export type TrackingElement = (VideoElement | ImageElement | TextElement | StickerElement) & {
  objectLock?: unknown
}

export interface TrackingSourceCandidate {
  element: VideoElement
  trackId: string
  trackName: string
  asset: MediaAsset
}

function rangesOverlap(left: TrackingElement, right: VideoElement): boolean {
  return (
    left.startTime < right.startTime + right.duration &&
    left.startTime + left.duration > right.startTime
  )
}

export function getTrackingSourceCandidates({
  tracks,
  assets,
  follower,
  followerTrackId
}: {
  tracks: TimelineTrack[]
  assets: MediaAsset[]
  follower: TrackingElement
  followerTrackId: string
}): TrackingSourceCandidate[] {
  const orderedTopToBottom = [
    ...tracks.filter((track) => !('isMain' in track && track.isMain)),
    ...tracks.filter((track) => 'isMain' in track && track.isMain)
  ]
  const followerTrackIndex = orderedTopToBottom.findIndex((track) => track.id === followerTrackId)
  if (followerTrackIndex < 0) return []

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const currentAsset = follower.type === 'video' ? assetsById.get(follower.mediaId) : undefined
  const current =
    follower.type === 'video' && currentAsset
      ? [
          {
            element: follower,
            trackId: followerTrackId,
            trackName: '当前视频',
            asset: currentAsset
          }
        ]
      : []
  return [
    ...current,
    ...orderedTopToBottom.slice(followerTrackIndex + 1).flatMap((track) => {
      if (track.type !== 'video' || track.hidden) return []
      return track.elements.flatMap((element) => {
        if (element.type !== 'video' || element.hidden || !rangesOverlap(follower, element))
          return []
        const asset = assetsById.get(element.mediaId)
        return asset ? [{ element, trackId: track.id, trackName: track.name, asset }] : []
      })
    })
  ]
}

export function getTrackingFollowers(
  tracks: TimelineTrack[],
  source: VideoElement,
  sourceTrackId: string
) {
  const ordered = [
    ...tracks.filter((track) => !('isMain' in track && track.isMain)),
    ...tracks.filter((track) => 'isMain' in track && track.isMain)
  ]
  const sourceIndex = ordered.findIndex((track) => track.id === sourceTrackId)
  if (sourceIndex < 0) return []
  return ordered.slice(0, sourceIndex).flatMap((track) => {
    if (track.type === 'audio' || track.hidden) return []
    return track.elements.flatMap((element) =>
      element.type !== 'audio' &&
      !element.hidden &&
      rangesOverlap(element, source) &&
      !('mediaId' in element && element.mediaId === '__desktop_adjustment_layer__')
        ? [{ element, trackId: track.id, trackName: track.name }]
        : []
    )
  })
}

export function buildFollowerTracking(
  source: VideoElement,
  sourceTrackId: string,
  tracking: ObjectLockSettings
): ObjectLockSettings {
  const mapSample = (raw: ObjectLockSample) => {
    const sample =
      tracking.subjectCenter && tracking.enabled
        ? (getObjectLockSampleAtTime(tracking.samples, raw.time, tracking.smoothing) ?? raw)
        : raw
    const timelineTime = source.startTime + sample.time
    const visual = resolveVisualState({ source: { ...source, objectLock: tracking }, timelineTime })
    return mapObjectLockSampleToCanvas({
      sample: { ...sample, time: timelineTime },
      sourceSize: tracking.sourceSize,
      fitCanvasSize: tracking.fitCanvasSize,
      transform: visual.transform
    })
  }
  return {
    version: 2,
    enabled: true,
    mode: 'position',
    anchor: 'center',
    smoothing: tracking.smoothing,
    maxScale: tracking.maxScale,
    sourceSize: tracking.sourceSize,
    fitCanvasSize: tracking.fitCanvasSize,
    seed: mapSample(tracking.seed),
    samples: tracking.samples.map(mapSample),
    lostFrames: tracking.lostFrames,
    sourceElementId: source.id,
    sourceElementName: source.name,
    sourceTrackId
  }
}
