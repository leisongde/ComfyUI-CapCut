import type { EditingDirectorPlanningState, EditingDirectorShot } from './editing'

const rowOf = (shot: EditingDirectorShot): number => {
  const row = Number(shot.trackIndex)
  return Number.isFinite(row) ? Math.max(0, Math.floor(row)) : 0
}

const overlaps = (left: EditingDirectorShot, right: EditingDirectorShot): boolean =>
  left.startTime < right.startTime + right.duration - 1e-7 &&
  left.startTime + left.duration > right.startTime + 1e-7

export function getDirectorTrackCount(planning: EditingDirectorPlanningState | null): number {
  const rows = planning?.scenes.flatMap((scene) => scene.shots.map((shot) => rowOf(shot) + 1)) ?? []
  return Math.max(planning?.trackCount ?? 2, ...rows)
}

export function removeEmptyDirectorTrack(
  planning: EditingDirectorPlanningState,
  trackIndex: number
): EditingDirectorPlanningState {
  const count = getDirectorTrackCount(planning)
  if (trackIndex < 0 || trackIndex >= count ||
      planning.scenes.some((scene) => scene.shots.some((shot) => rowOf(shot) === trackIndex))) return planning
  return {
    ...planning,
    trackCount: count - 1,
    scenes: planning.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => rowOf(shot) > trackIndex
        ? { ...shot, trackIndex: rowOf(shot) - 1 } : shot)
    }))
  }
}

/** Remove empty rows while preserving the order and membership of occupied rows. */
export function compactDirectorTracks(
  planning: EditingDirectorPlanningState
): EditingDirectorPlanningState {
  if (planning.trackCount !== undefined) return planning
  const occupiedRows = [...new Set(planning.scenes.flatMap((scene) => scene.shots.map(rowOf)))]
    .sort((left, right) => left - right)
  if (occupiedRows.every((row, index) => row === index)) return planning
  const rowMap = new Map(occupiedRows.map((row, index) => [row, index]))
  return {
    ...planning,
    scenes: planning.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => {
        const trackIndex = rowMap.get(rowOf(shot))!
        return trackIndex === rowOf(shot) ? shot : { ...shot, trackIndex }
      })
    }))
  }
}

/** Keep the requested time and find space on this row or above it. Row zero is the top. */
export function resolveDirectorShotTrack(
  planning: EditingDirectorPlanningState,
  shotId: string,
  preferredTrackIndex?: number
): EditingDirectorPlanningState {
  const shots = planning.scenes.flatMap((scene) => scene.shots)
  const moving = shots.find((shot) => shot.id === shotId)
  if (!moving) return planning
  const requested = Number(preferredTrackIndex ?? rowOf(moving))
  let targetRow = Number.isFinite(requested) ? Math.floor(requested) : rowOf(moving)
  const rowIsAvailable = (row: number) => !shots.some((shot) =>
    shot.id !== shotId && rowOf(shot) === row && overlaps(moving, shot)
  )
  // Hidden clips still occupy their own space, just like hidden native video clips.
  while (targetRow >= 0 && !rowIsAvailable(targetRow)) targetRow--
  const insertTopRow = targetRow < 0
  if (insertTopRow) targetRow = 0
  if (!insertTopRow && rowOf(moving) === targetRow) return planning
  return {
    ...planning,
    trackCount: planning.trackCount === undefined ? undefined
      : Math.max(getDirectorTrackCount(planning) + (insertTopRow ? 1 : 0), targetRow + 1),
    scenes: planning.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => shot.id === shotId
        ? { ...shot, trackIndex: targetRow }
        : insertTopRow ? { ...shot, trackIndex: rowOf(shot) + 1 } : shot)
    }))
  }
}

/** Separate overlaps and remove empty rows when committing or opening planning. */
export function resolveDirectorTrackOverlaps(
  planning: EditingDirectorPlanningState
): EditingDirectorPlanningState {
  let next = planning
  const shotIds = planning.scenes.flatMap((scene) => scene.shots.map((shot) => shot.id))
  for (const id of shotIds.reverse()) next = resolveDirectorShotTrack(next, id)
  return compactDirectorTracks(next)
}
