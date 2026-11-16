import { generateUUID } from '@/utils/id'
import type {
  EditingDirectorLibraryItem,
  EditingDirectorLibrarySummary,
  EditingDirectorPlanningState,
  EditingDirectorScene,
  EditingDirectorShot,
  EditingDirectorTaskType
} from '../../shared/editing'
import {
  getDirectorPlanningPreviewAssetId,
  getDirectorShotPreviewAssetId
} from '../../shared/director-planning'
export {
  getDirectorShotPreviewAssetId,
  normalizeDirectorImport
} from '../../shared/director-planning'
import type { TProject } from '@/types/project'
import type { EditorCore } from '@/core'
import {
  compactDirectorTracks,
  resolveDirectorShotTrack,
  resolveDirectorTrackOverlaps
} from '../../shared/editing-director-tracks'
import { isEditingDirectorGenerationPlaceholder as isDirectorGenerationPlaceholder } from '../../shared/editing'
import {
  DEFAULT_DIRECTOR_CHARACTER_SWAP_STANDARD_PROMPT,
  DEFAULT_DIRECTOR_CHARACTER_SWAP_SUBJECT_PROMPT,
  normalizeDirectorCharacterSwapMaxObjects
} from '../../shared/director-character-swap'

export const DIRECTOR_PLANNING_EVENT = 'raccoon:director-planning-updated'

type DirectorProject = TProject & {
  directorPlanning?: EditingDirectorPlanningState
  directorLibrary?: EditingDirectorLibraryItem[]
}

/** Read cards from the live project, including edits that have not reached disk yet. */
export function getDirectorLibrarySummaries(project: TProject): EditingDirectorLibrarySummary[] {
  return ((project as DirectorProject).directorLibrary ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    sourceProjectName: item.source?.canvasProjectName ?? '',
    sceneCount: item.planning.scenes.length,
    shotCount: item.planning.scenes.reduce((total, scene) => total + scene.shots.length, 0),
    importedAt: item.importedAt,
    previewAssetId: getDirectorPlanningPreviewAssetId(item.planning)
  }))
}

const asDuration = (value: unknown, fallback = 5) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(15, Math.max(4, number)) : fallback
}

export function getDirectorPlanning(project: TProject): EditingDirectorPlanningState | null {
  const value = (project as TProject & { directorPlanning?: EditingDirectorPlanningState })
    .directorPlanning
  return value && Array.isArray(value.scenes) ? value : null
}

export function hasDirectorTrack(
  planning: EditingDirectorPlanningState | null | undefined
): boolean {
  return Boolean(
    planning &&
    (planning.emptyTrack === true || planning.scenes.some((scene) => scene.shots.length > 0))
  )
}

export function createEmptyDirectorTrack(
  planning: EditingDirectorPlanningState | null
): EditingDirectorPlanningState {
  return planning
    ? { ...planning, emptyTrack: true }
    : { schemaVersion: 1, scenes: [], assetMap: {}, emptyTrack: true }
}

const localDirectorSettings = (taskType: EditingDirectorTaskType): Record<string, unknown> => ({
  directorTaskType: taskType,
  directorEditMode: taskType === 'rv2v' ? 'global' : 'segment',
  directorWorkflowId: 'minimax_h3_director',
  directorSchemaVersion: 5,
  directorModel: 'MiniMax H3',
  directorSeedMode: 'random',
  directorSeed: globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff,
  directorRefineEnabled: true,
  directorRefineMegapixels: 2,
  directorGlobalPrompt: '',
  directorCommonEnabled: false,
  globalRefs: [],
  globalRefVideos: [],
  globalRefAudios: [],
  sourceVideo: null,
  videoClips: [],
  directorVideoFrameMap: [],
  directorAudioMode: 'generate',
  directorExportMode: 'all',
  directorRunSelectEnabled: false,
  directorRunSelection: [],
  directorFrameRate: 24,
  directorAspectRatio: '16:9 (宽屏)',
  directorMegapixels: 0.4,
  directorWidth: 864,
  directorHeight: 480
})

