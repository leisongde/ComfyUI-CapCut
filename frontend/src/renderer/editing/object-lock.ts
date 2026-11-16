import type { Transform } from '@/types/timeline'

export type ObjectLockMode = 'position' | 'position-scale'
export type ObjectLockAnchor = 'current' | 'center'

export interface ObjectLockSample {
  time: number
  centerX: number
  centerY: number
  width: number
  height: number
  confidence: number
}

export interface ObjectLockSettings {
  // V3 stores source coordinates and times relative to the tracked video clip.
  version: 1 | 2 | 3
  subjectCenter?: boolean
  enabled: boolean
  mode: ObjectLockMode
  anchor: ObjectLockAnchor
  smoothing: number
  maxScale: number
  sourceSize: { width: number; height: number }
  fitCanvasSize: { width: number; height: number }
  seed: ObjectLockSample
  samples: ObjectLockSample[]
  lostFrames: number
  sourceElementId?: string
  sourceElementName?: string
  sourceTrackId?: string
}

export interface ObjectLockMaskAnalysis {
  centerX: number
  centerY: number
  width: number
  height: number
  confidence: number
}

const finite = (value: unknown, fallback = 0): number =>
  Number.isFinite(Number(value)) ? Number(value) : fallback

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

function normalizeSample(value: unknown): ObjectLockSample | null {
  if (!value || typeof value !== 'object') return null
  const sample = value as Partial<ObjectLockSample>
  const time = finite(sample.time, -1)
  const width = finite(sample.width)
  const height = finite(sample.height)
  if (time < 0 || width <= 0 || height <= 0) return null
  return {
    time,
    centerX: clamp(finite(sample.centerX, 0.5), -4, 5),
    centerY: clamp(finite(sample.centerY, 0.5), -4, 5),
    width: clamp(width, 1e-5, 8),
    height: clamp(height, 1e-5, 8),
    confidence: clamp(finite(sample.confidence, 1), 0, 1)
  }
}

export function normalizeObjectLock(value: unknown): ObjectLockSettings | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<ObjectLockSettings>
  const samples = Array.isArray(input.samples)
    ? input.samples
        .map(normalizeSample)
        .filter((sample): sample is ObjectLockSample => Boolean(sample))
        .sort((left, right) => left.time - right.time)
    : []
  const seed = normalizeSample(input.seed) ?? samples[0]
  const sourceWidth = Math.round(finite(input.sourceSize?.width))
  const sourceHeight = Math.round(finite(input.sourceSize?.height))
  const fitWidth = Math.round(finite(input.fitCanvasSize?.width))
  const fitHeight = Math.round(finite(input.fitCanvasSize?.height))
  if (
    !seed ||
    !samples.length ||
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    fitWidth < 1 ||
    fitHeight < 1
  )
    return null
  const version = input.version === 3 ? 3 : input.version === 2 ? 2 : 1
  const sourceElementId =
    typeof input.sourceElementId === 'string' && input.sourceElementId.trim()
      ? input.sourceElementId
      : undefined
  if (version >= 2 && !sourceElementId) return null
  return {
    version,
    ...(version === 3 ? { subjectCenter: input.subjectCenter === true } : {}),
    enabled: input.enabled !== false,
    mode: input.mode === 'position-scale' ? 'position-scale' : 'position',
    anchor: input.anchor === 'center' ? 'center' : 'current',
    smoothing: clamp(finite(input.smoothing, 55), 0, 100),
    maxScale: clamp(finite(input.maxScale, 1.35), 1, 2),
    sourceSize: { width: sourceWidth, height: sourceHeight },
    fitCanvasSize: { width: fitWidth, height: fitHeight },
    seed,
    samples,
    lostFrames: Math.max(0, Math.round(finite(input.lostFrames))),
    sourceElementId,
    sourceElementName:
      typeof input.sourceElementName === 'string' ? input.sourceElementName : undefined,
    sourceTrackId: typeof input.sourceTrackId === 'string' ? input.sourceTrackId : undefined
  }
}

