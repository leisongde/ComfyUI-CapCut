import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ALL_FORMATS, BlobSource, CanvasSink, Input, type WrappedCanvas } from 'mediabunny'
import { Crosshair, LoaderCircle, ScanSearch, Square, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_TEXT_ELEMENT } from '@/constants/text-constants'
import { AddTrackCommand, BatchCommand, InsertElementCommand } from '@/lib/commands'
import { Switch } from '@/components/ui/switch'
import { useEditor } from '@/hooks/use-editor'
import { usePlaybackTime } from './playback-time'
import { getVisualSourceTime } from '@/lib/timeline/element-utils'
import type { MediaAsset } from '@/types/assets'
import type { VideoElement } from '@/types/timeline'
import type { EditingCustomCutoutRuntimeStatus } from '../../shared/editing'
import {
  endCustomCutoutTracking,
  getCustomCutoutStatus,
  startCustomCutoutTracking,
  trackCustomCutoutFrame
} from './custom-cutout-api'
import {
  analyzeObjectLockMask,
  createObjectLockSeedMask,
  mapObjectLockSampleToCanvas,
  normalizeObjectLock,
  type ObjectLockAnchor,
  type ObjectLockMode,
  type ObjectLockSample,
  type ObjectLockSettings
} from './object-lock'
import { resolveVisualState } from './visual-keyframes'
import {
  buildFollowerTracking,
  getTrackingFollowers,
  getTrackingSourceCandidates,
  type TrackingElement
} from './tracking-sources'

interface NormalizedBox {
  x: number
  y: number
  width: number
  height: number
}

interface CapturedTrackingFrame {
  rgba: Uint8Array
  width: number
  height: number
  sourceTime: number
}

interface VideoFrameReader {
  duration: number
  readOne(sourceTime: number): Promise<Uint8Array>
  readFrames(
    sourceFrames: number[],
    fps: number
  ): AsyncGenerator<{ sourceFrame: number; rgba: Uint8Array }, void, unknown>
  close(): void
}

const PREVIEW_MAX_EDGE = 900
const TRACKING_MAX_EDGE = 640
const TRACKING_MAX_FPS = 12
const BACKWARD_DECODE_CHUNK = 36

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

function proxySize(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(16, Math.round(width * scale)),
    height: Math.max(16, Math.round(height * scale))
  }
}

function rgbaFromWrappedCanvas(frame: WrappedCanvas): Uint8Array {
  const context = frame.canvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!context) throw new Error('无法读取视频跟踪画面')
  return new Uint8Array(context.getImageData(0, 0, frame.canvas.width, frame.canvas.height).data)
}

async function openVideoFrameReader(
  asset: MediaAsset,
  width: number,
  height: number
): Promise<VideoFrameReader> {
  const input = new Input({ source: new BlobSource(asset.file), formats: ALL_FORMATS })
  const videoTrack = await input.getPrimaryVideoTrack()
  if (!videoTrack) {
    input.dispose()
    throw new Error('素材中没有可用的视频轨道')
  }
  if (!(await videoTrack.canDecode())) {
    input.dispose()
    throw new Error('当前系统不支持该视频编码的硬件解码')
  }
  const duration = await input.computeDuration()
  const sink = new CanvasSink(videoTrack, { width, height, fit: 'fill', poolSize: 3 })
  return {
    duration,
    async readOne(sourceTime: number) {
      const target = clamp(sourceTime, 0, Math.max(0, duration - 0.001))
      const decoded = await sink.getCanvas(target)
      if (!decoded) throw new Error('无法解码视频跟踪画面')
      return rgbaFromWrappedCanvas(decoded)
    },
    async *readFrames(sourceFrames: number[], fps: number) {
      const timestamps = sourceFrames.map((sourceFrame) => sourceFrame / fps)
      let index = 0
      for await (const decoded of sink.canvasesAtTimestamps(timestamps)) {
        const sourceFrame = sourceFrames[index++]
        if (!decoded) throw new Error(`无法解码视频第 ${sourceFrame} 帧`)
        yield { sourceFrame, rgba: rgbaFromWrappedCanvas(decoded) }
      }
      if (index !== sourceFrames.length) throw new Error('视频连续解码提前结束')
    },
    close() {
      input.dispose()
    }
  }
}

