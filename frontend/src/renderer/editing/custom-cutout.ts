import type { EditingCustomCutoutPoint } from '../../shared/editing'

export interface CustomCutoutStroke {
  positive: boolean
  points: Array<{ x: number; y: number }>
}

export interface CustomCutoutKeyframe {
  sourceFrame: number
  sourceTime: number
  width: number
  height: number
  strokes: CustomCutoutStroke[]
  maskRef: string
}

export interface CustomCutoutSettings {
  version: 1
  enabled: boolean
  revision: number
  keyframes: CustomCutoutKeyframe[]
  feather: number
  expand: number
  invert: boolean
}

export const DEFAULT_CUSTOM_CUTOUT: CustomCutoutSettings = {
  version: 1,
  enabled: false,
  revision: 0,
  keyframes: [],
  feather: 0,
  expand: 0,
  invert: false
}

const finite = (value: unknown, fallback = 0): number =>
  Number.isFinite(Number(value)) ? Number(value) : fallback

export function normalizeCustomCutout(value: unknown): CustomCutoutSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CUSTOM_CUTOUT }
  const input = value as Partial<CustomCutoutSettings>
  const keyframes = Array.isArray(input.keyframes)
    ? input.keyframes
        .filter((item): item is CustomCutoutKeyframe => {
          return Boolean(
            item &&
            Number.isSafeInteger(item.sourceFrame) &&
            item.sourceFrame >= 0 &&
            Number.isFinite(item.sourceTime) &&
            Number.isInteger(item.width) &&
            item.width > 0 &&
            Number.isInteger(item.height) &&
            item.height > 0 &&
            typeof item.maskRef === 'string'
          )
        })
        .map((item) => ({
          ...item,
          strokes: Array.isArray(item.strokes) ? item.strokes : []
        }))
        .sort((a, b) => a.sourceTime - b.sourceTime)
    : []
  return {
    version: 1,
    enabled: input.enabled === true && keyframes.length > 0,
    revision: Math.max(0, Math.floor(finite(input.revision))),
    keyframes,
    feather: Math.max(0, Math.min(100, finite(input.feather))),
    expand: Math.max(-100, Math.min(100, finite(input.expand))),
    invert: input.invert === true
  }
}

export function findCustomCutoutKeyframe(
  keyframes: CustomCutoutKeyframe[],
  sourceTime: number
): CustomCutoutKeyframe | undefined {
  if (!keyframes.length) return undefined
  let low = 0
  let high = keyframes.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const keyframe = keyframes[middle]
    if (keyframe.sourceTime === sourceTime) return keyframe
    if (keyframe.sourceTime < sourceTime) low = middle + 1
    else high = middle - 1
  }
  if (low <= 0) return keyframes[0]
  if (low >= keyframes.length) return keyframes.at(-1)
  const before = keyframes[low - 1]
  const after = keyframes[low]
  return sourceTime - before.sourceTime <= after.sourceTime - sourceTime ? before : after
}