const createLocalDirectorShot = (options: {
  sceneId: string
  sceneTitle: string
  index: number
  taskType: EditingDirectorTaskType
  startTime: number
  trackIndex: number
  duration?: number
}): EditingDirectorShot => {
  const id = generateUUID()
  const title = `提示词组 ${options.index + 1}`
  return {
    id,
    sceneId: options.sceneId,
    sceneTitle: options.sceneTitle,
    title,
    startTime: options.startTime,
    duration: asDuration(options.duration),
    trackIndex: options.trackIndex,
    targetDuration: asDuration(options.duration),
    prompt: '',
    taskType: options.taskType,
    continuityFromPrev: false,
    refs: [],
    refVideos: [],
    refAudios: [],
    generationStatus: 'idle',
    outputVersions: [],
    durationResolution: 'pending',
    sourceSnapshot: {
      id,
      title,
      duration: asDuration(options.duration),
      prompt: '',
      continuityFromPrev: false,
      imageAssetId: null,
      firstFrameAssetId: null,
      lastFrameAssetId: null
    }
  }
}

export function createDirectorSceneAt(
  planning: EditingDirectorPlanningState | null,
  options: {
    taskType: EditingDirectorTaskType
    startTime: number
    trackIndex?: number
    duration?: number
  }
): EditingDirectorPlanningState {
  const current = planning ?? createEmptyDirectorTrack(null)
  const sceneId = generateUUID()
  const sceneNumber = current.scenes.length + 1
  const sceneTitle = `第 ${sceneNumber} 场`
  const startTime = Number.isFinite(options.startTime) ? Math.max(0, options.startTime) : 0
  const trackIndex = Number.isFinite(Number(options.trackIndex))
    ? Math.max(0, Math.floor(Number(options.trackIndex)))
    : 0
  const shot = createLocalDirectorShot({
    sceneId,
    sceneTitle,
    index: 0,
    taskType: options.taskType,
    startTime,
    trackIndex,
    duration: options.duration
  })
  const scene: EditingDirectorScene = {
    id: sceneId,
    title: sceneTitle,
    createdInEditing: true,
    settings: localDirectorSettings(options.taskType),
    shots: [shot]
  }
  return resolveDirectorShotTrack(
    {
      ...current,
      emptyTrack: false,
      scenes: [...current.scenes, scene],
      selectedShotId: shot.id
    },
    shot.id,
    trackIndex
  )
}

const DIRECTOR_VIDEO_FRAME_RATE = 24
export const DIRECTOR_SOURCE_VIDEO_MAX_DURATION = 15

export function isDirectorSourceVideoDurationAllowed(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && duration <= DIRECTOR_SOURCE_VIDEO_MAX_DURATION
}

export interface VideoModificationSceneOptions {
  element: {
    id: string
    mediaId: string
    name: string
    startTime: number
    duration: number
    trimStart: number
    playbackRate?: number
    reversed?: boolean
  }
  mediaAsset: {
    id: string
    name: string
    width?: number
    height?: number
    duration?: number
    fps?: number
  }
  taskType?: Extract<EditingDirectorTaskType, 'v2v' | 'rv2v'>
  trackIndex?: number
}

export interface VideoModificationSceneResult {
  planning: EditingDirectorPlanningState
  sceneId: string
  shotId: string
  duration: number
  truncated: boolean
}

export interface ImageToVideoSceneOptions {
  element: {
    id: string
    mediaId: string
    name: string
    startTime: number
    duration: number
  }
  mediaAsset: {
    id: string
    name: string
  }
  trackIndex?: number
}

