export interface SceneFrameFeature {
  time: number
  histogram: Float32Array
  grid: Float32Array
  edgeEnergy: number
}

export interface SceneChange {
  time: number
  rawScore: number
  baseline: number
  confidence: number
}

export interface SceneBoundary extends SceneChange {}

const LUMA_BINS = 24
const COLOR_BINS = 64
const GRID_SIZE = 4
const GRID_CHANNELS = GRID_SIZE * GRID_SIZE * 3

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.min(maximum, Math.max(minimum, value))

const smoothstep = (minimum: number, maximum: number, value: number): number => {
  const progress = clamp((value - minimum) / Math.max(1e-9, maximum - minimum))
  return progress * progress * (3 - 2 * progress)
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function extractSceneFeature({
  pixels,
  width,
  height,
  time
}: {
  pixels: Uint8ClampedArray
  width: number
  height: number
  time: number
}): SceneFrameFeature {
  const histogram = new Float32Array(LUMA_BINS + COLOR_BINS)
  const grid = new Float32Array(GRID_CHANNELS)
  const gridCounts = new Uint32Array(GRID_SIZE * GRID_SIZE)
  const previousRow = new Float32Array(width)
  let edgeEnergy = 0
  let edgeSamples = 0

  for (let y = 0; y < height; y += 1) {
    let previousLuma = 0
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722
      const lumaBin = Math.min(LUMA_BINS - 1, Math.floor((luma / 256) * LUMA_BINS))
      const colorBin = (red >> 6) * 16 + (green >> 6) * 4 + (blue >> 6)
      histogram[lumaBin] += 1
      histogram[LUMA_BINS + colorBin] += 1

      const gridX = Math.min(GRID_SIZE - 1, Math.floor((x / width) * GRID_SIZE))
      const gridY = Math.min(GRID_SIZE - 1, Math.floor((y / height) * GRID_SIZE))
      const gridCell = gridY * GRID_SIZE + gridX
      const gridOffset = gridCell * 3
      grid[gridOffset] += red
      grid[gridOffset + 1] += green
      grid[gridOffset + 2] += blue
      gridCounts[gridCell] += 1

      if (x > 0) {
        edgeEnergy += Math.abs(luma - previousLuma)
        edgeSamples += 1
      }
      if (y > 0) {
        edgeEnergy += Math.abs(luma - previousRow[x])
        edgeSamples += 1
      }
      previousLuma = luma
      previousRow[x] = luma
    }
  }

  const pixelCount = Math.max(1, width * height)
  for (let index = 0; index < histogram.length; index += 1) histogram[index] /= pixelCount
  for (let cell = 0; cell < gridCounts.length; cell += 1) {
    const divisor = Math.max(1, gridCounts[cell]) * 255
    const gridOffset = cell * 3
    grid[gridOffset] /= divisor
    grid[gridOffset + 1] /= divisor
    grid[gridOffset + 2] /= divisor
  }

  return {
    time,
    histogram,
    grid,
    edgeEnergy: edgeSamples ? edgeEnergy / edgeSamples / 255 : 0
  }
}

export function calculateSceneChangeScore(
  previous: SceneFrameFeature,
  current: SceneFrameFeature
): number {
  let lumaDifference = 0
  for (let index = 0; index < LUMA_BINS; index += 1)
    lumaDifference += Math.abs(previous.histogram[index] - current.histogram[index])

  let colorDifference = 0
  for (let index = LUMA_BINS; index < LUMA_BINS + COLOR_BINS; index += 1)
    colorDifference += Math.abs(previous.histogram[index] - current.histogram[index])

  let gridDifference = 0
  for (let index = 0; index < GRID_CHANNELS; index += 1)
    gridDifference += Math.abs(previous.grid[index] - current.grid[index])

  const edgeDifference = Math.abs(previous.edgeEnergy - current.edgeEnergy)
  return clamp(
    lumaDifference * 0.125 +
      colorDifference * 0.175 +
      (gridDifference / GRID_CHANNELS) * 0.35 +
      edgeDifference * 0.05
  )
}

export function scoreSceneChanges(
  features: SceneFrameFeature[],
  slidingWindowSize = 7
): SceneChange[] {
  if (features.length < 2) return []
  const rawScores = features
    .slice(1)
    .map((feature, index) => calculateSceneChangeScore(features[index], feature))
  const radius = Math.max(2, Math.floor(slidingWindowSize / 2))

  return rawScores.map((rawScore, index) => {
    const neighbors: number[] = []
    for (
      let neighbor = Math.max(0, index - radius);
      neighbor <= Math.min(rawScores.length - 1, index + radius);
      neighbor += 1
    ) {
      if (neighbor !== index) neighbors.push(rawScores[neighbor])
    }
    const baseline = median(neighbors)
    const deviation = median(neighbors.map((value) => Math.abs(value - baseline)))
    const relativeStrength = (rawScore - baseline) / Math.max(0.018, deviation * 3 + 0.012)
    const absoluteConfidence = smoothstep(0.055, 0.42, rawScore)
    const relativeConfidence = smoothstep(1.1, 4.5, relativeStrength)
    return {
      time: features[index + 1].time,
      rawScore,
      baseline,
      confidence: clamp(absoluteConfidence * 0.55 + relativeConfidence * 0.45)
    }
  })
}

export function selectSceneBoundaries({
  changes,
  sourceStart,
  sourceEnd,
  sensitivity,
  minimumSceneDuration,
  maximumCuts = 500
}: {
  changes: SceneChange[]
  sourceStart: number
  sourceEnd: number
  sensitivity: number
  minimumSceneDuration: number
  maximumCuts?: number
}): SceneBoundary[] {
  const normalizedSensitivity = clamp(sensitivity / 100)
  const confidenceThreshold = 0.78 - normalizedSensitivity * 0.5
  const rawThreshold = 0.16 - normalizedSensitivity * 0.105
  const candidates = changes.filter((change, index) => {
    const previous = changes[index - 1]?.confidence ?? -1
    const next = changes[index + 1]?.confidence ?? -1
    const localMaximum =
      change.confidence >= previous &&
      change.confidence >= next &&
      (change.confidence > previous || change.confidence > next)
    return (
      localMaximum &&
      change.confidence >= confidenceThreshold &&
      change.rawScore >= rawThreshold &&
      change.time - sourceStart >= minimumSceneDuration &&
      sourceEnd - change.time >= minimumSceneDuration
    )
  })

  const selected: SceneBoundary[] = []
  for (const candidate of [...candidates].sort(
    (left, right) => right.confidence - left.confidence
  )) {
    if (selected.some((item) => Math.abs(item.time - candidate.time) < minimumSceneDuration))
      continue
    selected.push(candidate)
    if (selected.length >= maximumCuts) break
  }
  return selected.sort((left, right) => left.time - right.time)
}
