export function normalizeTimelineStartTime(requestedStartTime: number): number {
  return Math.max(0, requestedStartTime)
}