export function mapObjectLockSampleToCanvas({
  sample,
  sourceSize,
  fitCanvasSize,
  transform
}: {
  sample: ObjectLockSample
  sourceSize: { width: number; height: number }
  fitCanvasSize: { width: number; height: number }
  transform: Transform
}): ObjectLockSample {
  const containScale = Math.min(
    fitCanvasSize.width / sourceSize.width,
    fitCanvasSize.height / sourceSize.height
  )
  const scale = containScale * transform.scale
  let offsetX = (sample.centerX - 0.5) * sourceSize.width * scale
  let offsetY = (sample.centerY - 0.5) * sourceSize.height * scale
  if (transform.flipX) offsetX *= -1
  if (transform.flipY) offsetY *= -1
  const radians = (transform.rotate * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const rotatedX = offsetX * cosine - offsetY * sine
  const rotatedY = offsetX * sine + offsetY * cosine
  const rawWidth = sample.width * sourceSize.width * Math.abs(scale)
  const rawHeight = sample.height * sourceSize.height * Math.abs(scale)
  const canvasWidth = Math.abs(cosine) * rawWidth + Math.abs(sine) * rawHeight
  const canvasHeight = Math.abs(sine) * rawWidth + Math.abs(cosine) * rawHeight
  return {
    ...sample,
    centerX: 0.5 + (transform.position.x + rotatedX) / fitCanvasSize.width,
    centerY: 0.5 + (transform.position.y + rotatedY) / fitCanvasSize.height,
    width: Math.max(1e-5, canvasWidth / fitCanvasSize.width),
    height: Math.max(1e-5, canvasHeight / fitCanvasSize.height)
  }
}

export function analyzeObjectLockMask(
  bytes: Uint8Array,
  width: number,
  height: number
): ObjectLockMaskAnalysis | null {
  if (width < 1 || height < 1 || bytes.byteLength !== width * height) return null
  let weight = 0
  let weightedX = 0
  let weightedY = 0
  let minimumX = width
  let minimumY = height
  let maximumX = -1
  let maximumY = -1
  let solidPixels = 0
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      const alpha = bytes[row + x]
      if (alpha < 24) continue
      const normalized = alpha / 255
      weight += normalized
      weightedX += (x + 0.5) * normalized
      weightedY += (y + 0.5) * normalized
      if (alpha >= 96) {
        solidPixels += 1
        minimumX = Math.min(minimumX, x)
        minimumY = Math.min(minimumY, y)
        maximumX = Math.max(maximumX, x)
        maximumY = Math.max(maximumY, y)
      }
    }
  }
  if (solidPixels < Math.max(12, width * height * 0.00015) || weight <= 0 || maximumX < minimumX)
    return null
  const boxWidth = maximumX - minimumX + 1
  const boxHeight = maximumY - minimumY + 1
  const fillRatio = solidPixels / Math.max(1, boxWidth * boxHeight)
  return {
    centerX: clamp(weightedX / weight / width, 0, 1),
    centerY: clamp(weightedY / weight / height, 0, 1),
    width: clamp(boxWidth / width, 1 / width, 1),
    height: clamp(boxHeight / height, 1 / height, 1),
    confidence: clamp(fillRatio * 1.4, 0.15, 1)
  }
}

export function createObjectLockSeedMask(
  width: number,
  height: number,
  box: { x: number; y: number; width: number; height: number }
): Uint8Array {
  const mask = new Uint8Array(width * height)
  const left = clamp(Math.floor(box.x * width), 0, width - 1)
  const top = clamp(Math.floor(box.y * height), 0, height - 1)
  const right = clamp(Math.ceil((box.x + box.width) * width - 1e-7), left + 1, width)
  const bottom = clamp(Math.ceil((box.y + box.height) * height - 1e-7), top + 1, height)
  for (let y = top; y < bottom; y += 1) mask.fill(255, y * width + left, y * width + right)
  return mask
}

