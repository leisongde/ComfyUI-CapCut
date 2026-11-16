import type { Transform } from '@/types/timeline'
import {
  cloneScalarChannel,
  getScalarChannelValueAtTime,
  normalizeScalarChannel,
  splitScalarChannelAtTime,
  updateScalarKeyframeCurve,
  upsertScalarKeyframe,
  type ScalarAnimationKey,
  type ScalarCurveKeyframePatch
} from './animation'
import { resolveClipAnimations, type ClipAnimations } from './clip-animations'
import { resolveObjectLockTransform } from './object-lock'

export type { ClipAnimations } from './clip-animations'

export const VISUAL_KEYFRAME_PROPERTIES = [
  'positionX',
  'positionY',
  'scale',
  'rotation',
  'opacity',
  'fontSize',
  'shadowOffsetX',
  'shadowOffsetY',
  'shadowBlur'
] as const

export type VisualKeyframeProperty = (typeof VISUAL_KEYFRAME_PROPERTIES)[number]

export type VisualKeyframe = ScalarAnimationKey

export type VisualKeyframes = Partial<Record<VisualKeyframeProperty, VisualKeyframe[]>>

export interface VisualKeyframeSource {
  duration: number
  startTime?: number
  timeOffset?: number
  transform: Transform
  opacity: number
  fontSize?: number
  shadow?: {
    color: string
    offsetX: number
    offsetY: number
    blur: number
  }
  visualKeyframes?: VisualKeyframes
  clipAnimations?: ClipAnimations
  objectLock?: unknown
}

export interface VisualState {
  transform: Transform
  opacity: number
}

export interface TextVisualState extends VisualState {
  fontSize: number
  shadow?: {
    color: string
    offsetX: number
    offsetY: number
    blur: number
  }
}

export function rotateVisualSourceByQuarterTurn(
  source: VisualKeyframeSource
): Pick<VisualKeyframeSource, 'transform'> &
  Partial<Pick<VisualKeyframeSource, 'visualKeyframes'>> {
  const rotate = ((source.transform.rotate + 90) % 360 + 360) % 360
  const rotationDelta = rotate - source.transform.rotate
  const rotation = source.visualKeyframes?.rotation?.map((keyframe) => ({
    ...keyframe,
    value: keyframe.value + rotationDelta
  }))

  return {
    transform: { ...source.transform, rotate },
    ...(rotation ? { visualKeyframes: { ...source.visualKeyframes, rotation } } : {})
  }
}

const TIME_PRECISION = 1_000_000
const DEFAULT_TIME_EPSILON = 1 / 120

function roundTime(time: number): number {
  return Math.round(time * TIME_PRECISION) / TIME_PRECISION
}

function getStartTime(source: VisualKeyframeSource): number {
  return source.startTime ?? source.timeOffset ?? 0
}

export function getVisualLocalTime({
  source,
  timelineTime
}: {
  source: VisualKeyframeSource
  timelineTime: number
}): number {
  return roundTime(Math.max(0, Math.min(source.duration, timelineTime - getStartTime(source))))
}

export function normalizeVisualKeyframes(
  keyframes: VisualKeyframe[] | undefined,
  duration = Number.POSITIVE_INFINITY
): VisualKeyframe[] {
  return normalizeScalarChannel({ channel: { keys: keyframes ?? [] }, duration }).keys
}

export function getVisualPropertyBaseValue({
  source,
  property
}: {
  source: VisualKeyframeSource
  property: VisualKeyframeProperty
}): number {
  switch (property) {
    case 'positionX':
      return source.transform.position.x
    case 'positionY':
      return source.transform.position.y
    case 'scale':
      return source.transform.scale
    case 'rotation':
      return source.transform.rotate
    case 'opacity':
      return source.opacity
    case 'fontSize':
      return source.fontSize ?? 0
    case 'shadowOffsetX':
      return source.shadow?.offsetX ?? 0
    case 'shadowOffsetY':
      return source.shadow?.offsetY ?? 0
    case 'shadowBlur':
      return source.shadow?.blur ?? 0
  }
}

