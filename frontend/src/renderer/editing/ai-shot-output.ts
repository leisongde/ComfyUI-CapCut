import type { EditingDirectorPlanningState, EditingDirectorShot } from '../../shared/editing'

export const AI_SHOT_GUIDE_FRAMES = [5, 22, 39, 56]

export function getAIShotGuideFrames(shot: EditingDirectorShot) {
  return shot.aiTrackGuideFrames ?? 22
}

export function getAITrackOutputMode(planning: EditingDirectorPlanningState | null) {
  return planning?.aiTrackOutputMode === 'all' ? 'all' : 'segments'
}

/** Find adjacent clips on the actual AI tracks, including shots outside the current selection. */
export function getAIShotPredecessors(shots: EditingDirectorShot[], fps: number) {
  const predecessors = new Map<string, EditingDirectorShot>()
  const previousByTrack = new Map<number, EditingDirectorShot>()
  const tolerance = 0.5 / (fps > 0 ? fps : 24) + 1e-8
  for (const shot of [...shots].sort((a, b) => a.startTime - b.startTime)) {
    const track = shot.trackIndex ?? 0
    const previous = previousByTrack.get(track)
    if (previous && Math.abs(previous.startTime + previous.duration - shot.startTime) <= tolerance) {
      predecessors.set(shot.id, previous)
    }
    previousByTrack.set(track, shot)
  }
  return predecessors
}

export function getAIShotExportGroups(shots: EditingDirectorShot[], fps: number) {
  const predecessors = getAIShotPredecessors(shots, fps)
  const groups: EditingDirectorShot[][] = []
  const groupByShot = new Map<string, EditingDirectorShot[]>()
  for (const shot of [...shots].sort((a, b) => a.startTime - b.startTime || (a.trackIndex ?? 0) - (b.trackIndex ?? 0))) {
    const previous = predecessors.get(shot.id)
    let group = previous && groupByShot.get(previous.id)
    if (!group) {
      group = []
      groups.push(group)
    }
    group.push(shot)
    groupByShot.set(shot.id, group)
  }
  return groups
}

export function supportsAIShotGuide(values: Record<string, unknown>) {
  return (values.task_type === 'T2VA' || values.task_type === 'Ref2VA') &&
    values.selflift_enabled !== true && values.refine_enabled !== true
}
