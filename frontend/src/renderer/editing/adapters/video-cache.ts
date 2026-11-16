import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
  type InputVideoTrack,
  type WrappedCanvas
} from 'mediabunny'
import { createFrameTimestamps, ReverseFrameCache } from './reverse-frame-cache'

const PREVIEW_REVERSE_SEGMENT_SECONDS = 4
const PREVIEW_REVERSE_FRAME_RATE = 20
const ORIGINAL_REVERSE_MEMORY_BUDGET = 128 * 1024 * 1024
const MIN_REVERSE_SEGMENT_SECONDS = 0.16
const MAX_REVERSE_SEGMENT_SECONDS = 1

interface ForwardSinkData {
  key: string
  width: number
  height: number
  sink: CanvasSink
  iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null
  currentFrame: WrappedCanvas | null
  nextFrame: WrappedCanvas | null
  lastTime: number
  prefetching: boolean
  prefetchPromise: Promise<void> | null
}

interface VideoSinkData {
  input: Input
  videoTrack: InputVideoTrack
  file: File
  displayWidth: number
  displayHeight: number
  frameRate: number
  forwardSinks: Map<string, ForwardSinkData>
  reverseCaches: Map<string, ReverseFrameCache<WrappedCanvas>>
  activeReverseKey: string | null
}

type FrameRequest = {
  mediaId: string
  file: File
  time: number
  reversed?: boolean
  maxDimension?: number
  frameRate?: number
}

function releaseStandaloneCanvas(frame: WrappedCanvas): void {
  frame.canvas.width = 1
  frame.canvas.height = 1
}

export class VideoCache {
  private sinks = new Map<string, VideoSinkData>()
  private initPromises = new Map<string, Promise<void>>()
  private reversePreparation: Promise<boolean> | null = null

  async getFrameAt(request: FrameRequest): Promise<WrappedCanvas | null> {
    await this.ensureSink(request)
    const sinkData = this.sinks.get(request.mediaId)
    if (!sinkData) return null

    if (request.reversed) {
      return this.getReverseFrame({
        sinkData,
        time: request.time,
        maxDimension: request.maxDimension,
        frameRate: request.frameRate
      })
    }

    const forwardSink = this.getForwardSink({
      sinkData,
      maxDimension: request.maxDimension
    })
    return this.getForwardFrame(forwardSink, request.time)
  }

  async prepareReversePlayback({
    onPreparing
  }: {
    onPreparing?: () => void
  } = {}): Promise<boolean> {
    if (this.reversePreparation) return this.reversePreparation

    this.reversePreparation = (async () => {
      let cacheObserved = false
      let preparingNotified = false
      for (let attempt = 0; attempt < 120; attempt++) {
        await this.nextAnimationFrame()
        await Promise.allSettled(this.initPromises.values())
        const caches = this.getPreviewCaches()
        if (caches.length === 0) continue
        if (!preparingNotified) {
          preparingNotified = true
          onPreparing?.()
        }
        if (caches.some((cache) => cache.getStats().loading)) {
          await Promise.all(caches.map((cache) => cache.waitForPending()))
          return true
        }
        if (cacheObserved) return true
        cacheObserved = true
      }
      return false
    })().finally(() => {
      this.reversePreparation = null
    })

    return this.reversePreparation
  }

  private async getForwardFrame(
    sinkData: ForwardSinkData,
    time: number
  ): Promise<WrappedCanvas | null> {
    if (sinkData.nextFrame && sinkData.nextFrame.timestamp <= time) {
      this.setCurrentFrame(sinkData, sinkData.nextFrame)
      sinkData.nextFrame = null
      this.startPrefetch(sinkData)
    }

    if (sinkData.currentFrame && this.isFrameValid(sinkData.currentFrame, time)) {
      if (!sinkData.nextFrame && !sinkData.prefetching) this.startPrefetch(sinkData)
      return sinkData.currentFrame
    }

    if (
      sinkData.iterator &&
      sinkData.currentFrame &&
      time >= sinkData.lastTime &&
      time < sinkData.lastTime + 2
    ) {
      const frame = await this.iterateToTime(sinkData, time)
      if (frame) {
        if (!sinkData.nextFrame && !sinkData.prefetching) this.startPrefetch(sinkData)
        return frame
      }
    }

    const frame = await this.seekToTime(sinkData, time)
    if (frame && !sinkData.nextFrame && !sinkData.prefetching) this.startPrefetch(sinkData)
    return frame
  }

