import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny'
import {
  calculateSceneChangeScore,
  extractSceneFeature,
  scoreSceneChanges,
  type SceneBoundary,
  type SceneChange,
  type SceneFrameFeature
} from './scene-detection'

export interface SceneAnalysis {
  sourceStart: number
  sourceEnd: number
  sampleFps: number
  changes: SceneChange[]
}

const ANALYSIS_SIZE = 96
const MAX_COARSE_SAMPLES = 12_000
const MAX_SAMPLE_FPS = 8

const abortError = (): DOMException => new DOMException('镜头检测已取消', 'AbortError')

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

const yieldToRenderer = (): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, 0))

function createSampleTimes(
  sourceStart: number,
  sourceEnd: number
): {
  times: number[]
  sampleFps: number
} {
  const duration = Math.max(0, sourceEnd - sourceStart)
  const requestedFps = Math.min(MAX_SAMPLE_FPS, Math.max(1, MAX_COARSE_SAMPLES / duration))
  const count = Math.max(2, Math.min(MAX_COARSE_SAMPLES, Math.ceil(duration * requestedFps) + 1))
  const lastTime = Math.max(sourceStart, sourceEnd - 1e-6)
  const times = Array.from({ length: count }, (_, index) =>
    index === count - 1 ? lastTime : sourceStart + (duration * index) / Math.max(1, count - 1)
  )
  return { times, sampleFps: (count - 1) / Math.max(duration, 1e-6) }
}

async function createSink(file: File): Promise<VideoSampleSink> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error('该素材没有可分析的视频轨道')
  if (!(await track.canDecode())) throw new Error('当前系统无法解码该视频格式')
  return new VideoSampleSink(track)
}

function createFrameReader() {
  const canvas = new OffscreenCanvas(ANALYSIS_SIZE, ANALYSIS_SIZE)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建镜头检测画布')
  return {
    read(
      sample: {
        draw: (
          context: OffscreenCanvasRenderingContext2D,
          x: number,
          y: number,
          width: number,
          height: number
        ) => void
      },
      time: number
    ): SceneFrameFeature {
      context.clearRect(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE)
      sample.draw(context, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE)
      const pixels = context.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE).data
      return extractSceneFeature({
        pixels,
        width: ANALYSIS_SIZE,
        height: ANALYSIS_SIZE,
        time
      })
    }
  }
}

export async function analyzeScenes({
  file,
  sourceStart,
  sourceEnd,
  signal,
  onProgress
}: {
  file: File
  sourceStart: number
  sourceEnd: number
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}): Promise<SceneAnalysis> {
  if (sourceEnd - sourceStart < 0.2) throw new Error('视频片段太短，无法进行镜头检测')
  checkAborted(signal)
  const sink = await createSink(file)
  const reader = createFrameReader()
  const { times, sampleFps } = createSampleTimes(sourceStart, sourceEnd)
  const features: SceneFrameFeature[] = []
  let index = 0

  for await (const sample of sink.samplesAtTimestamps(times)) {
    checkAborted(signal)
    const requestedTime = times[index] ?? sourceEnd
    index += 1
    if (sample) {
      try {
        features.push(reader.read(sample, requestedTime))
      } finally {
        sample.close()
      }
    }
    onProgress?.(Math.min(1, index / times.length))
    if (index % 24 === 0) await yieldToRenderer()
  }

  checkAborted(signal)
  if (features.length < 2) throw new Error('没有读取到足够的视频画面')
  return {
    sourceStart,
    sourceEnd,
    sampleFps,
    changes: scoreSceneChanges(features, 7)
  }
}

function uniqueSortedTimes(times: number[]): number[] {
  return [...new Map(times.map((time) => [time.toFixed(6), time])).values()].sort(
    (left, right) => left - right
  )
}

export async function refineSceneBoundaries({
  file,
  boundaries,
  sourceStart,
  sourceEnd,
  sampleFps,
  mediaFps,
  minimumSceneDuration,
  signal,
  onProgress
}: {
  file: File
  boundaries: SceneBoundary[]
  sourceStart: number
  sourceEnd: number
  sampleFps: number
  mediaFps: number
  minimumSceneDuration: number
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}): Promise<SceneBoundary[]> {
  if (!boundaries.length) return []
  checkAborted(signal)
  const sink = await createSink(file)
  const reader = createFrameReader()
  const refineFps = Math.min(60, Math.max(12, Number(mediaFps) || 30))
  const halfWindow = Math.max(0.18, 1 / Math.max(1, sampleFps))
  const windows = boundaries.map((boundary) => {
    const start = Math.max(sourceStart, boundary.time - halfWindow)
    const end = Math.min(sourceEnd - 1e-6, boundary.time + halfWindow)
    const count = Math.max(2, Math.ceil((end - start) * refineFps) + 1)
    return Array.from(
      { length: count },
      (_, index) => start + ((end - start) * index) / Math.max(1, count - 1)
    )
  })
  const times = uniqueSortedTimes(windows.flat())
  const features = new Map<string, SceneFrameFeature>()
  let index = 0

  for await (const sample of sink.samplesAtTimestamps(times)) {
    checkAborted(signal)
    const requestedTime = times[index] ?? sourceEnd
    index += 1
    if (sample) {
      try {
        features.set(requestedTime.toFixed(6), reader.read(sample, requestedTime))
      } finally {
        sample.close()
      }
    }
    onProgress?.(Math.min(1, index / times.length))
    if (index % 24 === 0) await yieldToRenderer()
  }

  const refined = boundaries.map((boundary, boundaryIndex) => {
    const windowFeatures = windows[boundaryIndex]
      .map((time) => features.get(time.toFixed(6)))
      .filter((feature): feature is SceneFrameFeature => Boolean(feature))
    let best: SceneBoundary | null = null
    for (let featureIndex = 1; featureIndex < windowFeatures.length; featureIndex += 1) {
      const rawScore = calculateSceneChangeScore(
        windowFeatures[featureIndex - 1],
        windowFeatures[featureIndex]
      )
      if (!best || rawScore > best.rawScore) {
        best = { ...boundary, time: windowFeatures[featureIndex].time, rawScore }
      }
    }
    return best ?? boundary
  })

  const selected: SceneBoundary[] = []
  for (const candidate of [...refined].sort((left, right) => right.confidence - left.confidence)) {
    if (candidate.time - sourceStart < minimumSceneDuration) continue
    if (sourceEnd - candidate.time < minimumSceneDuration) continue
    if (selected.some((item) => Math.abs(item.time - candidate.time) < minimumSceneDuration))
      continue
    selected.push(candidate)
  }
  return selected.sort((left, right) => left.time - right.time)
}