/** Create an editing-owned I2V scene and use the selected still as its reference image. */
export function createImageToVideoScene(
  planning: EditingDirectorPlanningState | null,
  options: ImageToVideoSceneOptions
): VideoModificationSceneResult {
  const timelineDuration = Number.isFinite(options.element.duration)
    ? Math.max(0, options.element.duration)
    : 5
  const duration = asDuration(timelineDuration)
  let next = createDirectorSceneAt(planning, {
    taskType: 'i2v',
    startTime: options.element.startTime,
    trackIndex: options.trackIndex ?? 0
  })
  const shotId = next.selectedShotId!
  const scene = next.scenes.find((item) => item.shots.some((shot) => shot.id === shotId))!
  next = {
    ...next,
    scenes: next.scenes.map((item) =>
      item.id !== scene.id
        ? item
        : {
            ...item,
            settings: {
              ...item.settings,
              directorTaskType: 'i2v'
            },
            shots: item.shots.map((shot) =>
              shot.id !== shotId
                ? shot
                : {
                    ...shot,
                    duration,
                    targetDuration: duration,
                    taskType: 'i2v',
                    imageAssetId: options.mediaAsset.id,
                    sourceSnapshot: {
                      ...shot.sourceSnapshot,
                      duration,
                      imageAssetId: options.mediaAsset.id
                    }
                  }
            )
          }
    )
  }
  next = resolveDirectorShotTrack(next, shotId, options.trackIndex ?? 0)
  return {
    planning: next,
    sceneId: scene.id,
    shotId,
    duration,
    truncated: timelineDuration > duration
  }
}

/** Create an editing-owned FL2V scene and use the selected still as its first frame. */
export function createFirstLastFrameVideoScene(
  planning: EditingDirectorPlanningState | null,
  options: ImageToVideoSceneOptions
): VideoModificationSceneResult {
  const timelineDuration = Number.isFinite(options.element.duration)
    ? Math.max(0, options.element.duration)
    : 5
  const duration = asDuration(timelineDuration)
  let next = createDirectorSceneAt(planning, {
    taskType: 'fl2v',
    startTime: options.element.startTime,
    trackIndex: options.trackIndex ?? 0
  })
  const shotId = next.selectedShotId!
  const scene = next.scenes.find((item) => item.shots.some((shot) => shot.id === shotId))!
  next = {
    ...next,
    scenes: next.scenes.map((item) =>
      item.id !== scene.id
        ? item
        : {
            ...item,
            settings: {
              ...item.settings,
              directorTaskType: 'fl2v'
            },
            shots: item.shots.map((shot) =>
              shot.id !== shotId
                ? shot
                : {
                    ...shot,
                    duration,
                    targetDuration: duration,
                    taskType: 'fl2v',
                    firstFrameAssetId: options.mediaAsset.id,
                    sourceSnapshot: {
                      ...shot.sourceSnapshot,
                      duration,
                      firstFrameAssetId: options.mediaAsset.id,
                      firstFrameOriginalName: options.mediaAsset.name
                    }
                  }
            )
          }
    )
  }
  next = resolveDirectorShotTrack(next, shotId, options.trackIndex ?? 0)
  return {
    planning: next,
    sceneId: scene.id,
    shotId,
    duration,
    truncated: timelineDuration > duration
  }
}

