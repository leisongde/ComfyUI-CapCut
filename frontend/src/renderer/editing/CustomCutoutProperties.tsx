import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ALL_FORMATS, BlobSource, CanvasSink, Input, type WrappedCanvas } from 'mediabunny'
import {
  Brush,
  Blend,
  Check,
  CircleMinus,
  CirclePlus,
  Eraser,
  LoaderCircle,
  MoveHorizontal,
  ScanSearch,
  Redo2,
  RotateCcw,
  Undo2,
  X
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useEditor } from '@/hooks/use-editor'
import { getVisualSourceTime } from '@/lib/timeline/element-utils'
import { CanvasRenderer } from '@/services/renderer/canvas-renderer'
import { buildScene } from '@/services/renderer/scene-builder'
import type { TBackground, TCanvasSize } from '@/types/project'
import type { ImageElement, TimelineTrack, VideoElement } from '@/types/timeline'
import type { MediaAsset } from '@/types/assets'
import type {
  EditingCustomCutoutRuntimeStatus,
  EditingCustomCutoutSegmentResult
} from '../../shared/editing'
import {
  getCustomCutoutStatus,
  endCustomCutoutTracking,
  prewarmCustomCutout,
  readCustomCutoutMask,
  removeCustomCutoutRevision,
  saveCustomCutoutMask,
  saveCustomCutoutMasks,
  segmentCustomCutout,
  startCustomCutoutTracking,
  trackCustomCutoutFrame
} from './custom-cutout-api'
import {
  expandCustomCutoutMask,
  findCustomCutoutKeyframe,
  normalizeCustomCutout,
  type CustomCutoutSettings,
  type CustomCutoutStroke
} from './custom-cutout'
import { resolveVisualState } from './visual-keyframes'

export type CustomCutoutField = 'customCutout' | 'colorAdjustmentCustomMask'
type CustomCutoutElement = (VideoElement | ImageElement) & {
  customCutout?: unknown
  colorAdjustmentCustomMask?: unknown
}
type Tool = 'keep' | 'erase'
type PreviewMode = 'effect' | 'overlay' | 'original' | 'mask'

const INTERACTIVE_MAX_EDGE = 800
const TRACKING_MAX_EDGE = 640
const TRACKING_MAX_FPS = 12
const BACKWARD_DECODE_CHUNK = 36
const MASK_SAVE_BATCH = 12
const CUTOUT_HISTORY_LIMIT = 30

interface CapturedFrame {
  rgba: Uint8Array
  width: number
  height: number
  sourceTime: number
  sourceFrame: number
}

interface CutoutHistorySnapshot {
  strokes: CustomCutoutStroke[]
  mask: Uint8Array | null
}

const cloneStrokes = (strokes: CustomCutoutStroke[]): CustomCutoutStroke[] =>
  strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point }))
  }))

const snapshotEffect = (
  strokes: CustomCutoutStroke[],
  mask: Uint8Array | null
): CutoutHistorySnapshot => ({
  strokes: cloneStrokes(strokes),
  mask: mask ? new Uint8Array(mask) : null
})

const appendHistory = (
  history: CutoutHistorySnapshot[],
  snapshot: CutoutHistorySnapshot
): CutoutHistorySnapshot[] => [...history.slice(-(CUTOUT_HISTORY_LIMIT - 1)), snapshot]

interface TimelineCompositeFrame {
  below: Uint8Array
  above: Uint8Array
  width: number
  height: number
  projectWidth: number
  projectHeight: number
  fitWidth: number
  fitHeight: number
  timelineTime: number
}

interface VisualPlacement {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  rotate: number
  flipX: boolean
  flipY: boolean
  opacity: number
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

const proxySize = (
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } => {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(16, Math.round(width * scale)),
    height: Math.max(16, Math.round(height * scale))
  }
}

