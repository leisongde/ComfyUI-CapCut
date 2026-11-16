import type { EditingDirectorScene, EditingDirectorShot } from '../../shared/editing'

// Reserve one compact row for the scene label and one row for its shot markers.
// The ruler and playhead use this value so the two rows never overlap the timeline.
export const DIRECTOR_SCENE_BAR_HEIGHT = 46

export const DIRECTOR_SCENE_COLORS = [
  '#2f8f69',
  '#3d73a8',
  '#8b5ba7',
  '#a66a35',
  '#2f8b91',
  '#8b5d70'
] as const

export function getDirectorSceneShots(scene: EditingDirectorScene): EditingDirectorShot[] {
  return scene.shots.filter((shot) => Number.isFinite(Number(shot.startTime)))
}

const getDirectorShotEndTime = (shot: EditingDirectorShot): number => {
  const startTime = Math.max(0, Number(shot.startTime))
  const duration = Number(shot.duration)
  const normalizedDuration = Number.isFinite(duration) ? Math.min(15, Math.max(4, duration)) : 5
  return startTime + normalizedDuration
}

export function getDirectorSceneRange(scene: EditingDirectorScene): {
  startTime: number
  endTime: number
} | null {
  const shots = getDirectorSceneShots(scene)
  if (shots.length === 0) return null
  const startTime = Math.min(...shots.map((shot) => Math.max(0, Number(shot.startTime))))
  const endTime = Math.max(...shots.map(getDirectorShotEndTime))
  return { startTime, endTime: Math.max(startTime, endTime) }
}

/** Only a shared edge on the same AI track can offer a continuity shortcut. */
export function getDirectorContinuityJoints(scene: EditingDirectorScene, frameRate = 30) {
  const shots = [...getDirectorSceneShots(scene)].sort((left, right) => left.startTime - right.startTime)
  const epsilon = 1 / Math.max(1, Number(frameRate) || 30)
  return shots.slice(1).flatMap((shot, index) => {
    const previous = shots[index]
    // Continuity follows the director's chronological shot order. AI clips can
    // move to another visual row to avoid overlap, so the row is not part of
    // the semantic boundary.
    if (Math.abs(getDirectorShotEndTime(previous) - shot.startTime) > epsilon + 1e-8) return []
    return [{
      previousShotId: previous.id,
      shotId: shot.id,
      time: Math.max(0, shot.startTime),
      trackIndex: Math.max(0, Math.floor(shot.trackIndex ?? 0)),
      enabled: scene.settings.directorContinuityEnabled === true && shot.continuityFromPrev === true
    }]
  })
}

/**
 * Whether all shots in a scene form one connected time range.
 * Overlapping intervals and frame-adjacent intervals belong to the same group;
 * a real gap means the scene contains multiple generation groups.
 */
export function areDirectorSceneShotsConnected(
  scene: EditingDirectorScene,
  frameRate = 30
): boolean {
  const shots = getDirectorSceneShots(scene)
    .map((shot) => ({
      startTime: Math.max(0, Number(shot.startTime)),
      endTime: getDirectorShotEndTime(shot)
    }))
    .sort((left, right) => left.startTime - right.startTime)
  if (shots.length < 2) return shots.length === 1
  const epsilon = 1 / Math.max(1, Number(frameRate) || 30)
  let connectedEnd = shots[0].endTime
  for (const shot of shots.slice(1)) {
    if (shot.startTime > connectedEnd + epsilon) return false
    connectedEnd = Math.max(connectedEnd, shot.endTime)
  }
  return true
}

export function getDirectorSceneColor(sceneIndex: number): string {
  return DIRECTOR_SCENE_COLORS[Math.max(0, sceneIndex) % DIRECTOR_SCENE_COLORS.length]
}

/** The scene bar, director editor and generation request share one effective mode. */
export function getDirectorSceneExportMode(
  scene: EditingDirectorScene,
  frameRate = 30
): 'all' | 'segments' {
  return scene.settings.directorExportMode !== 'segments' &&
    areDirectorSceneShotsConnected(scene, frameRate) ? 'all' : 'segments'
}
