import { generateUUID } from '@/utils/id'
import type { TimelineElement, TimelineTrack, VideoElement } from '@/types/timeline'
import { buildEmptyTrack } from '@/lib/timeline/track-utils'
import {
  isEditingDirectorGenerationPlaceholder,
  type EditingDirectorGenerationProgress,
  type EditingDirectorGenerationSlot,
  type EditingDirectorScene
} from '../../shared/editing'
import { chooseDirectorOutputTrack } from './director-output-track'
import { getDirectorSceneExportMode } from './director-scene-bar'

export type DirectorGenerationPlaceholder = VideoElement & {
  directorGeneration: EditingDirectorGenerationSlot
}

export function isDirectorGenerationPlaceholder(
  element: unknown
): element is DirectorGenerationPlaceholder {
  return isEditingDirectorGenerationPlaceholder(element)
}

export function createDirectorGenerationPlan(scene: EditingDirectorScene, fps: number) {
  const selection =
    scene.settings.directorRunSelectEnabled === true
      ? new Set(
          (Array.isArray(scene.settings.directorRunSelection)
            ? scene.settings.directorRunSelection
            : []
          ).map(Number)
        )
      : null
  const orderedShots = [...scene.shots].sort((left, right) => left.startTime - right.startTime)
  const selected = orderedShots.filter(
    (shot) => !selection || selection.has(scene.shots.indexOf(shot))
  )
  if (!selected.length) throw new Error('请至少勾选一个提示词组')
  const exportMode = getDirectorSceneExportMode(scene, fps)
  return { requestId: generateUUID(), scene, orderedShots, selected, exportMode }
}

export type DirectorGenerationPlan = ReturnType<typeof createDirectorGenerationPlan>

const sameShots = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id) => right.includes(id))

/** Reserve real timeline slots, without decoding media or adding fake assets to the library. */
export function reserveDirectorGenerationPlaceholders(
  tracks: TimelineTrack[],
  plan: DirectorGenerationPlan
): TimelineTrack[] {
  if (
    tracks.some((track) =>
      track.elements.some(
        (element) =>
          isDirectorGenerationPlaceholder(element) &&
          element.directorGeneration.requestId === plan.requestId
      )
    )
  )
    return tracks
  // A retry replaces only failed slots for these shots. Completed videos stay intact.
  const selectedIds = new Set(plan.selected.map((shot) => shot.id))
  let next = tracks.map((track) => {
    const elements = track.elements.filter(
      (element) =>
        !isDirectorGenerationPlaceholder(element) ||
        element.directorGeneration.status !== 'failed' ||
        !element.directorGeneration.shotIds.some((id) => selectedIds.has(id))
    )
    return elements.length === track.elements.length
      ? track
      : ({ ...track, elements } as TimelineTrack)
  })
  const groups = plan.exportMode === 'all' ? [plan.selected] : plan.selected.map((shot) => [shot])
  for (const shots of groups) {
    const startTime = Math.min(...shots.map((shot) => shot.startTime))
    const duration = shots.reduce((sum, shot) => sum + shot.duration, 0)
    const trackId = chooseDirectorOutputTrack({
      tracks: next,
      startTime,
      duration,
      addTrack: () => {
        const id = generateUUID()
        next = [buildEmptyTrack({ id, type: 'video' }), ...next]
        return id
      }
    })
    const element: DirectorGenerationPlaceholder = {
      id: generateUUID(),
      type: 'video',
      mediaId: '',
      name: shots.length > 1 ? plan.scene.title : shots[0].title,
      startTime,
      duration,
      trimStart: 0,
      trimEnd: 0,
      transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
      opacity: 1,
      directorGeneration: {
        requestId: plan.requestId,
        sceneId: plan.scene.id,
        shotIds: shots.map((shot) => shot.id),
        status: 'queued'
      }
    }
    next = next.map((track) =>
      track.id === trackId
        ? ({ ...track, elements: [...track.elements, element] } as TimelineTrack)
        : track
    )
  }
  return next
}