export function interpolateVisualKeyframes({
  keyframes,
  time,
  fallback
}: {
  keyframes: VisualKeyframe[] | undefined
  time: number
  fallback: number
}): number {
  return getScalarChannelValueAtTime({
    channel: keyframes ? { keys: keyframes } : undefined,
    time,
    fallbackValue: fallback
  })
}

export function resolveVisualProperty({
  source,
  property,
  timelineTime
}: {
  source: VisualKeyframeSource
  property: VisualKeyframeProperty
  timelineTime: number
}): number {
  const localTime = getVisualLocalTime({ source, timelineTime })
  return interpolateVisualKeyframes({
    keyframes: source.visualKeyframes?.[property],
    time: localTime,
    fallback: getVisualPropertyBaseValue({ source, property })
  })
}

export function resolveVisualState({
  source,
  timelineTime
}: {
  source: VisualKeyframeSource
  timelineTime: number
}): VisualState {
  const localTime = getVisualLocalTime({ source, timelineTime })
  const animation = resolveClipAnimations({
    animations: source.clipAnimations,
    localTime,
    clipDuration: source.duration
  })
  const positionX = resolveVisualProperty({ source, property: 'positionX', timelineTime })
  const positionY = resolveVisualProperty({ source, property: 'positionY', timelineTime })
  const scale = resolveVisualProperty({ source, property: 'scale', timelineTime })
  const rotation = resolveVisualProperty({ source, property: 'rotation', timelineTime })
  const opacity = resolveVisualProperty({ source, property: 'opacity', timelineTime })
  const trackedTransform = resolveObjectLockTransform({
    value: source.objectLock,
    localTime,
    timelineTime,
    transform: {
      ...source.transform,
      position: { x: positionX, y: positionY },
      scale,
      rotate: rotation
    }
  })
  return {
    transform: {
      ...trackedTransform,
      position: {
        x: trackedTransform.position.x + animation.offsetX,
        y: trackedTransform.position.y + animation.offsetY
      },
      scale: Math.max(0.01, trackedTransform.scale * animation.scale),
      rotate: trackedTransform.rotate + animation.rotation
    },
    opacity: Math.max(0, Math.min(1, opacity * animation.opacity))
  }
}

export function resolveTextVisualState({
  source,
  timelineTime
}: {
  source: VisualKeyframeSource & { fontSize: number }
  timelineTime: number
}): TextVisualState {
  const visualState = resolveVisualState({ source, timelineTime })
  const shadow = source.shadow
    ? {
        ...source.shadow,
        offsetX: resolveVisualProperty({ source, property: 'shadowOffsetX', timelineTime }),
        offsetY: resolveVisualProperty({ source, property: 'shadowOffsetY', timelineTime }),
        blur: Math.max(0, resolveVisualProperty({ source, property: 'shadowBlur', timelineTime }))
      }
    : undefined
  return {
    ...visualState,
    fontSize: Math.max(1, resolveVisualProperty({ source, property: 'fontSize', timelineTime })),
    shadow
  }
}

export function findVisualKeyframeAtTime({
  keyframes,
  time,
  epsilon = DEFAULT_TIME_EPSILON
}: {
  keyframes: VisualKeyframe[] | undefined
  time: number
  epsilon?: number
}): number {
  return normalizeVisualKeyframes(keyframes).findIndex(
    (keyframe) => Math.abs(keyframe.time - time) <= epsilon
  )
}

function setBaseProperty({
  source,
  property,
  value
}: {
  source: VisualKeyframeSource
  property: VisualKeyframeProperty
  value: number
}): Partial<VisualKeyframeSource> {
  if (property === 'opacity') return { opacity: value }
  if (property === 'fontSize') return { fontSize: value }
  if (property === 'shadowOffsetX') {
    return source.shadow ? { shadow: { ...source.shadow, offsetX: value } } : {}
  }
  if (property === 'shadowOffsetY') {
    return source.shadow ? { shadow: { ...source.shadow, offsetY: value } } : {}
  }
  if (property === 'shadowBlur') {
    return source.shadow ? { shadow: { ...source.shadow, blur: Math.max(0, value) } } : {}
  }
  if (property === 'positionX') {
    return {
      transform: {
        ...source.transform,
        position: { ...source.transform.position, x: value }
      }
    }
  }
  if (property === 'positionY') {
    return {
      transform: {
        ...source.transform,
        position: { ...source.transform.position, y: value }
      }
    }
  }
  if (property === 'scale') return { transform: { ...source.transform, scale: value } }
  return { transform: { ...source.transform, rotate: value } }
}

