import type { TrackTransition, VideoElement } from '@/types/timeline'
import { splitVisualKeyframesAtTime, type VisualKeyframes } from '../visual-keyframes'
import { splitAudioKeyframesAtTime, type AudioKeyframes } from '../audio-keyframes'
import { splitObjectLockAtTime, type ObjectLockSettings } from '../object-lock'
import { splitColorAdjustmentAtTime } from '../color-adjustment'
import type { ClipAnimations } from '../clip-animations'

export type SceneSplitVideoElement = VideoElement & {
  visualKeyframes?: VisualKeyframes
  audioKeyframes?: AudioKeyframes
  objectLock?: ObjectLockSettings
  colorAdjustment?: unknown
  fadeIn?: number
  fadeOut?: number
  clipAnimations?: ClipAnimations
}

const EPSILON = 1e-6
const roundTime = (value: number): number => Math.round(value * 1_000_000) / 1_000_000

function uniqueTimes(times: number[]): number[] {
  return [...new Set(times.map(roundTime))].sort((left, right) => left - right)
}

export function mapSourceCutsToTimeline({
  sourceCuts,
  element
}: {
  sourceCuts: number[]
  element: Pick<VideoElement, 'startTime' | 'duration' | 'trimStart' | 'playbackRate' | 'reversed'>
}): number[] {
  const rate = Math.max(0.01, element.playbackRate ?? 1)
  const sourceStart = element.trimStart
  const sourceEnd = sourceStart + element.duration * rate
  return uniqueTimes(
    sourceCuts
      .filter((time) => time > sourceStart + EPSILON && time < sourceEnd - EPSILON)
      .map((time) => {
        const elapsedSource = (time - sourceStart) / rate
        const localTime = element.reversed ? element.duration - elapsedSource : elapsedSource
        return element.startTime + localTime
      })
  )
}

function sliceVisualKeyframes(
  value: VisualKeyframes | undefined,
  start: number,
  duration: number
): VisualKeyframes | undefined {
  if (!value) return undefined
  const tail =
    start > EPSILON
      ? splitVisualKeyframesAtTime({ visualKeyframes: value, splitTime: start })
          .rightVisualKeyframes
      : value
  if (!tail) return undefined
  return splitVisualKeyframesAtTime({ visualKeyframes: tail, splitTime: duration })
    .leftVisualKeyframes
}

function sliceAudioKeyframes(
  value: AudioKeyframes | undefined,
  start: number,
  duration: number
): AudioKeyframes | undefined {
  if (!value) return undefined
  const tail =
    start > EPSILON
      ? splitAudioKeyframesAtTime({ audioKeyframes: value, splitTime: start }).rightAudioKeyframes
      : value
  if (!tail) return undefined
  return splitAudioKeyframesAtTime({ audioKeyframes: tail, splitTime: duration }).leftAudioKeyframes
}

function sliceObjectLock(
  value: ObjectLockSettings | undefined,
  start: number,
  duration: number
): ObjectLockSettings | undefined {
  if (!value) return undefined
  const tail =
    start > EPSILON ? splitObjectLockAtTime({ value, splitTime: start }).rightObjectLock : value
  if (!tail) return undefined
  return splitObjectLockAtTime({ value: tail, splitTime: duration }).leftObjectLock
}

function sliceColorAdjustment(value: unknown, start: number, duration: number): unknown {
  if (value === undefined) return undefined
  const tail =
    start > EPSILON ? splitColorAdjustmentAtTime({ value, splitTime: start }).right : value
  return splitColorAdjustmentAtTime({ value: tail, splitTime: duration }).left
}

function sliceClipAnimations(
  value: ClipAnimations | undefined,
  segmentIndex: number,
  segmentCount: number
): ClipAnimations | undefined {
  if (!value) return undefined
  const result: ClipAnimations = {}
  if (segmentIndex === 0 && value.in) result.in = { ...value.in }
  if (segmentIndex === segmentCount - 1 && value.out) result.out = { ...value.out }
  if (value.combo) result.combo = { ...value.combo }
  return Object.keys(result).length ? result : undefined
}

export function buildSceneSplitSegments({
  element,
  timelineCuts,
  createId
}: {
  element: SceneSplitVideoElement
  timelineCuts: number[]
  createId: (segmentIndex: number) => string
}): SceneSplitVideoElement[] {
  const start = element.startTime
  const end = element.startTime + element.duration
  const cuts = uniqueTimes(timelineCuts).filter(
    (time) => time > start + EPSILON && time < end - EPSILON
  )
  if (!cuts.length) return [element]

  const boundaries = [start, ...cuts, end]
  const rate = Math.max(0.01, element.playbackRate ?? 1)
  const segmentCount = boundaries.length - 1

  return Array.from({ length: segmentCount }, (_, segmentIndex) => {
    const segmentStart = boundaries[segmentIndex]
    const segmentEnd = boundaries[segmentIndex + 1]
    const localStart = segmentStart - start
    const localEnd = segmentEnd - start
    const duration = segmentEnd - segmentStart
    const trimStart = element.reversed
      ? element.trimStart + (element.duration - localEnd) * rate
      : element.trimStart + localStart * rate
    const trimEnd = element.reversed
      ? element.trimEnd + localStart * rate
      : element.trimEnd + (element.duration - localEnd) * rate

    return {
      ...element,
      id: segmentIndex === 0 ? element.id : createId(segmentIndex),
      name: `${element.name} · 镜头 ${segmentIndex + 1}`,
      startTime: roundTime(segmentStart),
      duration: roundTime(duration),
      trimStart: roundTime(trimStart),
      trimEnd: roundTime(trimEnd),
      visualKeyframes: sliceVisualKeyframes(element.visualKeyframes, localStart, duration),
      audioKeyframes: sliceAudioKeyframes(element.audioKeyframes, localStart, duration),
      objectLock: sliceObjectLock(element.objectLock, localStart, duration),
      colorAdjustment: sliceColorAdjustment(element.colorAdjustment, localStart, duration),
      fadeIn: segmentIndex === 0 ? element.fadeIn : 0,
      fadeOut: segmentIndex === segmentCount - 1 ? element.fadeOut : 0,
      clipAnimations: sliceClipAnimations(element.clipAnimations, segmentIndex, segmentCount)
    }
  })
}

export function remapSceneSplitTransitions({
  transitions,
  originalElementId,
  lastSegmentId
}: {
  transitions: TrackTransition[] | undefined
  originalElementId: string
  lastSegmentId: string
}): TrackTransition[] | undefined {
  if (!transitions) return undefined
  return transitions.map((transition) => ({
    ...transition,
    fromElementId:
      transition.fromElementId === originalElementId ? lastSegmentId : transition.fromElementId
  }))
}
