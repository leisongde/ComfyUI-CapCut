const TIME_EPSILON = 1e-6

export function createFrameTimestamps({
  start,
  end,
  frameRate
}: {
  start: number
  end: number
  frameRate: number
}): number[] {
  const normalizedFrameRate = Math.max(1, Math.min(120, frameRate))
  const frameDuration = 1 / normalizedFrameRate
  const timestamps: number[] = []

  for (let timestamp = start; timestamp <= end + TIME_EPSILON; timestamp += frameDuration) {
    timestamps.push(Math.min(timestamp, end))
  }

  if (timestamps.length === 0 || end - timestamps[timestamps.length - 1] > TIME_EPSILON) {
    timestamps.push(end)
  }

  return timestamps
}

type Segment<T> = {
  start: number
  end: number
  frames: T[]
}

type PendingSegment<T> = {
  start: number
  end: number
  promise: Promise<Segment<T> | null>
}

export type ReverseFrameCacheOptions<T> = {
  segmentDuration: number
  loadSegment: (
    range: { start: number; end: number },
    options: { prefetch: boolean }
  ) => Promise<T[]>
  getTimestamp: (frame: T) => number
  releaseFrame?: (frame: T) => void
  prefetchSegments?: number
}

/**
 * Keeps two adjacent source-time windows for reverse playback. Frames inside a
 * window are decoded once in presentation order, then consumed in reverse.
 */
export class ReverseFrameCache<T> {
  private current: Segment<T> | null = null
  private prefetched: Segment<T>[] = []
  private pending = new Map<string, PendingSegment<T>>()
  private generation = 0
  private disposed = false
  private readonly prefetchSegments: number

  constructor(private readonly options: ReverseFrameCacheOptions<T>) {
    if (!Number.isFinite(options.segmentDuration) || options.segmentDuration <= 0) {
      throw new Error('segmentDuration must be a positive number')
    }
    this.prefetchSegments = Math.max(1, Math.min(4, Math.round(options.prefetchSegments ?? 1)))
  }

  async getFrame(time: number): Promise<T | null> {
    if (this.disposed) return null

    const targetTime = Math.max(0, time)
    if (this.current && this.contains(this.current, targetTime)) {
      this.prefetchPrevious(this.current)
      return this.findFrame(this.current.frames, targetTime)
    }

    const prefetchedIndex = this.prefetched.findIndex((segment) =>
      this.contains(segment, targetTime)
    )
    if (prefetchedIndex >= 0) {
      this.promotePrefetched(prefetchedIndex)
      this.prefetchPrevious(this.current!)
      return this.findFrame(this.current!.frames, targetTime)
    }

    const pending = Array.from(this.pending.values()).find((segment) =>
      this.contains(segment, targetTime)
    )
    if (pending) {
      const segment = await pending.promise
      if (!segment || this.disposed) return null
      const loadedIndex = this.prefetched.indexOf(segment)
      if (loadedIndex >= 0) this.promotePrefetched(loadedIndex)
      else this.installCurrent(segment)
      this.prefetchPrevious(segment)
      return this.findFrame(segment.frames, targetTime)
    }

    const range = this.getRange(targetTime)
    this.invalidate()
    const segment = await this.load(range, false)
    if (!segment || this.disposed) return null

    this.installCurrent(segment)
    this.prefetchPrevious(segment)
    return this.findFrame(segment.frames, targetTime)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation++
    this.pending.clear()
    this.releaseSegment(this.current)
    for (const segment of this.prefetched) this.releaseSegment(segment)
    this.current = null
    this.prefetched = []
  }

  getStats(): { cachedSegments: number; cachedFrames: number; loading: boolean } {
    const segments = [this.current, ...this.prefetched].filter(
      (segment): segment is Segment<T> => segment !== null
    )
    return {
      cachedSegments: segments.length,
      cachedFrames: segments.reduce((total, segment) => total + segment.frames.length, 0),
      loading: this.pending.size > 0
    }
  }

  async waitForPending(): Promise<void> {
    while (!this.disposed && this.pending.size > 0) {
      await Promise.allSettled(Array.from(this.pending.values(), (item) => item.promise))
    }
  }