/** Create an editing-owned R2V scene and use the selected clip as its local reference video. */
function createReferenceVideoScene(
  planning: EditingDirectorPlanningState | null,
  options: Omit<VideoModificationSceneOptions, 'taskType'>,
  mode: 'characterReplacement' | 'whiteBody' | 'motionTransfer'
): VideoModificationSceneResult {
  const characterReplacement = mode === 'characterReplacement'
  const prompt = characterReplacement ? DEFAULT_DIRECTOR_CHARACTER_SWAP_STANDARD_PROMPT : ''
  const timelineDuration = Number.isFinite(options.element.duration)
    ? Math.max(1 / DIRECTOR_VIDEO_FRAME_RATE, options.element.duration)
    : 5
  const duration = Math.min(DIRECTOR_SOURCE_VIDEO_MAX_DURATION, Math.max(4, timelineDuration))
  const reference = {
    index: 0,
    assetId: options.mediaAsset.id,
    originalName: options.mediaAsset.name || options.element.name || '参考视频'
  }
  let next = createDirectorSceneAt(planning, {
    taskType: 'r2v',
    startTime: options.element.startTime,
    trackIndex: options.trackIndex ?? 0
  })
  const shotId = next.selectedShotId!
  const scene = next.scenes.find((item) => item.shots.some((shot) => shot.id === shotId))!
  next = {
    ...next,
    scenes: next.scenes.map((item) =>
      item.id !== scene.id
        ? item
        : {
            ...item,
            settings: {
              ...item.settings,
              directorTaskType: 'r2v',
              directorCommonEnabled: false,
              directorCharacterSwapEnabled: characterReplacement,
              directorWhiteBodyEnabled: mode === 'whiteBody',
              directorMotionTransferEnabled: mode === 'motionTransfer',
              ...(characterReplacement
                ? {
                    directorCharacterSwapSubjectPrompt:
                      DEFAULT_DIRECTOR_CHARACTER_SWAP_SUBJECT_PROMPT,
                    directorCharacterSwapMaxObjects:
                      normalizeDirectorCharacterSwapMaxObjects(undefined)
                  }
                : {})
            },
            shots: item.shots.map((shot) =>
              shot.id !== shotId
                ? shot
                : {
                    ...shot,
                    duration,
                    targetDuration: duration,
                    prompt,
                    taskType: 'r2v',
                    refVideos: [reference],
                    sourceSnapshot: {
                      ...shot.sourceSnapshot,
                      duration,
                      prompt,
                      refVideos: [reference]
                    }
                  }
            )
          }
    )
  }
  next = resolveDirectorShotTrack(next, shotId, options.trackIndex ?? 0)
  return {
    planning: next,
    sceneId: scene.id,
    shotId,
    duration,
    truncated: timelineDuration > duration
  }
}

export function createCharacterReplacementScene(
  planning: EditingDirectorPlanningState | null,
  options: Omit<VideoModificationSceneOptions, 'taskType'>
): VideoModificationSceneResult {
  return createReferenceVideoScene(planning, options, 'characterReplacement')
}

export function createWhiteBodyVideoScene(
  planning: EditingDirectorPlanningState | null,
  options: Omit<VideoModificationSceneOptions, 'taskType'>
): VideoModificationSceneResult {
  return createReferenceVideoScene(planning, options, 'whiteBody')
}

export function createMotionTransferScene(
  planning: EditingDirectorPlanningState | null,
  options: Omit<VideoModificationSceneOptions, 'taskType'>
): VideoModificationSceneResult {
  return createReferenceVideoScene(planning, options, 'motionTransfer')
}