  private async getReverseFrame({
    sinkData,
    time,
    maxDimension,
    frameRate
  }: {
    sinkData: VideoSinkData
    time: number
    maxDimension?: number
    frameRate?: number
  }): Promise<WrappedCanvas | null> {
    const normalizedMaxDimension =
      Number.isFinite(maxDimension) && maxDimension! > 0 ? Math.round(maxDimension!) : null
    const normalizedFrameRate =
      Number.isFinite(frameRate) && frameRate! > 0
        ? Math.max(1, Math.min(120, frameRate!))
        : sinkData.frameRate
    const decodeFrameRate = normalizedMaxDimension
      ? Math.min(PREVIEW_REVERSE_FRAME_RATE, normalizedFrameRate)
      : normalizedFrameRate
    const key = normalizedMaxDimension
      ? `preview:${normalizedMaxDimension}:${decodeFrameRate}`
      : `original:${decodeFrameRate}`

    if (sinkData.activeReverseKey !== key) {
      for (const [cacheKey, cache] of sinkData.reverseCaches) {
        if (cacheKey !== key) {
          cache.dispose()
          sinkData.reverseCaches.delete(cacheKey)
        }
      }
      sinkData.activeReverseKey = key
    }

    let cache = sinkData.reverseCaches.get(key)
    if (!cache) {
      const dimensions = this.getOutputDimensions({
        width: sinkData.displayWidth,
        height: sinkData.displayHeight,
        maxDimension: normalizedMaxDimension
      })
      const bytesPerFrame = dimensions.width * dimensions.height * 4
      const segmentDuration = normalizedMaxDimension
        ? PREVIEW_REVERSE_SEGMENT_SECONDS
        : Math.max(
            MIN_REVERSE_SEGMENT_SECONDS,
            Math.min(
              MAX_REVERSE_SEGMENT_SECONDS,
              ORIGINAL_REVERSE_MEMORY_BUDGET / bytesPerFrame / sinkData.frameRate
            )
          )

      cache = new ReverseFrameCache<WrappedCanvas>({
        segmentDuration,
        prefetchSegments: normalizedMaxDimension ? 2 : 1,
        getTimestamp: (frame) => frame.timestamp,
        releaseFrame: releaseStandaloneCanvas,
        loadSegment: (range, { prefetch }) =>
          this.decodeSegment({
            sinkData,
            ...dimensions,
            ...range,
            frameRate: decodeFrameRate,
            yieldToPlayback: Boolean(normalizedMaxDimension && prefetch)
          })
      })
      sinkData.reverseCaches.set(key, cache)
    }

    return cache.getFrame(time)
  }

  private async decodeSegment({
    sinkData,
    width,
    height,
    start,
    end,
    frameRate,
    yieldToPlayback
  }: {
    sinkData: VideoSinkData
    width: number
    height: number
    start: number
    end: number
    frameRate: number
    yieldToPlayback: boolean
  }): Promise<WrappedCanvas[]> {
    const sink = new CanvasSink(sinkData.videoTrack, {
      width,
      height,
      fit: 'contain'
    })
    const timestamps = createFrameTimestamps({ start, end, frameRate })
    const iterator = sink.canvasesAtTimestamps(timestamps)
    const frames: WrappedCanvas[] = []

    try {
      for await (const frame of iterator) {
        if (!frame) continue
        const previous = frames[frames.length - 1]
        if (previous && Math.abs(previous.timestamp - frame.timestamp) <= 1e-6) {
          releaseStandaloneCanvas(frame)
          continue
        }
        frames.push(frame)
        if (yieldToPlayback && frames.length % 2 === 0) await this.yieldToPlayback()
      }
      return frames
    } catch (error) {
      for (const frame of frames) releaseStandaloneCanvas(frame)
      throw error
    } finally {
      await iterator.return()
    }
  }