function sourceToTimelineTime(element: VideoElement, sourceTime: number): number {
  const rate = Math.max(0.01, element.playbackRate ?? 1)
  const elapsed = (sourceTime - element.trimStart) / rate
  return element.startTime + (element.reversed ? element.duration - elapsed : elapsed)
}

function sampleFromBox(box: NormalizedBox, time: number): ObjectLockSample {
  return {
    time,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
    width: box.width,
    height: box.height,
    confidence: 1
  }
}

function isPlausibleSample(previous: ObjectLockSample, sample: ObjectLockSample): boolean {
  const distance = Math.hypot(sample.centerX - previous.centerX, sample.centerY - previous.centerY)
  const previousArea = previous.width * previous.height
  const area = sample.width * sample.height
  const areaRatio = Math.max(area / previousArea, previousArea / area)
  return distance <= 0.42 && areaRatio <= 7
}

function TrackingTargetDialog({
  editor,
  followerElement,
  sourceElement,
  sourceTrackId,
  sourceTrackName,
  sourceAsset,
  current,
  onComplete,
  onClose
}: {
  editor: ReturnType<typeof useEditor>
  followerElement: TrackingElement
  sourceElement: VideoElement
  sourceTrackId: string
  sourceTrackName: string
  sourceAsset: MediaAsset
  current: ObjectLockSettings | null
  onComplete(settings: ObjectLockSettings): void
  onClose(): void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const cancellation = useRef<{ cancelled: boolean } | null>(null)
  const activeSession = useRef<string | null>(null)
  const [frame, setFrame] = useState<CapturedTrackingFrame | null>(null)
  const [selection, setSelection] = useState<NormalizedBox | null>(null)
  const [loading, setLoading] = useState(true)
  const [tracking, setTracking] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [runtime, setRuntime] = useState<EditingCustomCutoutRuntimeStatus | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    let reader: VideoFrameReader | null = null
    const load = async () => {
      const sourceWidth = sourceAsset.width ?? 1920
      const sourceHeight = sourceAsset.height ?? 1080
      const size = proxySize(sourceWidth, sourceHeight, PREVIEW_MAX_EDGE)
      reader = await openVideoFrameReader(sourceAsset, size.width, size.height)
      const overlapStart = Math.max(sourceElement.startTime, followerElement.startTime)
      const overlapEnd = Math.min(
        sourceElement.startTime + sourceElement.duration,
        followerElement.startTime + followerElement.duration
      )
      const timelineTime = clamp(
        editor.playback.getCurrentTime(),
        overlapStart,
        Math.max(overlapStart, overlapEnd - 1e-6)
      )
      const sourceTime = getVisualSourceTime({
        timelineTime,
        startTime: sourceElement.startTime,
        duration: sourceElement.duration,
        trimStart: sourceElement.trimStart,
        playbackRate: sourceElement.playbackRate,
        reversed: sourceElement.reversed
      })
      const rgba = await reader.readOne(sourceTime)
      if (!disposed) setFrame({ rgba, width: size.width, height: size.height, sourceTime })
    }
    void load()
      .catch((failure) => {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure))
      })
      .finally(() => {
        reader?.close()
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
      reader?.close()
    }
  }, [editor, followerElement, sourceAsset, sourceElement])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    canvas.width = frame.width
    canvas.height = frame.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.putImageData(
      new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height),
      0,
      0
    )
    if (!selection) return
    const x = selection.x * frame.width
    const y = selection.y * frame.height
    const width = selection.width * frame.width
    const height = selection.height * frame.height
    context.save()
    context.fillStyle = 'rgb(0 0 0 / 48%)'
    context.beginPath()
    context.rect(0, 0, frame.width, frame.height)
    context.rect(x, y, width, height)
    context.fill('evenodd')
    context.strokeStyle = '#38bdf8'
    context.lineWidth = Math.max(2, frame.width / 450)
    context.setLineDash([8, 5])
    context.strokeRect(x, y, width, height)
    context.restore()
  }, [frame, selection])

  useEffect(() => {
    if (!tracking) return
    let disposed = false
    const update = () =>
      void getCustomCutoutStatus()
        .then((status) => {
          if (!disposed) setRuntime(status)
        })
        .catch((failure) => {
          if (!disposed) setError(failure instanceof Error ? failure.message : String(failure))
        })
    update()
    const timer = setInterval(update, 500)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [tracking])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !tracking) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tracking, onClose])

  useEffect(() => {
    return () => {
      if (cancellation.current) cancellation.current.cancelled = true
      if (activeSession.current) void endCustomCutoutTracking(activeSession.current)
    }
  }, [])

  const pointerPosition = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
    }
  }

  const updateSelection = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    setSelection({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tracking) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointerPosition(event)
    dragStart.current = point
    updateSelection(point, point)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragStart.current || tracking) return
    updateSelection(dragStart.current, pointerPosition(event))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragStart.current) return
    updateSelection(dragStart.current, pointerPosition(event))
    dragStart.current = null
  }

  const stopTracking = () => {
    if (cancellation.current) cancellation.current.cancelled = true
  }

  const runTracking = async () => {
    if (!frame || !selection || selection.width < 0.01 || selection.height < 0.01 || tracking)
      return
    const task = { cancelled: false }
    cancellation.current = task
    setTracking(true)
    setProgress({ current: 0, total: 0 })
    setError('')
    let reader: VideoFrameReader | null = null
    try {
      const sourceWidth = sourceAsset.width ?? frame.width
      const sourceHeight = sourceAsset.height ?? frame.height
      const size = proxySize(sourceWidth, sourceHeight, TRACKING_MAX_EDGE)
      reader = await openVideoFrameReader(sourceAsset, size.width, size.height)
      const project = editor.project.getActive()
      const trackingFps = Math.max(
        1,
        Math.min(
          TRACKING_MAX_FPS,
          sourceAsset.fps && sourceAsset.fps > 0 ? sourceAsset.fps : project.settings.fps
        )
      )
      const overlapStart = Math.max(sourceElement.startTime, followerElement.startTime)
      const overlapEnd = Math.min(
        sourceElement.startTime + sourceElement.duration,
        followerElement.startTime + followerElement.duration
      )
      if (overlapEnd <= overlapStart) throw new Error('跟踪源与当前元素没有重叠时间')
      const firstSourceTime = getVisualSourceTime({
        timelineTime: overlapStart,
        startTime: sourceElement.startTime,
        duration: sourceElement.duration,
        trimStart: sourceElement.trimStart,
        playbackRate: sourceElement.playbackRate,
        reversed: sourceElement.reversed
      })
      const lastSourceTime = getVisualSourceTime({
        timelineTime: Math.max(overlapStart, overlapEnd - 1e-6),
        startTime: sourceElement.startTime,
        duration: sourceElement.duration,
        trimStart: sourceElement.trimStart,
        playbackRate: sourceElement.playbackRate,
        reversed: sourceElement.reversed
      })
      const rangeStartTime = clamp(Math.min(firstSourceTime, lastSourceTime), 0, reader.duration)
      const rangeEndTime = clamp(Math.max(firstSourceTime, lastSourceTime), 0, reader.duration)
      const startFrame = Math.max(0, Math.ceil(rangeStartTime * trackingFps - 1e-6))
      const endFrame = Math.max(
        startFrame,
        Math.floor(Math.max(rangeStartTime, rangeEndTime - 0.001) * trackingFps)
      )
      const seedFrame = clamp(Math.round(frame.sourceTime * trackingFps), startFrame, endFrame)
      const seedRgba = await reader.readOne(seedFrame / trackingFps)
      const seedMask = createObjectLockSeedMask(size.width, size.height, selection)
      const fitCanvasSize = project.settings.originalCanvasSize ?? project.settings.canvasSize
      const trackingCurrentVideo = sourceElement.id === followerElement.id
      const mapSample = (sample: ObjectLockSample): ObjectLockSample => {
        const timelineTime = sourceToTimelineTime(sourceElement, sample.time)
        if (trackingCurrentVideo) return { ...sample, time: timelineTime - sourceElement.startTime }
        const sourceVisualState = resolveVisualState({ source: sourceElement, timelineTime })
        return mapObjectLockSampleToCanvas({
          sample: { ...sample, time: timelineTime },
          sourceSize: { width: sourceWidth, height: sourceHeight },
          fitCanvasSize,
          transform: sourceVisualState.transform
        })
      }
      const seedRaw = sampleFromBox(selection, seedFrame / trackingFps)
      const seed = mapSample(seedRaw)
      const samples: ObjectLockSample[] = [seed]
      let lostFrames = 0
      let completed = 0
      const total = Math.max(0, endFrame - startFrame)
      setProgress({ current: 0, total })

      const runDirection = async (sourceFrames: number[]) => {
        if (!sourceFrames.length || task.cancelled) return
        const session = await startCustomCutoutTracking({
          rgba: new Uint8Array(seedRgba),
          mask: new Uint8Array(seedMask),
          width: size.width,
          height: size.height
        })
        activeSession.current = session.sessionId
        let previousRaw = seedRaw
        const processFrame = async (sourceFrame: number, rgba: Uint8Array) => {
          const result = await trackCustomCutoutFrame({
            sessionId: session.sessionId,
            rgba,
            width: size.width,
            height: size.height
          })
          const analysis = analyzeObjectLockMask(result.bytes, size.width, size.height)
          if (analysis) {
            const rawSample: ObjectLockSample = {
              time: sourceFrame / trackingFps,
              ...analysis
            }
            if (isPlausibleSample(previousRaw, rawSample)) {
              samples.push(mapSample(rawSample))
              previousRaw = rawSample
            } else lostFrames += 1
          } else lostFrames += 1
          completed += 1
          setProgress({ current: completed, total })
        }
        try {
          if (sourceFrames[0] < sourceFrames.at(-1)!) {
            for await (const decoded of reader!.readFrames(sourceFrames, trackingFps)) {
              if (task.cancelled) break
              await processFrame(decoded.sourceFrame, decoded.rgba)
            }
          } else {
            for (let offset = 0; offset < sourceFrames.length; offset += BACKWARD_DECODE_CHUNK) {
              if (task.cancelled) break
              const processingOrder = sourceFrames.slice(offset, offset + BACKWARD_DECODE_CHUNK)
              const decodeOrder = [...processingOrder].sort((left, right) => left - right)
              const decodedFrames = new Map<number, Uint8Array>()
              for await (const decoded of reader!.readFrames(decodeOrder, trackingFps))
                decodedFrames.set(decoded.sourceFrame, decoded.rgba)
              for (const sourceFrame of processingOrder) {
                if (task.cancelled) break
                const rgba = decodedFrames.get(sourceFrame)
                if (!rgba) throw new Error(`无法读取视频第 ${sourceFrame} 帧`)
                await processFrame(sourceFrame, rgba)
              }
            }
          }
        } finally {
          await endCustomCutoutTracking(session.sessionId).catch(() => {})
          if (activeSession.current === session.sessionId) activeSession.current = null
        }
      }

      await runDirection(
        Array.from({ length: endFrame - seedFrame }, (_, index) => seedFrame + index + 1)
      )
      await runDirection(
        Array.from({ length: seedFrame - startFrame }, (_, index) => seedFrame - index - 1)
      )
      if (task.cancelled) return
      samples.sort((left, right) => left.time - right.time)
      onComplete({
        version: trackingCurrentVideo ? 3 : 2,
        ...(trackingCurrentVideo ? { subjectCenter: current?.subjectCenter ?? false } : {}),
        enabled: true,
        mode: current?.mode ?? 'position',
        anchor: current?.anchor ?? 'current',
        smoothing: current?.smoothing ?? 55,
        maxScale: current?.maxScale ?? 1.35,
        sourceSize: trackingCurrentVideo
          ? { width: sourceWidth, height: sourceHeight }
          : { ...fitCanvasSize },
        fitCanvasSize: { ...fitCanvasSize },
        sourceElementId: sourceElement.id,
        sourceElementName: sourceElement.name,
        sourceTrackId,
        seed,
        samples,
        lostFrames
      })
    } catch (failure) {
      if (!task.cancelled) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      reader?.close()
      cancellation.current = null
      setTracking(false)
    }
  }

  const validSelection = Boolean(selection && selection.width >= 0.01 && selection.height >= 0.01)
  const progressPercent = progress.total ? Math.round((progress.current / progress.total) * 100) : 0
  const statusText =
    runtime?.phase === 'downloading-tracker'
      ? `${runtime.detail ?? '正在下载跟踪模型'}${runtime.progress !== undefined ? ` ${runtime.progress}%` : ''}`
      : runtime?.phase === 'loading-tracker'
        ? (runtime.detail ?? '正在加载跟踪模型')
        : tracking
          ? progress.total
            ? `正在分析 ${progressPercent}%`
            : (runtime?.detail ?? '正在准备跟踪模型')
          : '框选目标'

  return createPortal(
    <div className="object-lock-overlay" role="dialog" aria-modal="true" aria-label="运动跟踪">
      <header className="object-lock-header">
        <div>
          <strong>运动跟踪</strong>
          <span>
            {sourceTrackName} · {sourceElement.name} · {statusText}
          </span>
        </div>
        <button type="button" title="关闭" disabled={tracking} onClick={onClose}>
          <X />
        </button>
      </header>
      <main className="object-lock-stage">
        {loading ? (
          <div className="object-lock-loading">
            <LoaderCircle className="animate-spin" />
            <span>正在读取画面</span>
          </div>
        ) : frame ? (
          <div className="object-lock-canvas-wrap">
            <canvas
              ref={canvasRef}
              className={tracking ? 'is-busy' : ''}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {!selection && !tracking && (
              <div className="object-lock-canvas-prompt">
                <Crosshair />
                <span>框选目标</span>
              </div>
            )}
          </div>
        ) : null}
        {error && <div className="object-lock-error">{error}</div>}
      </main>
      <footer className="object-lock-footer">
        <span>{selection ? '已选择目标区域' : '在画面中拖动选择区域'}</span>
        <div>
          <button
            type="button"
            className="object-lock-secondary"
            disabled={tracking}
            onClick={onClose}
          >
            取消
          </button>
          {tracking ? (
            <button type="button" className="object-lock-danger" onClick={stopTracking}>
              <Square />
              停止
            </button>
          ) : (
            <button
              type="button"
              className="object-lock-primary"
              disabled={!validSelection || loading}
              onClick={() => void runTracking()}
            >
              <ScanSearch />
              开始跟踪
            </button>
          )}
        </div>
      </footer>
    </div>,
    document.body
  )
}

