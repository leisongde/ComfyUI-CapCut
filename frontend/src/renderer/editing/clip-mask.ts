export const CLIP_MASK_TYPES = [
  'linear',
  'mirror',
  'circle',
  'rectangle',
  'arc',
  'star',
  'heart'
] as const

export type ClipMaskType = (typeof CLIP_MASK_TYPES)[number]

export const CLIP_MASK_KEYFRAME_PROPERTIES = ['position', 'rotation', 'size', 'feather'] as const

export type ClipMaskKeyframeProperty = (typeof CLIP_MASK_KEYFRAME_PROPERTIES)[number]
export type ClipMaskKeyframeValue =
  | number
  | { x: number; y: number }
  | { width: number; height: number }

export interface ClipMaskKeyframe {
  time: number
  value: ClipMaskKeyframeValue
}

export type ClipMaskKeyframes = Partial<Record<ClipMaskKeyframeProperty, ClipMaskKeyframe[]>>

export interface ClipMask {
  id: string
  type: ClipMaskType
  enabled: boolean
  position: { x: number; y: number }
  width: number
  height: number
  rotation: number
  feather: number
  inverted: boolean
  aspectLocked: boolean
  keyframes: ClipMaskKeyframes
}

export interface ClipMaskSettings {
  enabled: boolean
  activeMaskId: string | null
  masks: ClipMask[]
}