  private async yieldToPlayback(): Promise<void> {
    await new Promise<void>((resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        resolve()
      }
      const timeout = setTimeout(finish, 16)
      requestAnimationFrame(finish)
    })
  }

  private nextAnimationFrame(): Promise<void> {
    return new Promise((resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        resolve()
      }
      const timeout = setTimeout(finish, 50)
      requestAnimationFrame(finish)
    })
  }

  private getPreviewCaches(): ReverseFrameCache<WrappedCanvas>[] {
    return Array.from(this.sinks.values()).flatMap((sink) => {
      if (!sink.activeReverseKey?.startsWith('preview:')) return []
      const cache = sink.reverseCaches.get(sink.activeReverseKey)
      return cache ? [cache] : []
    })
  }

  private getOutputDimensions({
    width,
    height,
    maxDimension
  }: {
    width: number
    height: number
    maxDimension: number | null
  }): { width: number; height: number } {
    if (!maxDimension || Math.max(width, height) <= maxDimension) return { width, height }
    const scale = maxDimension / Math.max(width, height)
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    }
  }

  private isFrameValid(frame: WrappedCanvas, time: number): boolean {
    // Codec rounding can leave a one-microsecond overlap with the next frame.
    return time >= frame.timestamp && time < frame.timestamp + frame.duration - 1e-6
  }

  private async iterateToTime(
    sinkData: ForwardSinkData,
    targetTime: number
  ): Promise<WrappedCanvas | null> {
    if (!sinkData.iterator) return null

    try {
      while (true) {
        if (sinkData.prefetching && sinkData.prefetchPromise) {
          await sinkData.prefetchPromise
        }

        if (sinkData.nextFrame) {
          if (sinkData.nextFrame.timestamp > targetTime) return sinkData.currentFrame
          this.setCurrentFrame(sinkData, sinkData.nextFrame)
          sinkData.nextFrame = null
        } else {
          const { value: frame, done } = await sinkData.iterator.next()
          if (done || !frame) return sinkData.currentFrame
          if (frame.timestamp > targetTime) {
            sinkData.nextFrame = frame
            return sinkData.currentFrame
          }
          this.setCurrentFrame(sinkData, frame)
        }

        const frame = sinkData.currentFrame
        if (!frame) break
        if (this.isFrameValid(frame, targetTime)) return frame
      }
    } catch (error) {
      console.warn('Video iterator failed, will restart:', error)
      sinkData.iterator = null
    }

    return null
  }

  private async seekToTime(
    sinkData: ForwardSinkData,
    time: number
  ): Promise<WrappedCanvas | null> {
    try {
      if (sinkData.prefetching && sinkData.prefetchPromise) await sinkData.prefetchPromise
      if (sinkData.iterator) await sinkData.iterator.return()
      this.releaseForwardFrames(sinkData)

      sinkData.iterator = sinkData.sink.canvases(time)
      sinkData.lastTime = time

      const { value: frame } = await sinkData.iterator.next()
      if (!frame) return null
      this.setCurrentFrame(sinkData, frame)
      return frame
    } catch (error) {
      console.warn('Failed to seek video:', error)
      return null
    }
  }

  private startPrefetch(sinkData: ForwardSinkData): void {
    if (sinkData.prefetching || !sinkData.iterator || sinkData.nextFrame) return
    sinkData.prefetching = true
    sinkData.prefetchPromise = this.prefetchNextFrame(sinkData)
  }

  private async prefetchNextFrame(sinkData: ForwardSinkData): Promise<void> {
    if (!sinkData.iterator) {
      sinkData.prefetching = false
      sinkData.prefetchPromise = null
      return
    }

    try {
      const { value: frame, done } = await sinkData.iterator.next()
      if (!done && frame) sinkData.nextFrame = frame
    } catch (error) {
      console.warn('Video prefetch failed:', error)
      sinkData.iterator = null
    } finally {
      sinkData.prefetching = false
      sinkData.prefetchPromise = null
    }
  }

  private getForwardSink({
    sinkData,
    maxDimension
  }: {
    sinkData: VideoSinkData
    maxDimension?: number
  }): ForwardSinkData {
    const normalizedMaxDimension =
      Number.isFinite(maxDimension) && maxDimension! > 0 ? Math.round(maxDimension!) : null
    const key = normalizedMaxDimension ? `preview:${normalizedMaxDimension}` : 'original'
    const existing = sinkData.forwardSinks.get(key)
    if (existing) return existing

    const dimensions = this.getOutputDimensions({
      width: sinkData.displayWidth,
      height: sinkData.displayHeight,
      maxDimension: normalizedMaxDimension
    })
    const forwardSink: ForwardSinkData = {
      key,
      ...dimensions,
      sink: new CanvasSink(sinkData.videoTrack, {
        width: dimensions.width,
        height: dimensions.height,
        poolSize: 3,
        fit: 'contain'
      }),
      iterator: null,
      currentFrame: null,
      nextFrame: null,
      lastTime: -1,
      prefetching: false,
      prefetchPromise: null
    }
    sinkData.forwardSinks.set(key, forwardSink)
    return forwardSink
  }

  private setCurrentFrame(sinkData: ForwardSinkData, frame: WrappedCanvas): void {
    sinkData.currentFrame = frame
    sinkData.lastTime = frame.timestamp
  }

  private releaseForwardFrames(sinkData: ForwardSinkData): void {
    // CanvasSink owns these pooled canvases and reuses them in a ring. Resizing
    // a discarded frame would permanently shrink the corresponding pool slot.
    sinkData.currentFrame = null
    sinkData.nextFrame = null
  }

  private async ensureSink({
    mediaId,
    file
  }: Pick<FrameRequest, 'mediaId' | 'file'>): Promise<void> {
    const existing = this.sinks.get(mediaId)
    if (existing?.file === file) return
    if (existing) this.clearVideo({ mediaId })

    const pending = this.initPromises.get(mediaId)
    if (pending) {
      await pending
      return
    }

    const promise = this.initializeSink({ mediaId, file })
    this.initPromises.set(mediaId, promise)
    try {
      await promise
    } finally {
      this.initPromises.delete(mediaId)
    }
  }

  private async initializeSink({ mediaId, file }: Pick<FrameRequest, 'mediaId' | 'file'>) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    try {
      const videoTrack = await input.getPrimaryVideoTrack()
      if (!videoTrack) throw new Error('No video track found')
      if (!(await videoTrack.canDecode())) throw new Error('Video codec not supported for decoding')

      const stats = await videoTrack.computePacketStats(120).catch(() => null)
      const frameRate = Math.max(1, Math.min(120, stats?.averagePacketRate || 30))
      this.sinks.set(mediaId, {
        input,
        videoTrack,
        file,
        displayWidth: videoTrack.displayWidth,
        displayHeight: videoTrack.displayHeight,
        frameRate,
        forwardSinks: new Map(),
        reverseCaches: new Map(),
        activeReverseKey: null
      })
    } catch (error) {
      input.dispose()
      console.error(`Failed to initialize video sink for ${mediaId}:`, error)
      throw error
    }
  }

  clearVideo({ mediaId }: { mediaId: string }): void {
    const sinkData = this.sinks.get(mediaId)
    if (sinkData) {
      for (const forwardSink of sinkData.forwardSinks.values()) {
        if (forwardSink.iterator) void forwardSink.iterator.return()
        this.releaseForwardFrames(forwardSink)
      }
      sinkData.forwardSinks.clear()
      for (const cache of sinkData.reverseCaches.values()) cache.dispose()
      sinkData.input.dispose()
      this.sinks.delete(mediaId)
    }
    this.initPromises.delete(mediaId)
  }

  clearAll(): void {
    for (const mediaId of this.sinks.keys()) this.clearVideo({ mediaId })
  }

  getStats() {
    const reverse = Array.from(this.sinks.values()).flatMap((sink) =>
      Array.from(sink.reverseCaches.values(), (cache) => cache.getStats())
    )
    const forward = Array.from(this.sinks.values()).flatMap((sink) =>
      Array.from(sink.forwardSinks.values())
    )
    return {
      totalSinks: this.sinks.size,
      activeSinks: forward.filter((sink) => sink.iterator).length,
      cachedFrames:
        forward.reduce(
          (total, sink) =>
            total + Number(Boolean(sink.currentFrame)) + Number(Boolean(sink.nextFrame)),
          0
        ) +
        reverse.reduce((total, stats) => total + stats.cachedFrames, 0),
      reverseSegments: reverse.reduce((total, stats) => total + stats.cachedSegments, 0),
      forwardSinks: forward.map(({ key, width, height }) => ({ key, width, height }))
    }
  }
}

export const videoCache = new VideoCache()

export const prepareReversePlayback = (options?: { onPreparing?: () => void }) =>
  videoCache.prepareReversePlayback(options)