function interpolateSample(
  left: ObjectLockSample,
  right: ObjectLockSample,
  time: number
): ObjectLockSample {
  if (right.time <= left.time) return { ...left, time }
  const progress = clamp((time - left.time) / (right.time - left.time), 0, 1)
  const mix = (a: number, b: number) => a + (b - a) * progress
  return {
    time,
    centerX: mix(left.centerX, right.centerX),
    centerY: mix(left.centerY, right.centerY),
    width: mix(left.width, right.width),
    height: mix(left.height, right.height),
    confidence: mix(left.confidence, right.confidence)
  }
}

export function getObjectLockSampleAtTime(
  samples: ObjectLockSample[],
  time: number,
  smoothing = 0
): ObjectLockSample | null {
  if (!samples.length) return null
  let low = 0
  let high = samples.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (samples[middle].time < time) low = middle + 1
    else high = middle - 1
  }
  const rightIndex = clamp(low, 0, samples.length - 1)
  const leftIndex = clamp(
    rightIndex - (samples[rightIndex].time > time ? 1 : 0),
    0,
    samples.length - 1
  )
  const current = interpolateSample(samples[leftIndex], samples[rightIndex], time)
  const radius = Math.round(clamp(smoothing, 0, 100) / 16)
  if (!radius || samples.length < 3) return current

  const centerIndex =
    Math.abs(samples[leftIndex].time - time) <= Math.abs(samples[rightIndex].time - time)
      ? leftIndex
      : rightIndex
  const start = Math.max(0, centerIndex - radius)
  const end = Math.min(samples.length - 1, centerIndex + radius)
  let totalWeight = 2
  const mixed = { ...current }
  mixed.centerX *= 2
  mixed.centerY *= 2
  mixed.width *= 2
  mixed.height *= 2
  mixed.confidence *= 2
  for (let index = start; index <= end; index += 1) {
    const distance = Math.abs(index - centerIndex)
    const sampleWeight = radius + 1 - distance
    const sample = samples[index]
    totalWeight += sampleWeight
    mixed.centerX += sample.centerX * sampleWeight
    mixed.centerY += sample.centerY * sampleWeight
    mixed.width += sample.width * sampleWeight
    mixed.height += sample.height * sampleWeight
    mixed.confidence += sample.confidence * sampleWeight
  }
  mixed.centerX /= totalWeight
  mixed.centerY /= totalWeight
  mixed.width /= totalWeight
  mixed.height /= totalWeight
  mixed.confidence /= totalWeight
  return mixed
}