const rgbaFromWrappedCanvas = (frame: WrappedCanvas): Uint8Array => {
  const context = frame.canvas.getContext('2d', { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) throw new Error('无法读取视频解码画面')
  return new Uint8Array(context.getImageData(0, 0, frame.canvas.width, frame.canvas.height).data)
}

const waitFor = (target: EventTarget, name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const done = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new Error('素材画面读取失败'))
    }
    const cleanup = () => {
      target.removeEventListener(name, done)
      target.removeEventListener('error', failed)
    }
    target.addEventListener(name, done, { once: true })
    target.addEventListener('error', failed, { once: true })
  })

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
  const [duration] = await Promise.all([input.computeDuration(), videoTrack.getDecoderConfig()])
  const sink = new CanvasSink(videoTrack, { width, height, fit: 'fill', poolSize: 3 })

  return {
    duration,
    async readOne(sourceTime: number) {
      const target = Math.max(0, Math.min(Math.max(0, duration - 0.001), sourceTime))
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

function resizeGrayMask(
  bytes: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number
): Uint8Array {
  if (bytes.byteLength !== sourceWidth * sourceHeight) throw new Error('种子蒙版尺寸无效')
  if (sourceWidth === width && sourceHeight === height) return new Uint8Array(bytes)
  const source = document.createElement('canvas')
  source.width = sourceWidth
  source.height = sourceHeight
  const sourceContext = source.getContext('2d')
  const target = document.createElement('canvas')
  target.width = width
  target.height = height
  const targetContext = target.getContext('2d', { willReadFrequently: true })
  if (!sourceContext || !targetContext) throw new Error('无法缩放视频跟踪蒙版')
  const rgba = new Uint8ClampedArray(bytes.byteLength * 4)
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const offset = index * 4
    rgba[offset] = bytes[index]
    rgba[offset + 1] = bytes[index]
    rgba[offset + 2] = bytes[index]
    rgba[offset + 3] = 255
  }
  sourceContext.putImageData(new ImageData(rgba, sourceWidth, sourceHeight), 0, 0)
  targetContext.imageSmoothingEnabled = true
  targetContext.imageSmoothingQuality = 'high'
  targetContext.drawImage(source, 0, 0, width, height)
  const scaled = targetContext.getImageData(0, 0, width, height).data
  const result = new Uint8Array(width * height)
  for (let index = 0; index < result.length; index += 1) result[index] = scaled[index * 4]
  return result
}

async function captureAssetFrame(
  asset: MediaAsset,
  element: CustomCutoutElement,
  timelineTime: number,
  projectFps: number
): Promise<CapturedFrame> {
  const createdUrl = !asset.url
  const url = asset.url ?? URL.createObjectURL(asset.file)
  let source: HTMLImageElement | HTMLVideoElement
  let sourceWidth = 0
  let sourceHeight = 0
  let sourceTime = 0
  try {
    if (element.type === 'video') {
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.preload = 'auto'
      video.muted = true
      video.src = url
      await waitFor(video, 'loadedmetadata')
      sourceTime = getVisualSourceTime({
        timelineTime,
        startTime: element.startTime,
        duration: element.duration,
        trimStart: element.trimStart,
        playbackRate: element.playbackRate,
        reversed: element.reversed
      })
      sourceTime = Math.max(0, Math.min(Math.max(0, video.duration - 0.001), sourceTime))
      if (Math.abs(video.currentTime - sourceTime) > 0.0005) {
        video.currentTime = sourceTime
        await waitFor(video, 'seeked')
      } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await waitFor(video, 'loadeddata')
      }
      sourceWidth = video.videoWidth
      sourceHeight = video.videoHeight
      source = video
    } else {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.src = url
      if (!image.complete) await waitFor(image, 'load')
      else if (!image.naturalWidth) throw new Error('图片素材无法读取')
      sourceWidth = image.naturalWidth
      sourceHeight = image.naturalHeight
      source = image
    }
    if (!sourceWidth || !sourceHeight) throw new Error('素材画面尺寸无效')
    const { width, height } = proxySize(sourceWidth, sourceHeight, INTERACTIVE_MAX_EDGE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法读取当前素材画面')
    context.drawImage(source, 0, 0, width, height)
    const rgba = new Uint8Array(context.getImageData(0, 0, width, height).data)
    const fps = asset.fps && asset.fps > 0 ? asset.fps : projectFps
    return {
      rgba,
      width,
      height,
      sourceTime,
      sourceFrame: Math.max(0, Math.round(sourceTime * fps))
    }
  } finally {
    if (createdUrl) URL.revokeObjectURL(url)
  }
}

function removeElementFromTrack(track: TimelineTrack, elementId: string): TimelineTrack {
  const elements = track.elements.filter((item) => item.id !== elementId)
  if (track.type !== 'video') return { ...track, elements } as TimelineTrack
  return {
    ...track,
    elements,
    transitions: (track.transitions ?? []).filter(
      (transition) => transition.fromElementId !== elementId && transition.toElementId !== elementId
    )
  } as TimelineTrack
}

function splitTimelineLayers(
  tracks: TimelineTrack[],
  trackId: string,
  elementId: string
): { below: TimelineTrack[]; above: TimelineTrack[] } {
  const orderedTopToBottom = [
    ...tracks.filter((track) => !('isMain' in track && track.isMain)),
    ...tracks.filter((track) => 'isMain' in track && track.isMain)
  ]
  const selectedIndex = orderedTopToBottom.findIndex((track) => track.id === trackId)
  if (selectedIndex < 0) {
    return {
      below: tracks.map((track) => removeElementFromTrack(track, elementId)),
      above: []
    }
  }
  return {
    below: [
      removeElementFromTrack(orderedTopToBottom[selectedIndex], elementId),
      ...orderedTopToBottom.slice(selectedIndex + 1)
    ],
    above: orderedTopToBottom.slice(0, selectedIndex)
  }
}

async function renderTimelineLayer(input: {
  tracks: TimelineTrack[]
  mediaAssets: MediaAsset[]
  duration: number
  canvasSize: TCanvasSize
  fitCanvasSize: TCanvasSize
  background: TBackground
  timelineTime: number
  outputSize: TCanvasSize
  fps: number
}): Promise<Uint8Array> {
  const scene = buildScene({
    tracks: input.tracks,
    mediaAssets: input.mediaAssets,
    duration: input.duration,
    canvasSize: input.canvasSize,
    fitCanvasSize: input.fitCanvasSize,
    background: input.background
  })
  const renderer = new CanvasRenderer({
    width: input.canvasSize.width,
    height: input.canvasSize.height,
    fps: input.fps,
    imageSmoothingQuality: 'high'
  })
  renderer.context.clearRect(0, 0, input.canvasSize.width, input.canvasSize.height)
  await scene.render({ renderer, time: input.timelineTime })

  const output = document.createElement('canvas')
  output.width = input.outputSize.width
  output.height = input.outputSize.height
  const context = output.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建抠像合成预览')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(renderer.canvas, 0, 0, output.width, output.height)
  return new Uint8Array(context.getImageData(0, 0, output.width, output.height).data)
}

async function captureTimelineComposite(
  editor: ReturnType<typeof useEditor>,
  trackId: string,
  elementId: string,
  timelineTime: number
): Promise<TimelineCompositeFrame> {
  const project = editor.project.getActive()
  const canvasSize = project.settings.canvasSize
  const fitCanvasSize = project.settings.originalCanvasSize ?? canvasSize
  const outputSize = proxySize(canvasSize.width, canvasSize.height, INTERACTIVE_MAX_EDGE)
  const layers = splitTimelineLayers(editor.timeline.getTracks(), trackId, elementId)
  const common = {
    mediaAssets: editor.media.getAssets(),
    duration: editor.timeline.getTotalDuration(),
    canvasSize,
    fitCanvasSize,
    timelineTime,
    outputSize,
    fps: project.settings.fps
  }
  const below = await renderTimelineLayer({
    ...common,
    tracks: layers.below,
    background: project.settings.background
  })
  const above = await renderTimelineLayer({
    ...common,
    tracks: layers.above,
    background: { type: 'color', color: 'transparent' }
  })
  return {
    below,
    above,
    width: outputSize.width,
    height: outputSize.height,
    projectWidth: canvasSize.width,
    projectHeight: canvasSize.height,
    fitWidth: fitCanvasSize.width,
    fitHeight: fitCanvasSize.height,
    timelineTime
  }
}

function getVisualPlacement(
  frame: CapturedFrame,
  composite: TimelineCompositeFrame,
  element: CustomCutoutElement
): VisualPlacement {
  const visual = resolveVisualState({ source: element, timelineTime: composite.timelineTime })
  const projectScaleX = composite.width / composite.projectWidth
  const projectScaleY = composite.height / composite.projectHeight
  const containScale = Math.min(
    composite.fitWidth / frame.width,
    composite.fitHeight / frame.height
  )
  const width = frame.width * containScale * visual.transform.scale * projectScaleX
  const height = frame.height * containScale * visual.transform.scale * projectScaleY
  const x = composite.width / 2 + visual.transform.position.x * projectScaleX - width / 2
  const y = composite.height / 2 + visual.transform.position.y * projectScaleY - height / 2
  return {
    x,
    y,
    width,
    height,
    centerX: x + width / 2,
    centerY: y + height / 2,
    rotate: visual.transform.rotate,
    flipX: Boolean(visual.transform.flipX),
    flipY: Boolean(visual.transform.flipY),
    opacity: visual.opacity
  }
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: CustomCutoutStroke,
  width: number,
  height: number,
  brushSize: number
): void {
  if (!stroke.points.length) return
  context.save()
  context.strokeStyle = stroke.positive ? '#22c55e' : '#f43f5e'
  context.fillStyle = context.strokeStyle
  context.globalAlpha = 0.88
  context.lineWidth = brushSize
  context.lineCap = 'round'
  context.lineJoin = 'round'
  const first = stroke.points[0]
  context.beginPath()
  context.moveTo(first.x * width, first.y * height)
  for (const point of stroke.points.slice(1)) context.lineTo(point.x * width, point.y * height)
  context.stroke()
  if (stroke.points.length === 1) {
    context.beginPath()
    context.arc(first.x * width, first.y * height, brushSize / 2, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

function CutoutCanvas({
  frame,
  composite,
  element,
  mask,
  strokes,
  draftStroke,
  brushSize,
  previewMode,
  positive,
  expand,
  feather,
  invert,
  disabled,
  onStroke
}: {
  frame: CapturedFrame
  composite: TimelineCompositeFrame | null
  element: CustomCutoutElement
  mask: Uint8Array | null
  strokes: CustomCutoutStroke[]
  draftStroke: CustomCutoutStroke | null
  brushSize: number
  previewMode: PreviewMode
  positive: boolean
  expand: number
  feather: number
  invert: boolean
  disabled: boolean
  onStroke(stroke: CustomCutoutStroke | null, finished: boolean): void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef<CustomCutoutStroke | null>(null)
  const visibleMask = useMemo(() => {
    if (!mask) return null
    const processed = expandCustomCutoutMask(mask, frame.width, frame.height, expand)
    if (!invert) return processed
    for (let index = 0; index < processed.length; index += 1)
      processed[index] = 255 - processed[index]
    return processed
  }, [mask, frame.width, frame.height, expand, invert])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const image = new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height)
    if (previewMode === 'effect') {
      canvas.width = composite?.width ?? frame.width
      canvas.height = composite?.height ?? frame.height
      context.clearRect(0, 0, canvas.width, canvas.height)

      const drawRgba = (rgba: Uint8Array, width: number, height: number) => {
        const layer = document.createElement('canvas')
        layer.width = width
        layer.height = height
        layer
          .getContext('2d')
          ?.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
        context.drawImage(layer, 0, 0, canvas.width, canvas.height)
      }
      if (composite) drawRgba(composite.below, composite.width, composite.height)

      const source = document.createElement('canvas')
      source.width = frame.width
      source.height = frame.height
      const sourceContext = source.getContext('2d')
      if (!sourceContext) return
      sourceContext.putImageData(image, 0, 0)

      const placement = composite ? getVisualPlacement(frame, composite, element) : null
      if (visibleMask) {
        const maskPixels = new Uint8ClampedArray(visibleMask.byteLength * 4)
        for (let index = 0; index < visibleMask.byteLength; index += 1) {
          const offset = index * 4
          maskPixels[offset] = 255
          maskPixels[offset + 1] = 255
          maskPixels[offset + 2] = 255
          maskPixels[offset + 3] = visibleMask[index]
        }
        const maskCanvas = document.createElement('canvas')
        maskCanvas.width = frame.width
        maskCanvas.height = frame.height
        maskCanvas
          .getContext('2d')
          ?.putImageData(new ImageData(maskPixels, frame.width, frame.height), 0, 0)

        let alphaSource: CanvasImageSource = maskCanvas
        if (feather > 0) {
          const feathered = document.createElement('canvas')
          feathered.width = frame.width
          feathered.height = frame.height
          const featherContext = feathered.getContext('2d')
          if (featherContext) {
            const renderedScale = placement ? Math.max(placement.width / frame.width, 0.001) : 1
            featherContext.filter = `blur(${feather / renderedScale}px)`
            featherContext.drawImage(maskCanvas, 0, 0)
            alphaSource = feathered
          }
        }
        sourceContext.save()
        sourceContext.globalCompositeOperation = 'destination-in'
        sourceContext.drawImage(alphaSource, 0, 0)
        sourceContext.restore()
      }
      if (draftStroke) drawStroke(sourceContext, draftStroke, frame.width, frame.height, brushSize)

      if (placement) {
        context.save()
        context.globalAlpha = placement.opacity
        context.translate(placement.centerX, placement.centerY)
        if (placement.rotate) context.rotate((placement.rotate * Math.PI) / 180)
        if (placement.flipX || placement.flipY)
          context.scale(placement.flipX ? -1 : 1, placement.flipY ? -1 : 1)
        context.translate(-placement.centerX, -placement.centerY)
        context.drawImage(source, placement.x, placement.y, placement.width, placement.height)
        context.restore()
      } else {
        context.drawImage(source, 0, 0)
      }
      if (composite) drawRgba(composite.above, composite.width, composite.height)
      return
    }

    canvas.width = frame.width
    canvas.height = frame.height
    context.clearRect(0, 0, frame.width, frame.height)
    if (previewMode !== 'mask') context.putImageData(image, 0, 0)
    else {
      context.fillStyle = '#111'
      context.fillRect(0, 0, frame.width, frame.height)
    }
    if (visibleMask && previewMode !== 'original') {
      const pixels = new Uint8ClampedArray(visibleMask.byteLength * 4)
      for (let index = 0; index < visibleMask.byteLength; index += 1) {
        const offset = index * 4
        if (previewMode === 'mask') {
          pixels[offset] = visibleMask[index]
          pixels[offset + 1] = visibleMask[index]
          pixels[offset + 2] = visibleMask[index]
          pixels[offset + 3] = 255
        } else {
          pixels[offset] = 16
          pixels[offset + 1] = 220
          pixels[offset + 2] = 145
          pixels[offset + 3] = previewMode === 'overlay' ? Math.round(visibleMask[index] * 0.38) : 0
        }
      }
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = frame.width
      maskCanvas.height = frame.height
      maskCanvas
        .getContext('2d')
        ?.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0)
      context.save()
      context.filter = feather > 0 ? `blur(${feather}px)` : 'none'
      context.drawImage(maskCanvas, 0, 0)
      context.restore()
    }
    if (previewMode !== 'original') {
      for (const stroke of strokes)
        drawStroke(context, stroke, frame.width, frame.height, brushSize)
      if (draftStroke) drawStroke(context, draftStroke, frame.width, frame.height, brushSize)
    }
  }, [
    frame,
    composite,
    element,
    visibleMask,
    strokes,
    draftStroke,
    brushSize,
    previewMode,
    feather
  ])

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>, requireInside = false) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const canvasX = ((event.clientX - bounds.left) / bounds.width) * event.currentTarget.width
    const canvasY = ((event.clientY - bounds.top) / bounds.height) * event.currentTarget.height
    if (previewMode === 'effect' && composite) {
      const placement = getVisualPlacement(frame, composite, element)
      const radians = (-placement.rotate * Math.PI) / 180
      const offsetX = canvasX - placement.centerX
      const offsetY = canvasY - placement.centerY
      let localX = offsetX * Math.cos(radians) - offsetY * Math.sin(radians)
      let localY = offsetX * Math.sin(radians) + offsetY * Math.cos(radians)
      if (placement.flipX) localX *= -1
      if (placement.flipY) localY *= -1
      const x = (localX + placement.width / 2) / placement.width
      const y = (localY + placement.height / 2) / placement.height
      if (requireInside && (x < 0 || x > 1 || y < 0 || y > 1)) return null
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y))
      }
    }
    return {
      x: Math.max(0, Math.min(1, canvasX / event.currentTarget.width)),
      y: Math.max(0, Math.min(1, canvasY / event.currentTarget.height))
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="custom-cutout-canvas"
      aria-label="自定义抠像画布"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (disabled || previewMode === 'original') return
        const point = pointFromEvent(event, true)
        if (!point) return
        event.currentTarget.setPointerCapture(event.pointerId)
        const stroke = { positive, points: [point] }
        activeRef.current = stroke
        onStroke(stroke, false)
      }}
      onPointerMove={(event) => {
        const active = activeRef.current
        if (!active || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        const point = pointFromEvent(event)
        if (!point) return
        const previous = active.points.at(-1)!
        const distance = Math.hypot(
          (point.x - previous.x) * frame.width,
          (point.y - previous.y) * frame.height
        )
        if (distance < Math.max(4, brushSize * 0.35)) return
        const next = { ...active, points: [...active.points, point] }
        activeRef.current = next
        onStroke(next, false)
      }}
      onPointerUp={(event) => {
        const active = activeRef.current
        if (!active) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        activeRef.current = null
        onStroke(active, true)
      }}
      onPointerCancel={() => {
        activeRef.current = null
        onStroke(null, false)
      }}
    />
  )
}