export function strokesToModelPoints(
  strokes: CustomCutoutStroke[],
  width: number,
  height: number,
  limit = 96
): EditingCustomCutoutPoint[] {
  if (width < 1 || height < 1 || limit < 1) return []

  type Candidate = EditingCustomCutoutPoint & {
    order: number
    strokeIndex: number
    endpoint: boolean
  }

  const candidates: Candidate[] = []
  let order = 0
  const minDistance = Math.max(3, Math.min(width, height) * 0.004)
  for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex += 1) {
    const stroke = strokes[strokeIndex]
    let previous: Candidate | undefined
    for (let pointIndex = 0; pointIndex < stroke.points.length; pointIndex += 1) {
      const point = stroke.points[pointIndex]
      const candidate: Candidate = {
        x: Math.max(0, Math.min(width - 1, point.x * width)),
        y: Math.max(0, Math.min(height - 1, point.y * height)),
        positive: stroke.positive,
        order: order++,
        strokeIndex,
        endpoint: pointIndex === 0 || pointIndex === stroke.points.length - 1
      }
      const tooClose =
        previous && Math.hypot(candidate.x - previous.x, candidate.y - previous.y) < minDistance
      if (!tooClose || candidate.endpoint) {
        candidates.push(candidate)
        previous = candidate
      }
    }
  }
  if (candidates.length <= limit)
    return candidates.map(({ x, y, positive }) => ({ x, y, positive }))

  const positive = candidates.filter((point) => point.positive)
  const negative = candidates.filter((point) => !point.positive)
  let positiveBudget = positive.length ? limit : 0
  let negativeBudget = negative.length ? limit : 0
  if (positive.length && negative.length) {
    positiveBudget = Math.min(positive.length, Math.ceil(limit / 2))
    negativeBudget = Math.min(negative.length, Math.floor(limit / 2))
    let remaining = limit - positiveBudget - negativeBudget
    if (remaining > 0) {
      const positiveRoom = positive.length - positiveBudget
      const positiveExtra = Math.min(positiveRoom, remaining)
      positiveBudget += positiveExtra
      remaining -= positiveExtra
      negativeBudget += Math.min(negative.length - negativeBudget, remaining)
    }
  }

  const select = (pool: Candidate[], budget: number): Candidate[] => {
    if (pool.length <= budget) return pool
    const selected = new Set<number>()
    const recentStrokes = [...new Set(pool.map((point) => point.strokeIndex))].sort((a, b) => b - a)

    // Keep the latest correction from every recent stroke before filling broader coverage.
    for (const strokeIndex of recentStrokes) {
      if (selected.size >= budget) break
      const last = pool.findLast((point) => point.strokeIndex === strokeIndex)
      if (last) selected.add(last.order)
    }
    for (const strokeIndex of recentStrokes) {
      if (selected.size >= budget) break
      const first = pool.find((point) => point.strokeIndex === strokeIndex)
      if (first) selected.add(first.order)
    }

    const remaining = budget - selected.size
    if (remaining > 0) {
      const available = pool.filter((point) => !selected.has(point.order))
      for (let index = 0; index < remaining; index += 1) {
        const sampleIndex = Math.min(
          available.length - 1,
          Math.floor(((index + 0.5) * available.length) / remaining)
        )
        selected.add(available[sampleIndex].order)
      }
    }
    return pool.filter((point) => selected.has(point.order))
  }

  return [...select(positive, positiveBudget), ...select(negative, negativeBudget)]
    .sort((a, b) => a.order - b.order)
    .map(({ x, y, positive: isPositive }) => ({ x, y, positive: isPositive }))
}

function horizontalExtrema(
  input: Uint8Array,
  width: number,
  height: number,
  radius: number,
  dilate: boolean
): Uint8Array {
  const output = new Uint8Array(input.length)
  const deque = new Int32Array(width)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    let head = 0
    let tail = 0
    let added = -1
    for (let x = 0; x < width; x += 1) {
      const right = Math.min(width - 1, x + radius)
      while (added < right) {
        added += 1
        const value = input[row + added]
        while (
          tail > head &&
          (dilate ? input[row + deque[tail - 1]] <= value : input[row + deque[tail - 1]] >= value)
        )
          tail -= 1
        deque[tail++] = added
      }
      const left = x - radius
      while (tail > head && deque[head] < Math.max(0, left)) head += 1
      output[row + x] = !dilate && (left < 0 || x + radius >= width) ? 0 : input[row + deque[head]]
    }
  }
  return output
}

function verticalExtrema(
  input: Uint8Array,
  width: number,
  height: number,
  radius: number,
  dilate: boolean
): Uint8Array {
  const output = new Uint8Array(input.length)
  const deque = new Int32Array(height)
  for (let x = 0; x < width; x += 1) {
    let head = 0
    let tail = 0
    let added = -1
    for (let y = 0; y < height; y += 1) {
      const bottom = Math.min(height - 1, y + radius)
      while (added < bottom) {
        added += 1
        const value = input[added * width + x]
        while (
          tail > head &&
          (dilate
            ? input[deque[tail - 1] * width + x] <= value
            : input[deque[tail - 1] * width + x] >= value)
        )
          tail -= 1
        deque[tail++] = added
      }
      const top = y - radius
      while (tail > head && deque[head] < Math.max(0, top)) head += 1
      output[y * width + x] =
        !dilate && (top < 0 || y + radius >= height) ? 0 : input[deque[head] * width + x]
    }
  }
  return output
}

export function expandCustomCutoutMask(
  bytes: Uint8Array,
  width: number,
  height: number,
  amount: number
): Uint8Array {
  if (bytes.byteLength !== width * height) throw new Error('自定义抠像蒙版尺寸不匹配')
  const radius = Math.min(100, Math.max(0, Math.round(Math.abs(amount))))
  if (!radius) return new Uint8Array(bytes)
  const dilate = amount > 0
  return verticalExtrema(
    horizontalExtrema(bytes, width, height, radius, dilate),
    width,
    height,
    radius,
    dilate
  )
}