export function resolveObjectLockTransform({
  value,
  localTime,
  timelineTime,
  transform
}: {
  value: unknown
  localTime: number
  timelineTime?: number
  transform: Transform
}): Transform {
  const settings = normalizeObjectLock(value)
  if (!settings?.enabled) return transform
  const sampleTime = settings.version === 2 ? (timelineTime ?? localTime) : localTime
  const sample = getObjectLockSampleAtTime(settings.samples, sampleTime, settings.smoothing)
  if (!sample) return transform
  if (settings.version === 3) {
    if (!settings.subjectCenter) return transform
    const target = mapObjectLockSampleToCanvas({
      sample,
      sourceSize: settings.sourceSize,
      fitCanvasSize: settings.fitCanvasSize,
      transform
    })
    return {
      ...transform,
      position: {
        x: transform.position.x - (target.centerX - 0.5) * settings.fitCanvasSize.width,
        y: transform.position.y - (target.centerY - 0.5) * settings.fitCanvasSize.height
      }
    }
  }
  if (settings.version === 2) {
    const reference =
      getObjectLockSampleAtTime(settings.samples, settings.seed.time, settings.smoothing) ??
      settings.seed
    const rawScale = Math.sqrt(
      Math.max(1e-8, sample.width * sample.height) /
        Math.max(1e-8, reference.width * reference.height)
    )
    const scaleRatio =
      settings.mode === 'position-scale'
        ? clamp(rawScale, 1 / settings.maxScale, settings.maxScale)
        : 1
    const targetPosition = {
      x: (sample.centerX - 0.5) * settings.fitCanvasSize.width,
      y: (sample.centerY - 0.5) * settings.fitCanvasSize.height
    }
    const seedPosition = {
      x: (reference.centerX - 0.5) * settings.fitCanvasSize.width,
      y: (reference.centerY - 0.5) * settings.fitCanvasSize.height
    }
    return {
      ...transform,
      position:
        settings.anchor === 'center'
          ? targetPosition
          : {
              x: transform.position.x + targetPosition.x - seedPosition.x,
              y: transform.position.y + targetPosition.y - seedPosition.y
            },
      scale: Math.max(0.01, transform.scale * scaleRatio)
    }
  }
  const containScale = Math.min(
    settings.fitCanvasSize.width / settings.sourceSize.width,
    settings.fitCanvasSize.height / settings.sourceSize.height
  )
  const rawScale = Math.sqrt(
    (settings.seed.width * settings.seed.height) / Math.max(1e-8, sample.width * sample.height)
  )
  const scaleRatio =
    settings.mode === 'position-scale'
      ? clamp(rawScale, 1 / settings.maxScale, settings.maxScale)
      : 1
  const finalScale = Math.max(0.01, transform.scale * scaleRatio)
  const currentX = (sample.centerX - 0.5) * settings.sourceSize.width * containScale * finalScale
  const currentY = (sample.centerY - 0.5) * settings.sourceSize.height * containScale * finalScale
  const targetX =
    settings.anchor === 'center'
      ? 0
      : transform.position.x +
        (settings.seed.centerX - 0.5) * settings.sourceSize.width * containScale * transform.scale
  const targetY =
    settings.anchor === 'center'
      ? 0
      : transform.position.y +
        (settings.seed.centerY - 0.5) * settings.sourceSize.height * containScale * transform.scale
  return {
    ...transform,
    position: { x: targetX - currentX, y: targetY - currentY },
    scale: finalScale
  }
}

function withBoundarySample(samples: ObjectLockSample[], time: number): ObjectLockSample[] {
  if (samples.some((sample) => Math.abs(sample.time - time) < 1e-6)) return samples
  const boundary = getObjectLockSampleAtTime(samples, time, 0)
  return boundary ? [...samples, boundary].sort((left, right) => left.time - right.time) : samples
}

export function splitObjectLockAtTime({
  value,
  splitTime
}: {
  value: unknown
  splitTime: number
}): { leftObjectLock?: ObjectLockSettings; rightObjectLock?: ObjectLockSettings } {
  const settings = normalizeObjectLock(value)
  if (!settings) return {}
  if (settings.version === 2) {
    return {
      leftObjectLock: { ...settings, samples: settings.samples.map((sample) => ({ ...sample })) },
      rightObjectLock: { ...settings, samples: settings.samples.map((sample) => ({ ...sample })) }
    }
  }
  const samples = withBoundarySample(settings.samples, splitTime)
  const left = samples.filter((sample) => sample.time <= splitTime)
  const right = samples
    .filter((sample) => sample.time >= splitTime)
    .map((sample) => ({ ...sample, time: Math.max(0, sample.time - splitTime) }))
  return {
    leftObjectLock: left.length ? { ...settings, samples: left } : undefined,
    rightObjectLock: right.length
      ? {
          ...settings,
          seed:
            settings.version === 3
              ? {
                  ...(getObjectLockSampleAtTime(
                    settings.samples,
                    Math.max(splitTime, settings.seed.time),
                    0
                  ) ?? settings.seed),
                  time: Math.max(0, settings.seed.time - splitTime)
                }
              : settings.seed,
          samples: right
        }
      : undefined
  }
}