/** Create an editing-owned V2V scene from the visible source range of a timeline clip. */
export function createVideoModificationScene(
  planning: EditingDirectorPlanningState | null,
  options: VideoModificationSceneOptions
): VideoModificationSceneResult {
  const taskType = options.taskType === 'rv2v' ? 'rv2v' : 'v2v'
  const timelineDuration = Number.isFinite(options.element.duration)
    ? Math.max(1 / DIRECTOR_VIDEO_FRAME_RATE, options.element.duration)
    : 5
  const duration = Math.min(DIRECTOR_SOURCE_VIDEO_MAX_DURATION, Math.max(4, timelineDuration))
  const outputFrameCount = Math.max(1, Math.round(duration * DIRECTOR_VIDEO_FRAME_RATE))
  const playbackRate = Number.isFinite(options.element.playbackRate)
    ? Math.max(0.01, Number(options.element.playbackRate))
    : 1
  const trimStart = Number.isFinite(options.element.trimStart)
    ? Math.max(0, options.element.trimStart)
    : 0
  const minimumSourceDuration = trimStart + timelineDuration * playbackRate
  const assetDuration = Number(options.mediaAsset.duration)
  const sourceDuration =
    Number.isFinite(assetDuration) && assetDuration > 0
      ? Math.max(assetDuration, minimumSourceDuration)
      : minimumSourceDuration
  const sourceFrameCount = Math.max(1, Math.round(sourceDuration * DIRECTOR_VIDEO_FRAME_RATE))
  const sourceStartFrame = trimStart * DIRECTOR_VIDEO_FRAME_RATE
  const sourceEndFrame = (trimStart + timelineDuration * playbackRate) * DIRECTOR_VIDEO_FRAME_RATE
  const firstVisibleFrame = Math.min(
    sourceFrameCount - 1,
    Math.max(0, Math.floor(sourceStartFrame))
  )
  const lastVisibleFrame = Math.min(
    sourceFrameCount - 1,
    Math.max(firstVisibleFrame, Math.ceil(sourceEndFrame) - 1)
  )
  const directorVideoFrameMap = Array.from({ length: outputFrameCount }, (_, index) => {
    const frame = options.element.reversed
      ? Math.ceil(sourceEndFrame) - 1 - Math.floor(index * playbackRate)
      : Math.floor(sourceStartFrame + index * playbackRate)
    return {
      clip: 0,
      frame: Math.min(lastVisibleFrame, Math.max(firstVisibleFrame, frame))
    }
  })
  const nativeFps = Number(options.mediaAsset.fps) > 0 ? Number(options.mediaAsset.fps) : null
  const clipId = generateUUID()
  const videoClip = {
    id: clipId,
    assetId: options.mediaAsset.id,
    fileName: options.mediaAsset.name || options.element.name || '源视频',
    width: Math.max(0, Number(options.mediaAsset.width) || 0),
    height: Math.max(0, Number(options.mediaAsset.height) || 0),
    duration: sourceDuration,
    nativeFps,
    nativeFrameCount: nativeFps ? Math.max(1, Math.round(sourceDuration * nativeFps)) : null,
    sourceFrameCount
  }
  let next = createDirectorSceneAt(planning, {
    taskType,
    startTime: options.element.startTime,
    trackIndex: options.trackIndex ?? 0
  })
  const shotId = next.selectedShotId!
  const scene = next.scenes.find((item) => item.shots.some((shot) => shot.id === shotId))!
  const mappedDuration = outputFrameCount / DIRECTOR_VIDEO_FRAME_RATE
  next = {
    ...next,
    scenes: next.scenes.map((item) =>
      item.id !== scene.id
        ? item
        : {
            ...item,
            settings: {
              ...item.settings,
              directorTaskType: taskType,
              sourceVideo: videoClip,
              videoClips: [videoClip],
              directorVideoFrameMap
            },
            shots: item.shots.map((shot) =>
              shot.id !== shotId
                ? shot
                : {
                    ...shot,
                    duration: mappedDuration,
                    targetDuration: mappedDuration,
                    taskType,
                    videoClipId: clipId,
                    sourceSnapshot: {
                      ...shot.sourceSnapshot,
                      duration: mappedDuration,
                      start: 0,
                      length: outputFrameCount,
                      end: outputFrameCount,
                      videoClipId: clipId
                    }
                  }
            )
          }
    )
  }
  next = resolveDirectorShotTrack(next, shotId, options.trackIndex ?? 0)
  return {
    planning: next,
    sceneId: scene.id,
    shotId,
    duration: mappedDuration,
    truncated: timelineDuration > duration
  }
}

export function appendDirectorShot(
  planning: EditingDirectorPlanningState,
  sceneId: string
): EditingDirectorPlanningState {
  const scene = planning.scenes.find((item) => item.id === sceneId)
  if (!scene || scene.shots.length === 0) return planning
  const lastShot = scene.shots.reduce((latest, shot) =>
    shot.startTime + shot.duration >= latest.startTime + latest.duration ? shot : latest
  )
  const startTime = Math.max(
    0,
    ...scene.shots.map((shot) => shot.startTime + Math.min(15, Math.max(4, shot.duration)))
  )
  const trackIndex = Math.max(0, Math.floor(lastShot.trackIndex ?? 0))
  const shot = createLocalDirectorShot({
    sceneId: scene.id,
    sceneTitle: scene.title,
    index: scene.shots.length,
    taskType: lastShot.taskType,
    startTime,
    trackIndex
  })
  const next = {
    ...planning,
    emptyTrack: false,
    selectedShotId: shot.id,
    scenes: planning.scenes.map((item) =>
      item.id === scene.id ? { ...item, shots: [...item.shots, shot] } : item
    )
  }
  return resolveDirectorShotTrack(next, shot.id, trackIndex)
}