export const CLIP_MASK_LABELS: Record<ClipMaskType, string> = {
  linear: '线性',
  mirror: '镜面',
  circle: '圆形',
  rectangle: '矩形',
  arc: '弧线',
  star: '星形',
  heart: '爱心'
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function createMaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `mask-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createClipMask({
  type = 'rectangle',
  canvasSize,
  id = createMaskId()
}: {
  type?: ClipMaskType
  canvasSize: { width: number; height: number }
  id?: string
}): ClipMask {
  const canvasWidth = Math.max(1, canvasSize.width)
  const canvasHeight = Math.max(1, canvasSize.height)
  const shortEdge = Math.min(canvasWidth, canvasHeight)
  const defaults: Record<ClipMaskType, { width: number; height: number; aspectLocked: boolean }> = {
    linear: { width: canvasWidth * 1.4, height: canvasHeight, aspectLocked: false },
    mirror: { width: canvasWidth * 1.2, height: shortEdge * 0.35, aspectLocked: false },
    circle: { width: shortEdge * 0.62, height: shortEdge * 0.62, aspectLocked: true },
    rectangle: { width: canvasWidth * 0.62, height: canvasHeight * 0.62, aspectLocked: false },
    arc: { width: shortEdge * 0.62, height: shortEdge * 0.62, aspectLocked: true },
    star: { width: shortEdge * 0.62, height: shortEdge * 0.62, aspectLocked: true },
    heart: { width: shortEdge * 0.62, height: shortEdge * 0.62, aspectLocked: true }
  }
  const size = defaults[type]
  return {
    id,
    type,
    enabled: true,
    position: { x: 0, y: 0 },
    width: Math.round(size.width),
    height: Math.round(size.height),
    rotation: 0,
    feather: 0,
    inverted: false,
    aspectLocked: size.aspectLocked,
    keyframes: {}
  }
}

function isClipMaskType(value: unknown): value is ClipMaskType {
  return CLIP_MASK_TYPES.includes(value as ClipMaskType)
}

const KEYFRAME_TIME_EPSILON = 1 / 120
const KEYFRAME_TIME_PRECISION = 1_000_000

function roundTime(time: number): number {
  return Math.round(time * KEYFRAME_TIME_PRECISION) / KEYFRAME_TIME_PRECISION
}

function getMaskPropertyValue(
  mask: ClipMask,
  property: ClipMaskKeyframeProperty
): ClipMaskKeyframeValue {
  if (property === 'position') return { ...mask.position }
  if (property === 'size') return { width: mask.width, height: mask.height }
  return mask[property]
}

function normalizeKeyframeValue(
  property: ClipMaskKeyframeProperty,
  value: unknown
): ClipMaskKeyframeValue | null {
  if (property === 'position') {
    if (!value || typeof value !== 'object') return null
    const source = value as Record<string, unknown>
    const x = finiteNumber(source.x, Number.NaN)
    const y = finiteNumber(source.y, Number.NaN)
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }
  if (property === 'size') {
    if (!value || typeof value !== 'object') return null
    const source = value as Record<string, unknown>
    const width = finiteNumber(source.width, Number.NaN)
    const height = finiteNumber(source.height, Number.NaN)
    return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null
  }
  const number = finiteNumber(value, Number.NaN)
  return Number.isFinite(number) ? number : null
}

function normalizePropertyKeyframes(
  property: ClipMaskKeyframeProperty,
  value: unknown,
  duration = Number.POSITIVE_INFINITY
): ClipMaskKeyframe[] {
  if (!Array.isArray(value)) return []
  const maximumTime = Number.isFinite(duration) ? Math.max(0, duration) : Number.POSITIVE_INFINITY
  const normalized = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const source = item as Record<string, unknown>
      const time = finiteNumber(source.time, Number.NaN)
      const keyframeValue = normalizeKeyframeValue(property, source.value)
      if (!Number.isFinite(time) || keyframeValue === null) return null
      return {
        time: roundTime(clamp(time, 0, maximumTime)),
        value: keyframeValue
      }
    })
    .filter((item): item is ClipMaskKeyframe => item !== null)
    .sort((left, right) => left.time - right.time)

  const deduplicated: ClipMaskKeyframe[] = []
  for (const keyframe of normalized) {
    const previous = deduplicated.at(-1)
    if (previous?.time === keyframe.time) previous.value = keyframe.value
    else deduplicated.push(keyframe)
  }
  return deduplicated
}

function normalizeMaskKeyframes(value: unknown, duration: number): ClipMaskKeyframes {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const keyframes: ClipMaskKeyframes = {}
  for (const property of CLIP_MASK_KEYFRAME_PROPERTIES) {
    const frames = normalizePropertyKeyframes(property, source[property], duration)
    if (frames.length > 0) keyframes[property] = frames
  }
  return keyframes
}

function normalizeMask(
  value: unknown,
  canvasSize: { width: number; height: number },
  index: number,
  duration: number
): ClipMask {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const type = isClipMaskType(source.type) ? source.type : 'rectangle'
  const fallback = createClipMask({ type, canvasSize, id: `mask-${index + 1}` })
  const rawPosition =
    source.position && typeof source.position === 'object'
      ? (source.position as Record<string, unknown>)
      : {}
  const maximumWidth = Math.max(canvasSize.width * 4, fallback.width)
  const maximumHeight = Math.max(canvasSize.height * 4, fallback.height)
  return {
    id: typeof source.id === 'string' && source.id ? source.id : fallback.id,
    type,
    enabled: source.enabled !== false,
    position: {
      x: clamp(
        finiteNumber(rawPosition.x, 0),
        -Math.max(1, canvasSize.width) * 2,
        Math.max(1, canvasSize.width) * 2
      ),
      y: clamp(
        finiteNumber(rawPosition.y, 0),
        -Math.max(1, canvasSize.height) * 2,
        Math.max(1, canvasSize.height) * 2
      )
    },
    width: clamp(finiteNumber(source.width, fallback.width), 1, maximumWidth),
    height: clamp(finiteNumber(source.height, fallback.height), 1, maximumHeight),
    rotation: clamp(finiteNumber(source.rotation, 0), -3600, 3600),
    feather: clamp(
      finiteNumber(source.feather, 0),
      0,
      Math.max(canvasSize.width, canvasSize.height)
    ),
    inverted: source.inverted === true,
    aspectLocked:
      typeof source.aspectLocked === 'boolean' ? source.aspectLocked : fallback.aspectLocked,
    keyframes: normalizeMaskKeyframes(source.keyframes, duration)
  }
}

export function normalizeClipMaskSettings(
  value: unknown,
  canvasSize: { width: number; height: number } = { width: 1920, height: 1080 },
  duration = Number.POSITIVE_INFINITY
): ClipMaskSettings {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawMasks = Array.isArray(source.masks) ? source.masks : []
  const masks = rawMasks
    .slice(0, 12)
    .map((mask, index) => normalizeMask(mask, canvasSize, index, duration))
  const requestedActiveId = typeof source.activeMaskId === 'string' ? source.activeMaskId : null
  const activeMaskId = masks.some((mask) => mask.id === requestedActiveId)
    ? requestedActiveId
    : (masks[0]?.id ?? null)
  return {
    enabled: source.enabled === true && masks.length > 0,
    activeMaskId,
    masks
  }
}

export function replaceClipMask(
  settings: ClipMaskSettings,
  maskId: string,
  updates: Partial<Omit<ClipMask, 'id'>>
): ClipMaskSettings {
  return {
    ...settings,
    masks: settings.masks.map((mask) =>
      mask.id === maskId
        ? {
            ...mask,
            ...updates,
            position: updates.position ? { ...updates.position } : mask.position
          }
        : mask
    )
  }
}

function setMaskPropertyValue(
  mask: ClipMask,
  property: ClipMaskKeyframeProperty,
  value: ClipMaskKeyframeValue
): ClipMask {
  if (property === 'position' && typeof value === 'object' && 'x' in value) {
    return { ...mask, position: { x: value.x, y: value.y } }
  }
  if (property === 'size' && typeof value === 'object' && 'width' in value) {
    return { ...mask, width: value.width, height: value.height }
  }
  if (property === 'rotation' && typeof value === 'number') return { ...mask, rotation: value }
  if (property === 'feather' && typeof value === 'number') return { ...mask, feather: value }
  return mask
}

function interpolateKeyframeValue(
  left: ClipMaskKeyframeValue,
  right: ClipMaskKeyframeValue,
  progress: number
): ClipMaskKeyframeValue {
  if (typeof left === 'number' && typeof right === 'number') {
    return left + (right - left) * progress
  }
  if (typeof left === 'object' && typeof right === 'object' && 'x' in left && 'x' in right) {
    return {
      x: left.x + (right.x - left.x) * progress,
      y: left.y + (right.y - left.y) * progress
    }
  }
  if (
    typeof left === 'object' &&
    typeof right === 'object' &&
    'width' in left &&
    'width' in right
  ) {
    return {
      width: left.width + (right.width - left.width) * progress,
      height: left.height + (right.height - left.height) * progress
    }
  }
  return right
}

export function getClipMaskLocalTime({
  startTime,
  duration,
  timelineTime
}: {
  startTime: number
  duration: number
  timelineTime: number
}): number {
  return roundTime(Math.max(0, Math.min(duration, timelineTime - startTime)))
}

export function resolveClipMaskProperty({
  mask,
  property,
  localTime
}: {
  mask: ClipMask
  property: ClipMaskKeyframeProperty
  localTime: number
}): ClipMaskKeyframeValue {
  const fallback = getMaskPropertyValue(mask, property)
  const frames = normalizePropertyKeyframes(property, mask.keyframes[property])
  if (frames.length === 0) return fallback
  if (frames.length === 1 || localTime <= frames[0].time) return frames[0].value
  const last = frames[frames.length - 1]
  if (localTime >= last.time) return last.value
  for (let index = 1; index < frames.length; index += 1) {
    const next = frames[index]
    if (localTime > next.time) continue
    const previous = frames[index - 1]
    const span = next.time - previous.time
    if (span <= 0) return next.value
    return interpolateKeyframeValue(previous.value, next.value, (localTime - previous.time) / span)
  }
  return last.value
}

export function resolveClipMaskAtTime(mask: ClipMask, localTime: number): ClipMask {
  return CLIP_MASK_KEYFRAME_PROPERTIES.reduce(
    (resolved, property) =>
      setMaskPropertyValue(
        resolved,
        property,
        resolveClipMaskProperty({ mask, property, localTime })
      ),
    mask
  )
}

export function findClipMaskKeyframeAtTime({
  mask,
  property,
  localTime
}: {
  mask: ClipMask
  property: ClipMaskKeyframeProperty
  localTime: number
}): number {
  return normalizePropertyKeyframes(property, mask.keyframes[property]).findIndex(
    (keyframe) => Math.abs(keyframe.time - localTime) <= KEYFRAME_TIME_EPSILON
  )
}

export function getNeighborClipMaskKeyframe({
  mask,
  property,
  localTime,
  direction
}: {
  mask: ClipMask
  property: ClipMaskKeyframeProperty
  localTime: number
  direction: 'previous' | 'next'
}): ClipMaskKeyframe | undefined {
  const frames = normalizePropertyKeyframes(property, mask.keyframes[property])
  if (direction === 'previous') {
    return [...frames]
      .reverse()
      .find((keyframe) => keyframe.time < localTime - KEYFRAME_TIME_EPSILON)
  }
  return frames.find((keyframe) => keyframe.time > localTime + KEYFRAME_TIME_EPSILON)
}

export function updateClipMaskProperty({
  mask,
  property,
  value,
  localTime,
  duration,
  forceKeyframe = false
}: {
  mask: ClipMask
  property: ClipMaskKeyframeProperty
  value: ClipMaskKeyframeValue
  localTime: number
  duration: number
  forceKeyframe?: boolean
}): ClipMask {
  const frames = normalizePropertyKeyframes(property, mask.keyframes[property], duration)
  if (!forceKeyframe && frames.length === 0) return setMaskPropertyValue(mask, property, value)
  const index = frames.findIndex(
    (keyframe) => Math.abs(keyframe.time - localTime) <= KEYFRAME_TIME_EPSILON
  )
  const next = { time: roundTime(localTime), value }
  if (index >= 0) frames[index] = next
  else frames.push(next)
  return {
    ...mask,
    keyframes: {
      ...mask.keyframes,
      [property]: normalizePropertyKeyframes(property, frames, duration)
    }
  }
}

export function toggleClipMaskKeyframe({
  mask,
  property,
  localTime,
  duration
}: {
  mask: ClipMask
  property: ClipMaskKeyframeProperty
  localTime: number
  duration: number
}): ClipMask {
  const value = resolveClipMaskProperty({ mask, property, localTime })
  const frames = normalizePropertyKeyframes(property, mask.keyframes[property], duration)
  const index = frames.findIndex(
    (keyframe) => Math.abs(keyframe.time - localTime) <= KEYFRAME_TIME_EPSILON
  )
  if (index < 0) {
    return updateClipMaskProperty({
      mask,
      property,
      value,
      localTime,
      duration,
      forceKeyframe: true
    })
  }

  frames.splice(index, 1)
  const keyframes = { ...mask.keyframes }
  if (frames.length > 0) keyframes[property] = frames
  else delete keyframes[property]
  return {
    ...setMaskPropertyValue(mask, property, value),
    keyframes
  }
}

export function getClipMaskKeyframeTimes(value: unknown): number[] {
  const settings = normalizeClipMaskSettings(value)
  const times = settings.masks.flatMap((mask) =>
    CLIP_MASK_KEYFRAME_PROPERTIES.flatMap((property) =>
      (mask.keyframes[property] ?? []).map((keyframe) => keyframe.time)
    )
  )
  return Array.from(new Set(times)).sort((left, right) => left - right)
}
