import { generateUUID } from '@/utils/id'
import type {
  EditingDirectorPlanningState,
  EditingDirectorScene,
  EditingDirectorShot,
  EditingDirectorTaskType
} from './editing'

type DirectorImportSource = {
  projectId: string
  projectName: string
  id: string
  data: Record<string, unknown>
}

const TASK_TYPES: EditingDirectorTaskType[] = ['t2v', 'i2v', 'fl2v', 'r2v', 'v2v', 'rv2v']

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const asText = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback

const asDuration = (value: unknown, fallback = 5) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(15, Math.max(4, number)) : fallback
}

const taskType = (value: unknown): EditingDirectorTaskType =>
  TASK_TYPES.includes(String(value) as EditingDirectorTaskType)
    ? (String(value) as EditingDirectorTaskType)
    : 't2v'

const mapReferenceList = (value: unknown, assetMap: Record<string, string>) => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, position) => {
    const record = asRecord(item)
    const sourceId = asText(record.assetId ?? record.id)
    const assetId = assetMap[sourceId]
    return assetId
      ? [{
          assetId,
          index: Number.isInteger(Number(record.index)) ? Number(record.index) : position,
          originalName: asText(record.originalName)
        }]
      : []
  })
}

const mapSettingsReferences = (
  settings: Record<string, unknown>,
  assetMap: Record<string, string>
): Record<string, unknown> => {
  const next = { ...settings }
  for (const key of ['directorGlobalRefs', 'directorGlobalRefVideos', 'directorGlobalRefAudios']) {
    const source =
      key === 'directorGlobalRefs'
        ? 'globalRefs'
        : key === 'directorGlobalRefVideos'
          ? 'globalRefVideos'
          : 'globalRefAudios'
    next[source] = mapReferenceList(settings[key], assetMap)
  }
  const sourceVideo = asRecord(settings.directorSourceVideo)
  const sourceVideoAssetId = assetMap[asText(sourceVideo.assetId)]
  if (sourceVideoAssetId) next.sourceVideo = { ...sourceVideo, assetId: sourceVideoAssetId }
  if (Array.isArray(settings.directorVideoClips)) {
    next.videoClips = settings.directorVideoClips.flatMap((item) => {
      const clip = asRecord(item)
      const assetId = assetMap[asText(clip.assetId)]
      return assetId ? [{ ...clip, assetId }] : []
    })
  }
  return next
}

const firstReferenceAssetId = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const assetId = (item as { assetId?: unknown }).assetId
    if (typeof assetId === 'string' && assetId) return assetId
  }
  return undefined
}

/** Resolve the first still image that represents a director shot. */
export function getDirectorShotPreviewAssetId(
  shot: EditingDirectorShot,
  scene: EditingDirectorScene
): string | undefined {
  const globalReference = firstReferenceAssetId(
    scene.settings.globalRefs ?? scene.settings.directorGlobalRefs
  )
  if (shot.taskType === 'fl2v') {
    return shot.firstFrameAssetId ?? shot.lastFrameAssetId ?? shot.imageAssetId ?? shot.refs[0]?.assetId ?? globalReference
  }
  if (shot.taskType === 'i2v') {
    return shot.imageAssetId ?? shot.firstFrameAssetId ?? shot.refs[0]?.assetId ?? globalReference
  }
  if (shot.taskType === 'r2v' || shot.taskType === 'rv2v') {
    return shot.refs[0]?.assetId ?? globalReference ?? shot.firstFrameAssetId ?? shot.imageAssetId
  }
  return shot.firstFrameAssetId ?? shot.imageAssetId ?? shot.refs[0]?.assetId ?? globalReference ?? shot.lastFrameAssetId
}

/** Resolve the first usable still image in director order for library covers. */
export function getDirectorPlanningPreviewAssetId(
  planning: EditingDirectorPlanningState
): string | undefined {
  for (const scene of planning.scenes) {
    for (const shot of scene.shots) {
      const assetId = getDirectorShotPreviewAssetId(shot, scene)
      if (assetId) return assetId
    }
  }
  return undefined
}

/** Convert a canvas-owned director node into an independent editing snapshot. */
export function normalizeDirectorImport(
  source: DirectorImportSource,
  assetMap: Record<string, string>
): EditingDirectorPlanningState {
  const rawScenes =
    Array.isArray(source.data.directorScenes) && source.data.directorScenes.length
      ? source.data.directorScenes
      : [{ id: 'director-scene-1', title: '第1场', data: source.data }]
  const scenes: EditingDirectorScene[] = []
  let startTime = 0
  for (let sceneIndex = 0; sceneIndex < rawScenes.length; sceneIndex += 1) {
    const record = asRecord(rawScenes[sceneIndex])
    const settings = asRecord(record.data ?? record.config ?? record)
    const rawSegments =
      Array.isArray(settings.directorSegments) && settings.directorSegments.length
        ? settings.directorSegments
        : [{ id: `segment-${sceneIndex + 1}-1`, title: '镜头 1', duration: 5, prompt: '' }]
    const sceneId = asText(record.id, `director-scene-${sceneIndex + 1}`)
    const sceneTitle = asText(record.title, `第${sceneIndex + 1}场`)
    const scene: EditingDirectorScene = {
      id: sceneId,
      title: sceneTitle,
      settings: mapSettingsReferences(settings, assetMap),
      shots: []
    }
    for (let segmentIndex = 0; segmentIndex < rawSegments.length; segmentIndex += 1) {
      const segment = asRecord(rawSegments[segmentIndex])
      const sourceSegmentId = asText(segment.id, `segment-${sceneIndex + 1}-${segmentIndex + 1}`)
      const imageAssetId = assetMap[asText(segment.imageAssetId)]
      const firstFrameAssetId = assetMap[asText(segment.firstFrameAssetId)]
      const lastFrameAssetId = assetMap[asText(segment.lastFrameAssetId)]
      const duration = asDuration(segment.duration)
      const shot: EditingDirectorShot = {
        id: generateUUID(),
        sceneId,
        sceneTitle,
        sourceSegmentId,
        title: asText(segment.title, `镜头 ${segmentIndex + 1}`),
        startTime,
        duration,
        trackIndex: 0,
        targetDuration: duration,
        prompt: asText(segment.prompt),
        taskType: taskType(settings.directorTaskType ?? source.data.directorTaskType),
        continuityFromPrev: segment.continuityFromPrev === true,
        ...(asText(segment.videoClipId) ? { videoClipId: asText(segment.videoClipId) } : {}),
        ...(imageAssetId ? { imageAssetId } : {}),
        ...(firstFrameAssetId ? { firstFrameAssetId } : {}),
        ...(lastFrameAssetId ? { lastFrameAssetId } : {}),
        refs: mapReferenceList(segment.refs, assetMap),
        refVideos: mapReferenceList(segment.refVideos, assetMap),
        refAudios: mapReferenceList(segment.refAudios, assetMap),
        generationStatus: 'idle',
        outputVersions: [],
        durationResolution: 'pending',
        sourceSnapshot: JSON.parse(JSON.stringify(segment)) as Record<string, unknown>
      }
      scene.shots.push(shot)
      startTime += duration
    }
    scenes.push(scene)
  }
  return {
    schemaVersion: 1,
    source: {
      kind: 'canvas-director',
      canvasProjectId: source.projectId,
      canvasProjectName: source.projectName,
      canvasNodeId: source.id,
      importedAt: new Date().toISOString()
    },
    scenes,
    assetMap
  }
}