export function setDirectorPlanning(
  editor: EditorCore,
  planning: EditingDirectorPlanningState
): void {
  const project = editor.project.getActive()
  editor.project.setActiveProject({
    project: { ...project, directorPlanning: resolveDirectorTrackOverlaps(planning) } as TProject
  })
  editor.save.markDirty()
  const shotIds = new Set(planning.scenes.flatMap((scene) => scene.shots.map((shot) => shot.id)))
  const tracks = editor.timeline.getTracks()
  const nextTracks = tracks.map((track) => ({
    ...track,
    elements: track.elements.filter(
      (element) =>
        !isDirectorGenerationPlaceholder(element) ||
        element.directorGeneration.shotIds.every((id) => shotIds.has(id))
    )
  })) as typeof tracks
  if (tracks.some((track, index) => track.elements.length !== nextTracks[index].elements.length))
    editor.timeline.updateTracks(nextTracks)
  window.dispatchEvent(new CustomEvent(DIRECTOR_PLANNING_EVENT))
}

export function reflowDirectorPlanning(
  planning: EditingDirectorPlanningState,
  startTime = 0
): EditingDirectorPlanningState {
  let cursor = Number.isFinite(startTime) ? Math.max(0, startTime) : 0
  return {
    ...planning,
    scenes: planning.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => {
        const duration = asDuration(shot.duration)
        const next = {
          ...shot,
          duration,
          targetDuration: shot.targetDuration ?? duration,
          startTime: cursor
        }
        cursor += duration
        return next
      })
    }))
  }
}

/**
 * Add a director-library snapshot starting at the playhead captured when it was dropped.
 *
 * A library item may be dragged into the timeline more than once, and two
 * different canvas director boards can contain the same scene ids. Re-key the
 * incoming scenes and shots while merging so each planning track stays
 * addressable and independent.
 */
export function mergeDirectorPlanning(
  current: EditingDirectorPlanningState | null,
  incoming: EditingDirectorPlanningState,
  sourceLibraryItemId?: string,
  startTime = 0
): EditingDirectorPlanningState {
  if (!current) {
    return reflowDirectorPlanning(
      {
        ...incoming,
        scenes: incoming.scenes.map((scene) => ({
          ...scene,
          ...(sourceLibraryItemId ? { sourceLibraryItemId } : {})
        }))
      },
      startTime
    )
  }

  let cursor = Number.isFinite(startTime) ? Math.max(0, startTime) : 0
  const scenes = incoming.scenes.map((scene) => {
    const sceneId = generateUUID()
    return {
      ...scene,
      id: sceneId,
      ...(sourceLibraryItemId ? { sourceLibraryItemId } : {}),
      shots: scene.shots.map((shot) => {
        const duration = asDuration(shot.duration)
        const startTime = cursor
        cursor += duration
        return {
          ...shot,
          id: generateUUID(),
          sceneId,
          sceneTitle: scene.title,
          startTime,
          duration,
          targetDuration: asDuration(shot.targetDuration ?? shot.duration),
          trackIndex: 0
        }
      })
    }
  })

  let next: EditingDirectorPlanningState = {
    ...current,
    schemaVersion: 1,
    emptyTrack: false,
    scenes: [...current.scenes, ...scenes],
    assetMap: { ...current.assetMap, ...incoming.assetMap },
    ...((current.source ?? incoming.source) ? { source: current.source ?? incoming.source } : {})
  }
  for (const scene of scenes) {
    for (const shot of scene.shots) next = resolveDirectorShotTrack(next, shot.id, 0)
  }
  return resolveDirectorTrackOverlaps(next)
}