export function updateDirectorGenerationPlaceholders(
  tracks: TimelineTrack[],
  requestId: string,
  status: 'running' | 'failed',
  error?: string
): TimelineTrack[] {
  let changed = false
  const next = tracks.map((track) => ({
    ...track,
    elements: track.elements.map((element) => {
      if (
        !isDirectorGenerationPlaceholder(element) ||
        element.directorGeneration.requestId !== requestId ||
        (status === 'failed' && element.directorGeneration.status === 'failed') ||
        (element.directorGeneration.status === status && element.directorGeneration.error === error)
      )
        return element
      changed = true
      return { ...element, directorGeneration: { ...element.directorGeneration, status, error } }
    })
  })) as TimelineTrack[]
  return changed ? next : tracks
}

/** Match both request and shot IDs so later queued segments keep their own progress. */
export function updateDirectorGenerationProgress(
  tracks: TimelineTrack[],
  requestId: string,
  updates: EditingDirectorGenerationProgress[]
): TimelineTrack[] {
  let changed = false
  const next = tracks.map((track) => ({
    ...track,
    elements: track.elements.map((element) => {
      if (!isDirectorGenerationPlaceholder(element)) return element
      const state = element.directorGeneration
      if (state.requestId !== requestId || state.status === 'failed') return element
      const update = updates.find((item) => state.shotIds.every((id) => item.shotIds.includes(id)))
      if (!update || !Number.isFinite(update.percent)) return element
      const progress = Math.max(state.progress ?? 0, Math.min(99, Math.max(0, Math.round(update.percent))))
      if (state.status === 'running' && state.progress === progress && state.stage === update.stage) return element
      changed = true
      return { ...element, directorGeneration: { ...state, status: 'running', progress, stage: update.stage } }
    })
  })) as TimelineTrack[]
  return changed ? next : tracks
}

/** Replace a slot atomically; a longer actual video moves up if it would touch another clip. */
export function fillDirectorGenerationPlaceholder(
  tracks: TimelineTrack[],
  shotIds: string[],
  video: Omit<VideoElement, 'id'>,
  requestId?: string
): { tracks: TimelineTrack[]; element: VideoElement } | null {
  const source = tracks.find((track) =>
    track.elements.some(
      (element) =>
        isDirectorGenerationPlaceholder(element) &&
        (requestId
          ? element.directorGeneration.requestId === requestId
          : element.directorGeneration.status !== 'failed') &&
        sameShots(element.directorGeneration.shotIds, shotIds)
    )
  )
  const placeholder = source?.elements.find(
    (element) =>
      isDirectorGenerationPlaceholder(element) &&
      (requestId
        ? element.directorGeneration.requestId === requestId
        : element.directorGeneration.status !== 'failed') &&
      sameShots(element.directorGeneration.shotIds, shotIds)
  )
  if (!source || !placeholder) return null
  const filled: VideoElement = { ...video, id: placeholder.id, startTime: placeholder.startTime }
  const overlaps = source.elements.some(
    (element) =>
      element.id !== placeholder.id &&
      element.startTime < filled.startTime + filled.duration - 1e-8 &&
      element.startTime + element.duration > filled.startTime + 1e-8
  )
  let next = tracks
  let targetId = source.id
  if (overlaps)
    targetId = chooseDirectorOutputTrack({
      tracks: next,
      sourceTrackId: source.id,
      startTime: filled.startTime,
      duration: filled.duration,
      addTrack: () => {
        const id = generateUUID()
        next = [buildEmptyTrack({ id, type: 'video' }), ...next]
        return id
      }
    })
  next = next.map((track) => {
    if (track.id === source.id && targetId === source.id)
      return {
        ...track,
        elements: track.elements.map((element) =>
          element.id === placeholder.id ? filled : element
        )
      } as TimelineTrack
    if (track.id === source.id)
      return {
        ...track,
        elements: track.elements.filter((element) => element.id !== placeholder.id)
      } as TimelineTrack
    if (track.id === targetId)
      return { ...track, elements: [...track.elements, filled] } as TimelineTrack
    return track
  })
  return { tracks: next, element: filled }
}

export function getDirectorGenerationPlaceholders(
  tracks: TimelineTrack[]
): DirectorGenerationPlaceholder[] {
  return tracks
    .flatMap((track) => track.elements as TimelineElement[])
    .filter(isDirectorGenerationPlaceholder)
}