function upsertVisualKeyframe({
  source,
  property,
  timelineTime,
  value
}: {
  source: VisualKeyframeSource
  property: VisualKeyframeProperty
  timelineTime: number
  value: number
}): VisualKeyframes {
  const localTime = getVisualLocalTime({ source, timelineTime })
  const channel = upsertScalarKeyframe({
    channel: { keys: source.visualKeyframes?.[property] ?? [] },
    time: localTime,
    value,
    duration: source.duration
  })
  return {
    ...source.visualKeyframes,
    [property]: channel.keys
  }
}

export function createVisualPropertyUpdate({
  source,
  property,
  timelineTime,
  value,
  forceKeyframe = false
}: {
  source: VisualKeyframeSource
  property: VisualKeyframeProperty
  timelineTime: number
  value: number
  forceKeyframe?: boolean
}): Partial<VisualKeyframeSource> {
  const isAnimated = (source.visualKeyframes?.[property]?.length ?? 0) > 0
  if (!forceKeyframe && !isAnimated) return setBaseProperty({ source, property, value })
  return {
    visualKeyframes: upsertVisualKeyframe({ source, property, timelineTime, value })
  }
}

export function toggleVisualKeyframe({
  source,
  property,
  timelineTime
}: {
  source: VisualKeyframeSource
  property: VisualKeyframeProperty
  timelineTime: number
}): Partial<VisualKeyframeSource> {
  const localTime = getVisualLocalTime({ source, timelineTime })
  const value = resolveVisualProperty({ source, property, timelineTime })
  const frames = normalizeVisualKeyframes(source.visualKeyframes?.[property], source.duration)
  const index = findVisualKeyframeAtTime({ keyframes: frames, time: localTime })

  if (index < 0) {
    return createVisualPropertyUpdate({
      source,
      property,
      timelineTime,
      value,
      forceKeyframe: true
    })
  }

  frames.splice(index, 1)
  const visualKeyframes: VisualKeyframes = { ...source.visualKeyframes }
  if (frames.length > 0) visualKeyframes[property] = frames
  else delete visualKeyframes[property]

  return {
    ...setBaseProperty({ source, property, value }),
    visualKeyframes
  }
}

export function getNeighborVisualKeyframe({
  source,
  property,
  timelineTime,
  direction
}: {
  source: VisualKeyframeSource
  property: VisualKeyframeProperty
  timelineTime: number
  direction: 'previous' | 'next'
}): VisualKeyframe | undefined {
  const localTime = getVisualLocalTime({ source, timelineTime })
  const frames = normalizeVisualKeyframes(source.visualKeyframes?.[property], source.duration)
  if (direction === 'previous') {
    return [...frames]
      .reverse()
      .find((keyframe) => keyframe.time < localTime - DEFAULT_TIME_EPSILON)
  }
  return frames.find((keyframe) => keyframe.time > localTime + DEFAULT_TIME_EPSILON)
}