export function updateDirectorShot(
  planning: EditingDirectorPlanningState,
  shotId: string,
  updates: Partial<EditingDirectorShot>
): EditingDirectorPlanningState {
  const next = {
    ...planning,
    scenes: planning.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) =>
        shot.id === shotId
          ? {
              ...shot,
              ...updates,
              duration: scene.settings.task_type === 'MotionTransfer' ? Number(updates.duration ?? shot.duration) : asDuration(updates.duration ?? shot.duration),
              trackIndex: Number.isFinite(Number(updates.trackIndex))
                ? Math.max(0, Math.floor(Number(updates.trackIndex)))
                : Math.max(0, Math.floor(Number(shot.trackIndex ?? 0)))
            }
          : shot
      )
    }))
  }
  return 'startTime' in updates || 'duration' in updates || 'trackIndex' in updates
    ? resolveDirectorShotTrack(next, shotId, updates.trackIndex)
    : next
}

const directorSceneSnapshotKey = (scene: EditingDirectorScene): string =>
  JSON.stringify({
    title: scene.title,
    shots: scene.shots.map((shot) => ({
      sourceSegmentId: shot.sourceSegmentId ?? '',
      title: shot.title,
      prompt: shot.prompt,
      taskType: shot.taskType
    }))
  })

const collectDirectorAssetIds = (value: unknown, target: Set<string>): void => {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item) => collectDirectorAssetIds(item, target))
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === 'string' && (key === 'assetId' || key.endsWith('AssetId'))) {
      target.add(child)
    } else {
      collectDirectorAssetIds(child, target)
    }
  }
}

export type RemoveDirectorLibraryResult = {
  removed: boolean
  removedSceneCount: number
  removedAssetCount: number
}

/** Remove one imported director snapshot and all of its AI planning copies from this edit project. */
export async function removeDirectorLibraryItem(
  editor: EditorCore,
  itemId: string
): Promise<RemoveDirectorLibraryResult> {
  const project = editor.project.getActive() as DirectorProject
  const library = Array.isArray(project.directorLibrary) ? project.directorLibrary : []
  const item = library.find((candidate) => candidate.id === itemId)
  if (!item) return { removed: false, removedSceneCount: 0, removedAssetCount: 0 }

  const remainingLibrary = library.filter((candidate) => candidate.id !== itemId)
  const planning = getDirectorPlanning(project)
  const itemSceneIds = new Set(item.planning.scenes.map((scene) => scene.id))
  const itemSceneKeys = new Set(item.planning.scenes.map(directorSceneSnapshotKey))
  const removeAllLegacyScenes = library.length === 1
  const removedScenes =
    planning?.scenes.filter((scene) => {
      if (scene.createdInEditing) return false
      if (scene.sourceLibraryItemId) return scene.sourceLibraryItemId === itemId
      return (
        removeAllLegacyScenes ||
        itemSceneIds.has(scene.id) ||
        itemSceneKeys.has(directorSceneSnapshotKey(scene))
      )
    }) ?? []
  const removedSceneIds = new Set(removedScenes.map((scene) => scene.id))
  const remainingScenes = planning?.scenes.filter((scene) => !removedSceneIds.has(scene.id)) ?? []

  const candidateAssetIds = new Set(Object.values(item.planning.assetMap))
  removedScenes.forEach((scene) => collectDirectorAssetIds(scene, candidateAssetIds))

  const protectedAssetIds = new Set<string>()
  for (const candidate of remainingLibrary) {
    Object.values(candidate.planning.assetMap).forEach((assetId) => protectedAssetIds.add(assetId))
    candidate.planning.scenes.forEach((scene) => collectDirectorAssetIds(scene, protectedAssetIds))
  }
  remainingScenes.forEach((scene) => collectDirectorAssetIds(scene, protectedAssetIds))
  for (const track of editor.timeline.getTracks()) {
    for (const element of track.elements) {
      const mediaId = (element as { mediaId?: unknown }).mediaId
      if (typeof mediaId === 'string' && mediaId) protectedAssetIds.add(mediaId)
    }
  }

  const orphanAssetIds = [...candidateAssetIds].filter((assetId) => !protectedAssetIds.has(assetId))
  const remainingPlanningAssetIds = new Set<string>()
  remainingScenes.forEach((scene) => collectDirectorAssetIds(scene, remainingPlanningAssetIds))
  const remainingShotIds = new Set(
    remainingScenes.flatMap((scene) => scene.shots.map((shot) => shot.id))
  )
  const selectedShotId =
    planning?.selectedShotId && remainingShotIds.has(planning.selectedShotId)
      ? planning.selectedShotId
      : remainingScenes[0]?.shots[0]?.id
  const nextPlanning =
    planning && remainingScenes.length > 0
      ? {
          ...planning,
          source:
            remainingLibrary.find((candidate) =>
              remainingScenes.some((scene) => scene.sourceLibraryItemId === candidate.id)
            )?.source ?? planning.source,
          scenes: remainingScenes,
          assetMap: Object.fromEntries(
            Object.entries(planning.assetMap).filter(([, assetId]) =>
              remainingPlanningAssetIds.has(assetId)
            )
          ),
          selectedShotId
        }
      : undefined

  editor.project.setActiveProject({
    project: {
      ...project,
      directorLibrary: remainingLibrary,
      directorPlanning: nextPlanning ? compactDirectorTracks(nextPlanning) : undefined
    } as TProject
  })
  editor.save.markDirty()
  window.dispatchEvent(new CustomEvent(DIRECTOR_PLANNING_EVENT))

  const tracks = editor.timeline.getTracks()
  const nextTracks = tracks.map((track) => ({
    ...track,
    elements: track.elements.filter(
      (element) =>
        !isDirectorGenerationPlaceholder(element) ||
        !removedSceneIds.has(element.directorGeneration.sceneId)
    )
  })) as typeof tracks
  if (tracks.some((track, index) => track.elements.length !== nextTracks[index].elements.length))
    editor.timeline.updateTracks(nextTracks)

  await Promise.all(
    orphanAssetIds.map((id) =>
      editor.media.removeMediaAsset({ projectId: project.metadata.id, id })
    )
  )
  return {
    removed: true,
    removedSceneCount: removedScenes.length,
    removedAssetCount: orphanAssetIds.length
  }
}