function CustomCutoutEditor({
  editor,
  element,
  trackId,
  settings,
  asset,
  field,
  title,
  onClose
}: {
  editor: ReturnType<typeof useEditor>
  element: CustomCutoutElement
  trackId: string
  settings: CustomCutoutSettings
  asset: MediaAsset
  field: CustomCutoutField
  title: string
  onClose(): void
}) {
  const [frame, setFrame] = useState<CapturedFrame | null>(null)
  const [composite, setComposite] = useState<TimelineCompositeFrame | null>(null)
  const [mask, setMask] = useState<Uint8Array | null>(null)
  const [strokes, setStrokes] = useState<CustomCutoutStroke[]>([])
  const [undoHistory, setUndoHistory] = useState<CutoutHistorySnapshot[]>([])
  const [redoHistory, setRedoHistory] = useState<CutoutHistorySnapshot[]>([])
  const [draftStroke, setDraftStroke] = useState<CustomCutoutStroke | null>(null)
  const [tool, setTool] = useState<Tool>('keep')
  const [brushSize, setBrushSize] = useState(28)
  const [expand, setExpand] = useState(settings.expand)
  const [feather, setFeather] = useState(settings.feather)
  const [invert, setInvert] = useState(settings.invert)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('effect')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [trackingProgress, setTrackingProgress] = useState({ current: 0, total: 0 })
  const [propagatedKeyframes, setPropagatedKeyframes] = useState<CustomCutoutSettings['keyframes']>(
    []
  )
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [runtime, setRuntime] = useState<EditingCustomCutoutRuntimeStatus | null>(null)
  const inferenceSequence = useRef(0)
  const trackingCancellation = useRef<{ cancelled: boolean } | null>(null)
  const trackingSession = useRef<string | null>(null)
  const pendingFiles = useRef(false)
  const committed = useRef(false)
  const pendingRevision = settings.revision + 1
  const storageElementId =
    field === 'customCutout' ? element.id : `${element.id}-color-adjustment-mask`

  useEffect(() => {
    let disposed = false
    const timelineTime = editor.playback.getCurrentTime()
    const fps = editor.project.getActive().settings.fps
    void prewarmCustomCutout(false)
      .then((status) => {
        if (!disposed) setRuntime(status)
      })
      .catch(() => {
        void getCustomCutoutStatus().then((status) => {
          if (!disposed) setRuntime(status)
        })
      })
    void captureAssetFrame(asset, element, timelineTime, fps)
      .then(async (captured) => {
        if (disposed) return
        setFrame(captured)
        const existing = findCustomCutoutKeyframe(settings.keyframes, captured.sourceTime)
        if (existing) {
          setStrokes(existing.strokes)
          const stored = await readCustomCutoutMask(existing.maskRef)
          if (!disposed && stored)
            setMask(
              resizeGrayMask(
                stored,
                existing.width,
                existing.height,
                captured.width,
                captured.height
              )
            )
        }
      })
      .catch((failure) => {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    void captureTimelineComposite(editor, trackId, element.id, timelineTime)
      .then((captured) => {
        if (!disposed) setComposite(captured)
      })
      .catch((failure) => {
        console.warn('读取自定义抠像时间线合成预览失败', failure)
      })
    return () => {
      disposed = true
      inferenceSequence.current += 1
    }
  }, [])

  useEffect(() => {
    return () => {
      trackingCancellation.current && (trackingCancellation.current.cancelled = true)
      if (trackingSession.current) void endCustomCutoutTracking(trackingSession.current)
      if (pendingFiles.current && !committed.current)
        void removeCustomCutoutRevision(storageElementId, pendingRevision)
    }
  }, [])

  useEffect(() => {
    if (!processing && !tracking) return
    let disposed = false
    const update = () =>
      void getCustomCutoutStatus().then((status) => {
        if (!disposed) setRuntime(status)
      })
    update()
    const timer = setInterval(update, 500)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [processing, tracking])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !applying) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [applying, onClose])

  const infer = async (nextStrokes: CustomCutoutStroke[]) => {
    if (propagatedKeyframes.length) {
      setPropagatedKeyframes([])
      pendingFiles.current = false
      void removeCustomCutoutRevision(storageElementId, pendingRevision)
    }
    if (!frame || !nextStrokes.length) {
      setMask(null)
      return
    }
    const sequence = ++inferenceSequence.current
    setProcessing(true)
    setError('')
    try {
      const result: EditingCustomCutoutSegmentResult = await segmentCustomCutout({
        rgba: new Uint8Array(frame.rgba),
        width: frame.width,
        height: frame.height,
        strokes: nextStrokes
      })
      if (sequence === inferenceSequence.current) setMask(result.bytes)
    } catch (failure) {
      if (sequence === inferenceSequence.current)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (sequence === inferenceSequence.current) setProcessing(false)
    }
  }

  const trackVideo = async () => {
    if (element.type !== 'video' || !frame || !mask || processing || tracking) return
    const cancellation = { cancelled: false }
    trackingCancellation.current = cancellation
    setTracking(true)
    setTrackingProgress({ current: 0, total: 0 })
    setError('')
    setPropagatedKeyframes([])
    if (pendingFiles.current) {
      pendingFiles.current = false
      await removeCustomCutoutRevision(storageElementId, pendingRevision).catch(() => {})
    }

    let reader: VideoFrameReader | null = null
    const tracked: CustomCutoutSettings['keyframes'] = []
    try {
      const trackingSize = proxySize(frame.width, frame.height, TRACKING_MAX_EDGE)
      reader = await openVideoFrameReader(asset, trackingSize.width, trackingSize.height)
      const projectFps = editor.project.getActive().settings.fps
      const trackingFps = Math.max(
        1,
        Math.min(TRACKING_MAX_FPS, asset.fps && asset.fps > 0 ? asset.fps : projectFps)
      )
      const rate = element.playbackRate ?? 1
      const rangeStartTime = Math.max(0, element.trimStart)
      const rangeEndTime = Math.min(reader.duration, element.trimStart + element.duration * rate)
      const startFrame = Math.max(0, Math.ceil(rangeStartTime * trackingFps - 1e-6))
      const endFrame = Math.max(
        startFrame,
        Math.floor(Math.max(rangeStartTime, rangeEndTime - 0.001) * trackingFps)
      )
      const seedFrame = Math.max(
        startFrame,
        Math.min(endFrame, Math.round(frame.sourceTime * trackingFps))
      )
      const total = Math.max(0, endFrame - startFrame)
      setTrackingProgress({ current: 0, total })
      const seedRgba = await reader.readOne(seedFrame / trackingFps)
      const seedMask = resizeGrayMask(
        mask,
        frame.width,
        frame.height,
        trackingSize.width,
        trackingSize.height
      )

      const seedSaved = await saveCustomCutoutMask({
        elementId: storageElementId,
        revision: pendingRevision,
        sourceFrame: seedFrame,
        width: trackingSize.width,
        height: trackingSize.height,
        bytes: new Uint8Array(seedMask)
      })
      pendingFiles.current = true
      tracked.push({
        sourceFrame: seedFrame,
        sourceTime: seedFrame / trackingFps,
        width: trackingSize.width,
        height: trackingSize.height,
        strokes,
        maskRef: seedSaved.maskRef
      })

      let completed = 0
      const pendingMasks: Array<{
        sourceFrame: number
        sourceTime: number
        width: number
        height: number
        bytes: Uint8Array
      }> = []
      const flushMasks = async () => {
        if (!pendingMasks.length) return
        const batch = pendingMasks.splice(0, pendingMasks.length)
        const saved = await saveCustomCutoutMasks(
          batch.map((item) => ({
            elementId: storageElementId,
            revision: pendingRevision,
            sourceFrame: item.sourceFrame,
            width: item.width,
            height: item.height,
            bytes: item.bytes
          }))
        )
        pendingFiles.current = true
        for (let index = 0; index < batch.length; index += 1) {
          const item = batch[index]
          tracked.push({
            sourceFrame: item.sourceFrame,
            sourceTime: item.sourceTime,
            width: item.width,
            height: item.height,
            strokes: [],
            maskRef: saved[index].maskRef
          })
        }
      }

      const processDecodedFrame = async (sourceFrame: number, rgba: Uint8Array) => {
        const result = await trackCustomCutoutFrame({
          sessionId: trackingSession.current!,
          rgba,
          width: trackingSize.width,
          height: trackingSize.height
        })
        pendingMasks.push({
          sourceFrame,
          sourceTime: sourceFrame / trackingFps,
          width: trackingSize.width,
          height: trackingSize.height,
          bytes: result.bytes
        })
        if (pendingMasks.length >= MASK_SAVE_BATCH) await flushMasks()
        completed += 1
        setTrackingProgress({ current: completed, total })
      }

      const runDirection = async (indices: number[]) => {
        if (!indices.length || cancellation.cancelled) return
        const session = await startCustomCutoutTracking({
          rgba: new Uint8Array(seedRgba),
          mask: new Uint8Array(seedMask),
          width: trackingSize.width,
          height: trackingSize.height
        })
        trackingSession.current = session.sessionId
        try {
          if (indices[0] < indices.at(-1)!) {
            for await (const decoded of reader!.readFrames(indices, trackingFps)) {
              if (cancellation.cancelled) break
              await processDecodedFrame(decoded.sourceFrame, decoded.rgba)
            }
          } else {
            for (let offset = 0; offset < indices.length; offset += BACKWARD_DECODE_CHUNK) {
              if (cancellation.cancelled) break
              const processingOrder = indices.slice(offset, offset + BACKWARD_DECODE_CHUNK)
              const decodeOrder = [...processingOrder].sort((a, b) => a - b)
              const decodedFrames = new Map<number, Uint8Array>()
              for await (const decoded of reader!.readFrames(decodeOrder, trackingFps))
                decodedFrames.set(decoded.sourceFrame, decoded.rgba)
              for (const sourceFrame of processingOrder) {
                if (cancellation.cancelled) break
                const rgba = decodedFrames.get(sourceFrame)
                if (!rgba) throw new Error(`无法读取视频第 ${sourceFrame} 帧`)
                await processDecodedFrame(sourceFrame, rgba)
              }
            }
          }
        } finally {
          await endCustomCutoutTracking(session.sessionId).catch(() => {})
          if (trackingSession.current === session.sessionId) trackingSession.current = null
        }
      }

      await runDirection(
        Array.from({ length: endFrame - seedFrame }, (_, index) => seedFrame + index + 1)
      )
      await runDirection(
        Array.from({ length: seedFrame - startFrame }, (_, index) => seedFrame - index - 1)
      )
      await flushMasks()
      if (cancellation.cancelled) {
        pendingFiles.current = false
        await removeCustomCutoutRevision(storageElementId, pendingRevision).catch(() => {})
        return
      }
      tracked.sort((a, b) => a.sourceTime - b.sourceTime)
      setPropagatedKeyframes(tracked)
    } catch (failure) {
      pendingFiles.current = false
      await removeCustomCutoutRevision(storageElementId, pendingRevision).catch(() => {})
      if (!cancellation.cancelled)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      reader?.close()
      trackingCancellation.current = null
      setTracking(false)
    }
  }

  const finishStroke = (stroke: CustomCutoutStroke | null, finished: boolean) => {
    if (!stroke) {
      setDraftStroke(null)
      return
    }
    const adjusted = { ...stroke, positive: tool === 'keep' }
    if (!finished) {
      setDraftStroke(adjusted)
      return
    }
    setDraftStroke(null)
    const next = [...strokes, adjusted]
    const previous = snapshotEffect(strokes, mask)
    setUndoHistory((history) => appendHistory(history, previous))
    setRedoHistory([])
    setStrokes(next)
    void infer(next)
  }

  const restoreEffect = (snapshot: CutoutHistorySnapshot) => {
    inferenceSequence.current += 1
    setDraftStroke(null)
    setStrokes(cloneStrokes(snapshot.strokes))
    setMask(snapshot.mask ? new Uint8Array(snapshot.mask) : null)
    setProcessing(false)
    setError('')
    if (propagatedKeyframes.length) {
      setPropagatedKeyframes([])
      pendingFiles.current = false
      void removeCustomCutoutRevision(storageElementId, pendingRevision)
    }
  }

  const undo = () => {
    if (!undoHistory.length || processing || tracking) return
    const previous = undoHistory.at(-1)!
    setUndoHistory((history) => history.slice(0, -1))
    setRedoHistory((history) => appendHistory(history, snapshotEffect(strokes, mask)))
    restoreEffect(previous)
  }

  const redoStroke = () => {
    if (!redoHistory.length || processing || tracking) return
    const restored = redoHistory.at(-1)!
    setRedoHistory((history) => history.slice(0, -1))
    setUndoHistory((history) => appendHistory(history, snapshotEffect(strokes, mask)))
    restoreEffect(restored)
  }

  const apply = async () => {
    if (!frame || processing || tracking || (!mask && !settings.keyframes.length)) return
    setApplying(true)
    setError('')
    try {
      if (!mask) {
        const cleared: CustomCutoutSettings = {
          ...settings,
          enabled: false,
          expand,
          feather,
          invert,
          keyframes: []
        }
        editor.timeline.updateElements({
          updates: [{ trackId, elementId: element.id, updates: { [field]: cleared } }],
          pushHistory: true
        })
        committed.current = true
        onClose()
        return
      }
      const revision = pendingRevision
      let keyframes = propagatedKeyframes
      if (!keyframes.length) {
        const saved = await saveCustomCutoutMask({
          elementId: storageElementId,
          revision,
          sourceFrame: frame.sourceFrame,
          width: frame.width,
          height: frame.height,
          bytes: new Uint8Array(mask)
        })
        keyframes = [
          {
            sourceFrame: frame.sourceFrame,
            sourceTime: frame.sourceTime,
            width: frame.width,
            height: frame.height,
            strokes,
            maskRef: saved.maskRef
          }
        ]
      }
      const next: CustomCutoutSettings = {
        ...settings,
        enabled: true,
        revision,
        expand,
        feather,
        invert,
        keyframes
      }
      editor.timeline.updateElements({
        updates: [{ trackId, elementId: element.id, updates: { [field]: next } }],
        pushHistory: true
      })
      committed.current = true
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setApplying(false)
    }
  }

  const statusText = tracking
    ? runtime?.phase === 'downloading-tracker'
      ? `正在下载跟踪模型${runtime.progress === undefined ? '' : ` ${runtime.progress}%`}`
      : runtime?.phase === 'loading-tracker'
        ? '正在加载跟踪模型'
        : `正在跟踪对象 ${trackingProgress.current}/${trackingProgress.total}`
    : runtime?.phase === 'downloading-model'
      ? `正在下载模型${runtime.progress === undefined ? '' : ` ${runtime.progress}%`}`
      : runtime?.phase === 'loading-model'
        ? '正在加载模型'
        : '正在识别画笔区域'

  return createPortal(
    <div className="custom-cutout-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <header className="custom-cutout-header">
        <div>
          <strong>{title}</strong>
          <span>{element.name}</span>
        </div>
        <button type="button" aria-label={`关闭${title}`} title="关闭" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="custom-cutout-body">
        <aside className="custom-cutout-tools">
          <div className="custom-cutout-tool-group">
            <span>画笔</span>
            <div className="custom-cutout-segments">
              <button
                type="button"
                className={tool === 'keep' ? 'active keep' : ''}
                onClick={() => setTool('keep')}
                title="涂抹需要保留的区域"
              >
                <CirclePlus size={15} /> 保留
              </button>
              <button
                type="button"
                className={tool === 'erase' ? 'active erase' : ''}
                onClick={() => setTool('erase')}
                title="涂抹需要去除的区域"
              >
                <CircleMinus size={15} /> 擦除
              </button>
            </div>
          </div>
          <label className="custom-cutout-slider">
            <span>
              <Brush size={14} /> 画笔大小 <b>{brushSize}</b>
            </span>
            <input
              type="range"
              min={8}
              max={100}
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.target.value))}
            />
          </label>
          <label className="custom-cutout-slider">
            <span>
              <MoveHorizontal size={14} /> 边缘扩展
              <b>{expand > 0 ? `+${expand}` : expand}px</b>
            </span>
            <input
              type="range"
              min={-30}
              max={30}
              value={expand}
              onChange={(event) => setExpand(Number(event.target.value))}
            />
          </label>
          <label className="custom-cutout-slider">
            <span>
              <Blend size={14} /> 羽化 <b>{feather}px</b>
            </span>
            <input
              type="range"
              min={0}
              max={30}
              value={feather}
              onChange={(event) => setFeather(Number(event.target.value))}
            />
          </label>
          <label className="custom-cutout-toggle">
            <span>反转蒙版</span>
            <Switch
              checked={invert}
              aria-label={invert ? '关闭反转蒙版' : '开启反转蒙版'}
              onCheckedChange={setInvert}
            />
          </label>
          <div className="custom-cutout-history">
            <button
              type="button"
              title="撤销效果"
              aria-label="撤销效果"
              disabled={!undoHistory.length || processing || tracking}
              onClick={undo}
            >
              <Undo2 size={16} />
            </button>
            <button
              type="button"
              title="重做效果"
              aria-label="重做效果"
              disabled={!redoHistory.length || processing || tracking}
              onClick={redoStroke}
            >
              <Redo2 size={16} />
            </button>
            <button
              type="button"
              title="清空"
              aria-label="清空效果"
              disabled={(!strokes.length && !mask) || processing || tracking}
              onClick={() => {
                setUndoHistory((history) => appendHistory(history, snapshotEffect(strokes, mask)))
                setRedoHistory([])
                restoreEffect({ strokes: [], mask: null })
              }}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <div className="custom-cutout-help">
            <Eraser size={15} />
            <p>绿色标记保留区域，红色标记去除区域。每次涂抹结束后自动更新蒙版。</p>
          </div>
          {element.type === 'video' && (
            <button
              type="button"
              className="custom-cutout-track-button"
              disabled={!mask || processing || applying}
              onClick={() => {
                if (trackingCancellation.current) trackingCancellation.current.cancelled = true
                else void trackVideo()
              }}
            >
              {tracking ? <X size={15} /> : <ScanSearch size={15} />}
              {tracking
                ? '停止跟踪'
                : propagatedKeyframes.length
                  ? `已跟踪 ${propagatedKeyframes.length} 帧`
                  : '跟踪整个片段'}
            </button>
          )}
        </aside>
        <main className="custom-cutout-stage">
          <div className="custom-cutout-preview-switch" role="group" aria-label="预览方式">
            {(
              [
                ['original', '原图'],
                ['effect', '效果'],
                ['overlay', '覆盖'],
                ['mask', '蒙版']
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={previewMode === value ? 'active' : ''}
                onClick={() => setPreviewMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="custom-cutout-canvas-wrap">
            {loading ? (
              <div className="custom-cutout-loading">
                <LoaderCircle size={22} className="animate-spin" /> 正在读取当前画面
              </div>
            ) : frame ? (
              <CutoutCanvas
                frame={frame}
                composite={composite}
                element={element}
                mask={mask}
                strokes={strokes}
                draftStroke={draftStroke}
                brushSize={brushSize}
                previewMode={previewMode}
                positive={tool === 'keep'}
                expand={expand}
                feather={feather}
                invert={invert}
                disabled={processing || tracking || applying}
                onStroke={finishStroke}
              />
            ) : null}
            {(processing || tracking) && (
              <div className="custom-cutout-progress">
                <LoaderCircle size={20} className="animate-spin" />
                <span>{statusText}</span>
              </div>
            )}
          </div>
          {error && <div className="custom-cutout-error">{error}</div>}
        </main>
      </div>
      <footer className="custom-cutout-footer">
        <span>{frame ? `当前帧 ${frame.sourceFrame} · ${frame.width} × ${frame.height}` : ''}</span>
        <div>
          <button type="button" onClick={onClose} disabled={applying}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={(!mask && !settings.keyframes.length) || processing || tracking || applying}
            onClick={() => void apply()}
          >
            {applying ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
            {mask ? '应用' : '移除效果'}
          </button>
        </div>
      </footer>
    </div>,
    document.body
  )
}

export function CustomCutoutProperties({
  element,
  trackId,
  field = 'customCutout',
  title = '自定义抠像'
}: {
  element: CustomCutoutElement
  trackId: string
  field?: CustomCutoutField
  title?: string
}) {
  const editor = useEditor()
  const settings = normalizeCustomCutout(element[field])
  const [open, setOpen] = useState(false)
  const asset = editor.media.getAssets().find((item) => item.id === element.mediaId)

  const toggleEnabled = (enabled: boolean) => {
    editor.timeline.updateElements({
      updates: [
        {
          trackId,
          elementId: element.id,
          updates: { [field]: { ...settings, enabled } }
        }
      ],
      pushHistory: true
    })
  }

  return (
    <section className="border-border border-b">
      <div className="flex min-h-12 items-center justify-between gap-3 px-4">
        <span className="text-xs font-medium">{title}</span>
        <div className="flex items-center gap-2">
          {settings.keyframes.length > 0 && (
            <Switch
              checked={settings.enabled}
              aria-label={settings.enabled ? '关闭自定义抠像' : '开启自定义抠像'}
              onCheckedChange={toggleEnabled}
            />
          )}
          <button
            type="button"
            className="border-border hover:bg-accent rounded-sm border px-2.5 py-1 text-[11px]"
            disabled={!asset}
            onClick={() => setOpen(true)}
          >
            {settings.keyframes.length ? '编辑' : '开始'}
          </button>
        </div>
      </div>
      {open && asset && (
        <CustomCutoutEditor
          editor={editor}
          element={element}
          trackId={trackId}
          settings={settings}
          asset={asset}
          field={field}
          title={title}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  )
}