  private getRange(time: number): { start: number; end: number } {
    const duration = this.options.segmentDuration
    const index = Math.max(0, Math.ceil(time / duration) - 1)
    const start = index * duration
    return { start, end: start + duration }
  }

  private contains(range: { start: number; end: number }, time: number): boolean {
    return time >= range.start - TIME_EPSILON && time <= range.end + TIME_EPSILON
  }

  private findFrame(frames: T[], time: number): T | null {
    if (frames.length === 0) return null

    let low = 0
    let high = frames.length - 1
    let match = -1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (this.options.getTimestamp(frames[middle]) <= time + TIME_EPSILON) {
        match = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    return match >= 0 ? frames[match] : frames[0]
  }

  private load(
    range: { start: number; end: number },
    prefetched: boolean
  ): Promise<Segment<T> | null> {
    if (this.disposed) return Promise.resolve(null)

    const key = this.rangeKey(range)
    const existing = this.pending.get(key)
    if (existing) return existing.promise

    const generation = this.generation
    const promise = this.options
      .loadSegment(range, { prefetch: prefetched })
      .then((frames) => {
        const segment = { ...range, frames }
        if (this.disposed || generation !== this.generation) {
          this.releaseSegment(segment)
          return null
        }
        if (prefetched) this.addPrefetched(segment)
        return segment
      })
      .catch((error) => {
        console.warn('Failed to prepare reverse video frames:', error)
        return null
      })
      .finally(() => {
        if (this.pending.get(key)?.promise === promise) this.pending.delete(key)
      })

    this.pending.set(key, { ...range, promise })
    return promise
  }

  private prefetchPrevious(segment: Segment<T>): void {
    if (this.disposed || segment.start <= TIME_EPSILON) return

    for (let index = 1; index <= this.prefetchSegments; index++) {
      const end = segment.start - (index - 1) * this.options.segmentDuration
      if (end <= TIME_EPSILON) break
      const range = {
        start: Math.max(0, end - this.options.segmentDuration),
        end
      }
      if (
        this.prefetched.some((item) => this.sameRange(item, range)) ||
        this.pending.has(this.rangeKey(range))
      )
        continue
      void this.load(range, true)
    }
  }

  private promotePrefetched(index: number): void {
    const next = this.prefetched[index]
    for (const segment of this.prefetched.slice(0, index)) this.releaseSegment(segment)
    this.releaseSegment(this.current)
    this.current = next
    this.prefetched = this.prefetched.slice(index + 1)
  }

  private installCurrent(segment: Segment<T>): void {
    if (this.current !== segment) this.releaseSegment(this.current)
    for (const item of this.prefetched) {
      if (item !== segment) this.releaseSegment(item)
    }
    this.current = segment
    this.prefetched = []
  }

  private invalidate(): void {
    this.generation++
    this.pending.clear()
    this.releaseSegment(this.current)
    for (const segment of this.prefetched) this.releaseSegment(segment)
    this.current = null
    this.prefetched = []
  }

  private addPrefetched(segment: Segment<T>): void {
    if (!this.current || segment.end > this.current.start + TIME_EPSILON) {
      this.releaseSegment(segment)
      return
    }
    if (this.prefetched.some((item) => this.sameRange(item, segment))) {
      this.releaseSegment(segment)
      return
    }

    this.prefetched.push(segment)
    this.prefetched.sort((left, right) => right.start - left.start)
    for (const item of this.prefetched.splice(this.prefetchSegments)) this.releaseSegment(item)
  }

  private rangeKey(range: { start: number; end: number }): string {
    return `${range.start.toFixed(6)}:${range.end.toFixed(6)}`
  }

  private sameRange(
    left: { start: number; end: number },
    right: { start: number; end: number }
  ): boolean {
    return (
      Math.abs(left.start - right.start) <= TIME_EPSILON &&
      Math.abs(left.end - right.end) <= TIME_EPSILON
    )
  }

  private releaseSegment(segment: Segment<T> | null): void {
    if (!segment || !this.options.releaseFrame) return
    for (const frame of segment.frames) this.options.releaseFrame(frame)
  }
}