export function TrackingProperties({
  element,
  trackId
}: {
  element: TrackingElement
  trackId: string
}) {
  const editor = useEditor()
  const currentTime = usePlaybackTime(editor.playback)
  const savedSettings = normalizeObjectLock(element.objectLock)
  const candidates = getTrackingSourceCandidates({
    tracks: editor.timeline.getTracks(),
    assets: editor.media.getAssets(),
    follower: element,
    followerTrackId: trackId
  })
  const preferredCandidate =
    candidates.find((candidate) => candidate.element.id === savedSettings?.sourceElementId) ??
    candidates.find((candidate) => candidate.element.id === element.id) ??
    candidates.find(
      (candidate) =>
        currentTime >= candidate.element.startTime &&
        currentTime < candidate.element.startTime + candidate.element.duration
    ) ??
    candidates[0]
  const [sourceChoice, setSourceChoice] = useState({
    elementId: element.id,
    sourceId: preferredCandidate?.element.id ?? ''
  })
  const [open, setOpen] = useState(false)
  const selectedSource =
    (sourceChoice.elementId === element.id
      ? candidates.find((candidate) => candidate.element.id === sourceChoice.sourceId)
      : undefined) ?? preferredCandidate
  const trackingCurrentVideo = element.type === 'video' && selectedSource?.element.id === element.id
  const settings =
    savedSettings &&
    (!savedSettings.sourceElementId || savedSettings.sourceElementId === selectedSource?.element.id)
      ? savedSettings
      : null
  const followers =
    element.type === 'video'
      ? getTrackingFollowers(editor.timeline.getTracks(), element, trackId)
      : []
  const [followerId, setFollowerId] = useState('')
  const selectedFollower =
    followers.find((candidate) => candidate.element.id === followerId) ?? followers[0]
  const sourceTracking = normalizeObjectLock(selectedSource?.element.objectLock)

  useEffect(() => {
    const changedElement = sourceChoice.elementId !== element.id
    if (selectedSource && (changedElement || sourceChoice.sourceId !== selectedSource.element.id))
      setSourceChoice({ elementId: element.id, sourceId: selectedSource.element.id })
    if (open && (!selectedSource || changedElement)) setOpen(false)
  }, [open, selectedSource, sourceChoice, element.id])

  const update = (next: ObjectLockSettings | undefined, pushHistory = true) => {
    const updates = [{ trackId, elementId: element.id, updates: { objectLock: next } }]
    if (element.type === 'video' && (next?.version === 3 || savedSettings?.version === 3)) {
      const tracking =
        next?.version === 3 ? buildFollowerTracking(element, trackId, next) : undefined
      for (const candidate of followers) {
        const bound = normalizeObjectLock(candidate.element.objectLock)
        if (bound?.version !== 2 || bound.sourceElementId !== element.id) continue
        const objectLock = tracking
          ? {
              ...tracking,
              enabled: bound.enabled,
              mode: bound.mode,
              anchor: bound.anchor,
              smoothing: bound.smoothing,
              maxScale: bound.maxScale
            }
          : undefined
        updates.push({
          trackId: candidate.trackId,
          elementId: candidate.element.id,
          updates: { objectLock }
        })
      }
    }
    editor.timeline.updateElements({ updates, pushHistory })
  }

  const patchSettings = (patch: Partial<ObjectLockSettings>, pushHistory = true) => {
    if (settings) update({ ...settings, ...patch }, pushHistory)
  }

  const setMode = (mode: ObjectLockMode) => patchSettings({ mode })
  const setAnchor = (anchor: ObjectLockAnchor) => patchSettings({ anchor })

  const bindFollower = () => {
    if (element.type !== 'video' || !settings || !selectedFollower) return
    editor.timeline.updateElements({
      updates: [
        {
          trackId: selectedFollower.trackId,
          elementId: selectedFollower.element.id,
          updates: { objectLock: buildFollowerTracking(element, trackId, settings) }
        }
      ]
    })
    toast.success(`已绑定 ${selectedFollower.element.name}`)
  }

  const addFollowingText = () => {
    if (element.type !== 'video' || !settings) return
    const text = {
      ...DEFAULT_TEXT_ELEMENT,
      name: '跟随文字',
      content: '跟随文字',
      startTime: element.startTime,
      duration: element.duration,
      trimStart: 0,
      trimEnd: 0,
      objectLock: buildFollowerTracking(element, trackId, settings)
    }
    const track = new AddTrackCommand('text', 0)
    editor.command.execute({
      command: new BatchCommand([
        track,
        new InsertElementCommand({
          element: text,
          placement: { mode: 'explicit', trackId: track.getTrackId() }
        })
      ])
    })
    toast.success('跟随文字已添加，可在时间线上修改内容')
  }

  return (
    <div className="object-lock-properties">
      <section className="object-lock-panel-heading">
        <div>
          <strong>运动跟踪</strong>
          <span>
            {settings
              ? `${settings.sourceElementName ?? '原有视频'} · ${settings.samples.length} 个轨迹点${settings.lostFrames ? ` · ${settings.lostFrames} 帧丢失` : ''}`
              : '未设置'}
          </span>
        </div>
        <div>
          {settings && !trackingCurrentVideo && (
            <Switch
              checked={settings.enabled}
              aria-label={settings.enabled ? '关闭运动跟踪' : '开启运动跟踪'}
              onCheckedChange={(enabled) => patchSettings({ enabled })}
            />
          )}
          <button
            type="button"
            disabled={!selectedSource}
            title={!selectedSource ? '请在当前素材下方添加时间重叠的视频' : undefined}
            onClick={() => setOpen(true)}
          >
            <Crosshair />
            {settings ? '重新选择' : '选择目标'}
          </button>
        </div>
      </section>

      <div className="object-lock-source">
        <label htmlFor={`tracking-source-${element.id}`}>跟踪源</label>
        <select
          id={`tracking-source-${element.id}`}
          value={selectedSource?.element.id ?? ''}
          disabled={!candidates.length}
          onChange={(event) => {
            setSourceChoice({ elementId: element.id, sourceId: event.target.value })
            setOpen(false)
          }}
        >
          {!candidates.length && <option value="">请在下方添加视频</option>}
          {candidates.map((candidate) => (
            <option key={candidate.element.id} value={candidate.element.id}>
              {candidate.trackName} · {candidate.element.name}
            </option>
          ))}
        </select>
      </div>

      {!trackingCurrentVideo && selectedSource && sourceTracking?.version === 3 && (
        <div className="object-lock-controls">
          <button
            type="button"
            className="object-lock-clear"
            onClick={() =>
              update(
                buildFollowerTracking(
                  selectedSource.element,
                  selectedSource.trackId,
                  sourceTracking
                )
              )
            }
          >
            使用视频已有轨迹
          </button>
        </div>
      )}

      {settings && (
        <div className="object-lock-controls">
          {trackingCurrentVideo ? (
            <>
              <div className="object-lock-control-row">
                <label>视频画面</label>
                <div className="object-lock-segments">
                  <button
                    type="button"
                    className={!settings.subjectCenter ? 'active' : ''}
                    onClick={() => patchSettings({ subjectCenter: false })}
                  >
                    保持原画面
                  </button>
                  <button
                    type="button"
                    className={settings.subjectCenter ? 'active' : ''}
                    onClick={() => patchSettings({ subjectCenter: true })}
                  >
                    主体居中
                  </button>
                </div>
                {settings.subjectCenter && (
                  <p className="text-xs text-muted-foreground">
                    画面随主体移动。如露出边缘，可在“画面”中适当放大。
                  </p>
                )}
              </div>
              <div className="object-lock-control-row">
                <label htmlFor={`tracking-follower-${element.id}`}>跟随素材</label>
                <select
                  id={`tracking-follower-${element.id}`}
                  value={selectedFollower?.element.id ?? ''}
                  disabled={!selectedFollower}
                  onChange={(event) => setFollowerId(event.target.value)}
                >
                  {!followers.length && <option value="">暂无时间重叠的上层素材</option>}
                  {followers.map((candidate) => (
                    <option key={candidate.element.id} value={candidate.element.id}>
                      {candidate.trackName} · {candidate.element.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="object-lock-clear"
                  disabled={!selectedFollower}
                  onClick={bindFollower}
                >
                  绑定跟随素材
                </button>
                <button type="button" className="object-lock-clear" onClick={addFollowingText}>
                  添加跟随文字
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="object-lock-control-row">
                <label>跟随方式</label>
                <div className="object-lock-segments">
                  <button
                    type="button"
                    className={settings.mode === 'position' ? 'active' : ''}
                    onClick={() => setMode('position')}
                  >
                    仅位置
                  </button>
                  <button
                    type="button"
                    className={settings.mode === 'position-scale' ? 'active' : ''}
                    onClick={() => setMode('position-scale')}
                  >
                    位置和大小
                  </button>
                </div>
              </div>
              <div className="object-lock-control-row">
                <label>跟随位置</label>
                <div className="object-lock-segments">
                  <button
                    type="button"
                    className={settings.anchor === 'current' ? 'active' : ''}
                    onClick={() => setAnchor('current')}
                  >
                    保持相对位置
                  </button>
                  <button
                    type="button"
                    className={settings.anchor === 'center' ? 'active' : ''}
                    onClick={() => setAnchor('center')}
                  >
                    贴合目标中心
                  </button>
                </div>
              </div>
            </>
          )}
          <label className="object-lock-slider">
            <span>平滑度</span>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.smoothing}
              onChange={(event) => patchSettings({ smoothing: Number(event.target.value) }, false)}
              onPointerUp={() => patchSettings({ smoothing: settings.smoothing })}
            />
            <output>{Math.round(settings.smoothing)}</output>
          </label>
          {!trackingCurrentVideo && settings.mode === 'position-scale' && (
            <label className="object-lock-slider">
              <span>最大缩放</span>
              <input
                type="range"
                min="1"
                max="2"
                step="0.05"
                value={settings.maxScale}
                onChange={(event) => patchSettings({ maxScale: Number(event.target.value) }, false)}
                onPointerUp={() => patchSettings({ maxScale: settings.maxScale })}
              />
              <output>{settings.maxScale.toFixed(2)}x</output>
            </label>
          )}
          <button
            type="button"
            className="object-lock-clear"
            title="清除运动跟踪"
            onClick={() => update(undefined)}
          >
            <Trash2 />
            清除跟踪
          </button>
        </div>
      )}

      {!settings && (
        <div className="object-lock-empty">
          <Crosshair />
          <span className="px-4 text-center">
            {trackingCurrentVideo
              ? '直接框选当前视频中的目标，完成后可绑定跟随素材或开启主体居中'
              : selectedSource
                ? '选择下层视频中的目标'
                : '请在当前素材下方添加视频，并让两个片段的时间重叠'}
          </span>
        </div>
      )}

      {open && selectedSource && (
        <TrackingTargetDialog
          editor={editor}
          followerElement={element}
          sourceElement={selectedSource.element}
          sourceTrackId={selectedSource.trackId}
          sourceTrackName={selectedSource.trackName}
          sourceAsset={selectedSource.asset}
          current={settings}
          onClose={() => setOpen(false)}
          onComplete={(next) => {
            update(next)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