export function createVisualTransformUpdate({
  source,
  timelineTime,
  transform
}: {
  source: VisualKeyframeSource
  timelineTime: number
  transform: Transform
}): Partial<VisualKeyframeSource> {
  const current = resolveVisualState({ source, timelineTime }).transform
  let workingSource: VisualKeyframeSource = source
  let updates: Partial<VisualKeyframeSource> = {}

  const apply = (property: VisualKeyframeProperty, value: number) => {
    const previousTransform = updates.transform
    const previousVisualKeyframes = updates.visualKeyframes
    const patch = createVisualPropertyUpdate({
      source: workingSource,
      property,
      timelineTime,
      value
    })
    updates = { ...updates, ...patch }
    if (patch.transform === undefined && previousTransform !== undefined) {
      updates.transform = previousTransform
    }
    if (patch.visualKeyframes === undefined && previousVisualKeyframes !== undefined) {
      updates.visualKeyframes = previousVisualKeyframes
    }
    workingSource = { ...workingSource, ...updates }
  }

  if (transform.position.x !== current.position.x) apply('positionX', transform.position.x)
  if (transform.position.y !== current.position.y) apply('positionY', transform.position.y)
  if (transform.scale !== current.scale) apply('scale', transform.scale)
  if (transform.rotate !== current.rotate) apply('rotation', transform.rotate)

  const baseTransform = updates.transform ?? source.transform
  updates.transform = {
    ...baseTransform,
    flipX: transform.flipX,
    flipY: transform.flipY
  }
  return updates
}

export function getVisualKeyframeTimes(source: VisualKeyframeSource): number[] {
  const times = VISUAL_KEYFRAME_PROPERTIES.flatMap((property) =>
    normalizeVisualKeyframes(source.visualKeyframes?.[property], source.duration).map(
      (keyframe) => keyframe.time
    )
  )
  return Array.from(new Set(times)).sort((left, right) => left - right)
}

function compactVisualKeyframes(visualKeyframes: VisualKeyframes): VisualKeyframes | undefined {
  return Object.values(visualKeyframes).some((keyframes) => keyframes && keyframes.length > 0)
    ? visualKeyframes
    : undefined
}

export function cloneVisualKeyframes({
  visualKeyframes,
  regenerateIds = false
}: {
  visualKeyframes: VisualKeyframes | undefined
  regenerateIds?: boolean
}): VisualKeyframes | undefined {
  if (!visualKeyframes) return undefined
  const cloned: VisualKeyframes = {}
  for (const property of VISUAL_KEYFRAME_PROPERTIES) {
    const channel = cloneScalarChannel({
      channel: visualKeyframes[property] ? { keys: visualKeyframes[property] } : undefined,
      regenerateIds
    })
    if (channel?.keys.length) cloned[property] = channel.keys
  }
  return compactVisualKeyframes(cloned)
}

export function clampVisualKeyframesToDuration({
  visualKeyframes,
  duration
}: {
  visualKeyframes: VisualKeyframes | undefined
  duration: number
}): VisualKeyframes | undefined {
  if (!visualKeyframes || duration <= 0) return undefined
  return splitVisualKeyframesAtTime({
    visualKeyframes,
    splitTime: duration
  }).leftVisualKeyframes
}

export function splitVisualKeyframesAtTime({
  visualKeyframes,
  splitTime
}: {
  visualKeyframes: VisualKeyframes | undefined
  splitTime: number
}): {
  leftVisualKeyframes: VisualKeyframes | undefined
  rightVisualKeyframes: VisualKeyframes | undefined
} {
  if (!visualKeyframes) {
    return { leftVisualKeyframes: undefined, rightVisualKeyframes: undefined }
  }

  const leftVisualKeyframes: VisualKeyframes = {}
  const rightVisualKeyframes: VisualKeyframes = {}
  for (const property of VISUAL_KEYFRAME_PROPERTIES) {
    const result = splitScalarChannelAtTime({
      channel: visualKeyframes[property] ? { keys: visualKeyframes[property] } : undefined,
      splitTime
    })
    if (result.leftChannel?.keys.length) leftVisualKeyframes[property] = result.leftChannel.keys
    if (result.rightChannel?.keys.length) rightVisualKeyframes[property] = result.rightChannel.keys
  }

  return {
    leftVisualKeyframes: compactVisualKeyframes(leftVisualKeyframes),
    rightVisualKeyframes: compactVisualKeyframes(rightVisualKeyframes)
  }
}

export function updateVisualKeyframeCurve({
  keyframes,
  keyframeId,
  patch
}: {
  keyframes: VisualKeyframe[]
  keyframeId: string
  patch: ScalarCurveKeyframePatch
}): VisualKeyframe[] {
  return updateScalarKeyframeCurve({
    channel: { keys: keyframes },
    keyframeId,
    patch
  }).keys
}
