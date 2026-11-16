import type { EditorCore } from '@/core'
import type { EditingDirectorPlanningState } from '../../shared/editing'

/** Planning clips extend the preview even when they are individually hidden. */
export function getDirectorPlanningDuration(
  planning: EditingDirectorPlanningState | null | undefined
): number {
  let end = 0
  for (const scene of planning?.scenes ?? []) {
    for (const shot of scene.shots) {
      const startTime = Number(shot.startTime)
      const duration = Number(shot.duration)
      if (!Number.isFinite(startTime) || !Number.isFinite(duration)) continue
      end = Math.max(end, Math.max(0, startTime) + Math.min(15, Math.max(4, duration)))
    }
  }
  return end
}

/** Preview navigation includes AI planning; export continues to use the native timeline duration. */
export function getPreviewDuration(editor: EditorCore): number {
  const project = editor.project.getActiveOrNull() as {
    directorPlanning?: EditingDirectorPlanningState
  } | null
  return Math.max(
    editor.timeline.getTotalDuration(),
    getDirectorPlanningDuration(project?.directorPlanning)
  )
}