export function removeDirectorShot(
  planning: EditingDirectorPlanningState,
  shotId: string
): EditingDirectorPlanningState {
  const orderedShots = planning.scenes.flatMap((scene) => scene.shots)
  const removedIndex = orderedShots.findIndex((shot) => shot.id === shotId)
  if (removedIndex < 0) return planning

  const scenes = planning.scenes
    .map((scene) => ({
      ...scene,
      shots: scene.shots.filter((shot) => shot.id !== shotId)
    }))
    .filter((scene) => scene.shots.length > 0)
  const remainingShots = scenes.flatMap((scene) => scene.shots)
  const selectedShotId =
    planning.selectedShotId === shotId
      ? remainingShots[Math.min(removedIndex, remainingShots.length - 1)]?.id
      : planning.selectedShotId

  return compactDirectorTracks({
    ...planning,
    emptyTrack: false,
    scenes,
    ...(selectedShotId ? { selectedShotId } : { selectedShotId: undefined })
  })
}

export function updateDirectorSceneSettings(
  planning: EditingDirectorPlanningState,
  sceneId: string,
  settings: Record<string, unknown>
): EditingDirectorPlanningState {
  return {
    ...planning,
    scenes: planning.scenes.map((scene) =>
      scene.id === sceneId ? { ...scene, settings: { ...scene.settings, ...settings } } : scene
    )
  }
}

export function findDirectorShot(
  planning: EditingDirectorPlanningState,
  shotId: string
): EditingDirectorShot | null {
  for (const scene of planning.scenes) {
    const shot = scene.shots.find((item) => item.id === shotId)
    if (shot) return shot
  }
  return null
}

export function findDirectorScene(
  planning: EditingDirectorPlanningState,
  shotId: string
): EditingDirectorScene | null {
  return planning.scenes.find((scene) => scene.shots.some((shot) => shot.id === shotId)) ?? null
}
