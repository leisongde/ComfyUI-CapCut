export const FREEZE_FRAME_DURATION = 5

const TIME_EPSILON = 1e-6

export interface FreezeFramePlacement {
  captureTime: number
  insertionTime: number
  shouldSplit: boolean
}

export function resolveFreezeFramePlacement({
  clipStart,
  clipDuration,
  playheadTime,
  fps
}: {
  clipStart: number
  clipDuration: number
  playheadTime: number
  fps: number
}): FreezeFramePlacement | null {
  const clipEnd = clipStart + clipDuration
  if (
    !Number.isFinite(playheadTime) ||
    playheadTime < clipStart - TIME_EPSILON ||
    playheadTime > clipEnd + TIME_EPSILON
  ) {
    return null
  }

  const frameDuration = 1 / Math.max(1, fps)
  const clampedTime = Math.min(clipEnd, Math.max(clipStart, playheadTime))
  const isLastFrame = clipEnd - clampedTime <= frameDuration + TIME_EPSILON
  const insertionTime = isLastFrame ? clipEnd : clampedTime
  const captureTime = isLastFrame
    ? Math.max(clipStart, clipEnd - frameDuration)
    : clampedTime

  return {
    captureTime,
    insertionTime,
    shouldSplit:
      insertionTime > clipStart + TIME_EPSILON && insertionTime < clipEnd - TIME_EPSILON
  }
}

