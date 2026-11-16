import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, RotateCcw, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle
} from '@/components/ui/dialog'
import type { MediaAsset } from '@/types/assets'
import type { ImageElement, Transform, VideoElement } from '@/types/timeline'
import { VideoCache } from '@/services/video-cache/service'
import {
  CLIP_CROP_PRESETS,
  DEFAULT_CLIP_CROP,
  createClipCropForAspect,
  getClipCrop,
  updateClipCropFromPointer,
  type ClipCrop,
  type ClipCropHandle
} from './clip-crop'

type CropElement = (VideoElement | ImageElement) & { crop?: ClipCrop }

interface CropResult {
  crop: ClipCrop
  transform: Transform
}

interface PointerInteraction {
  pointerId: number
  handle: ClipCropHandle
  clientX: number
  clientY: number
  crop: ClipCrop
  width: number
  height: number
}

const HANDLES: ClipCropHandle[] = [
  'top-left',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left'
]

const cropVideoCache = new VideoCache()

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizeRotation(value: number): number {
  const normalized = ((value % 360) + 360) % 360
  return normalized > 180 ? normalized - 360 : normalized
}

function getSourceTime(element: CropElement, timelineTime: number): number {
  const elapsed = clamp(timelineTime - element.startTime, 0, element.duration)
  const rate = element.type === 'video' ? element.playbackRate ?? 1 : 1
  if (element.type !== 'video' || !element.reversed) return element.trimStart + elapsed * rate
  const sourceTime = element.trimStart + rate * (element.duration - elapsed)
  return elapsed === 0 ? Math.max(element.trimStart, sourceTime - 1e-6) : sourceTime
}

function formatTime(seconds: number): string {
  const value = Math.max(0, seconds)
  const minutes = Math.floor(value / 60)
  const wholeSeconds = Math.floor(value % 60)
  const frames = Math.floor((value - Math.floor(value)) * 100)
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}

function findMatchingPreset(crop: ClipCrop, width: number, height: number): string {
  if (width <= 0 || height <= 0) return 'free'
  const actual = (crop.width * width) / (crop.height * height)
  return (
    CLIP_CROP_PRESETS.find(
      (preset) => preset.aspect && Math.abs(actual - preset.aspect) < 0.015
    )?.id ?? 'free'
  )
}

export function ClipCropDialog({
  open,
  onOpenChange,
  element,
  media,
  timelineTime,
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  element: CropElement | null
  media: MediaAsset | null
  timelineTime: number
  onConfirm: (result: CropResult) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const interactionRef = useRef<PointerInteraction | null>(null)
  const frameRequestRef = useRef(0)
  const [crop, setCrop] = useState<ClipCrop>({ ...DEFAULT_CLIP_CROP })
  const [presetId, setPresetId] = useState('free')
  const [zoom, setZoom] = useState(100)
  const [rotation, setRotation] = useState(0)
  const [sourceSize, setSourceSize] = useState({ width: 16, height: 9 })
  const [previewTime, setPreviewTime] = useState<number | null>(null)
  const [frameState, setFrameState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  const selectedPreset = useMemo(
    () => CLIP_CROP_PRESETS.find((preset) => preset.id === presetId) ?? CLIP_CROP_PRESETS[0],
    [presetId]
  )

  useEffect(() => {
    if (!open || !element) {
      setPreviewTime(null)
      setFrameState('idle')
      return
    }
    const nextCrop = getClipCrop(element.crop)
    const width = media?.width || 16
    const height = media?.height || 9
    setCrop(nextCrop)
    setSourceSize({ width, height })
    setPresetId(element.crop ? findMatchingPreset(nextCrop, width, height) : 'free')
    setZoom(Math.round(clamp(element.transform.scale * 100, 100, 400)))
    setRotation(normalizeRotation(element.transform.rotate))
    setPreviewTime(getSourceTime(element, timelineTime))
    interactionRef.current = null
  }, [element, media?.height, media?.width, open, timelineTime])

  useEffect(() => {
    if (!open || element?.type !== 'video' || !media || previewTime === null) return
    const requestId = ++frameRequestRef.current
    let cancelled = false
    setFrameState('loading')

    void cropVideoCache
      .getFrameAt({
        mediaId: media.id,
        file: media.file,
        time: previewTime,
        maxDimension: 1080,
        frameRate: media.fps
      })
      .then((frame) => {
        if (cancelled || requestId !== frameRequestRef.current || !frame) return
        const canvas = canvasRef.current
        if (!canvas) return
        const width = frame.canvas.width
        const height = frame.canvas.height
        if (!width || !height) throw new Error('裁剪预览帧尺寸无效')
        if (canvas.width !== width) canvas.width = width
        if (canvas.height !== height) canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法绘制裁剪预览帧')
        context.clearRect(0, 0, width, height)
        context.drawImage(frame.canvas, 0, 0, width, height)
        setSourceSize({ width, height })
        setFrameState('ready')
      })
      .catch((error) => {
        if (cancelled || requestId !== frameRequestRef.current) return
        console.error('Failed to decode crop preview frame:', error)
        setFrameState('error')
      })

    return () => {
      cancelled = true
    }
  }, [element?.type, media, open, previewTime])

  useEffect(() => {
    if (open || !media) return
    frameRequestRef.current += 1
    cropVideoCache.clearVideo({ mediaId: media.id })
  }, [media, open])

  if (!element || !media?.url) return null

  const aspect = selectedPreset.aspect
  const visibleDuration = element.type === 'video' ? element.duration * (element.playbackRate ?? 1) : 0
  const minimumTime = element.trimStart
  const maximumTime = Math.max(minimumTime, minimumTime + visibleDuration)
  const displayedPreviewTime = previewTime ?? minimumTime

  const updateSourceSize = (width: number, height: number) => {
    if (width <= 0 || height <= 0) return
    setSourceSize({ width, height })
  }

  const beginInteraction =
    (handle: ClipCropHandle) => (event: React.PointerEvent<HTMLElement>) => {
      const bounds = stageRef.current?.getBoundingClientRect()
      if (!bounds?.width || !bounds.height) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      interactionRef.current = {
        pointerId: event.pointerId,
        handle,
        clientX: event.clientX,
        clientY: event.clientY,
        crop,
        width: bounds.width,
        height: bounds.height
      }
    }

  const moveInteraction = (event: React.PointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    event.preventDefault()
    setCrop(
      updateClipCropFromPointer({
        crop: interaction.crop,
        handle: interaction.handle,
        deltaX: (event.clientX - interaction.clientX) / interaction.width,
        deltaY: (event.clientY - interaction.clientY) / interaction.height,
        aspect,
        sourceWidth: sourceSize.width,
        sourceHeight: sourceSize.height
      })
    )
  }

  const endInteraction = (event: React.PointerEvent<HTMLElement>) => {
    if (interactionRef.current?.pointerId !== event.pointerId) return
    interactionRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const selectPreset = (id: string) => {
    const preset = CLIP_CROP_PRESETS.find((item) => item.id === id) ?? CLIP_CROP_PRESETS[0]
    setPresetId(preset.id)
    setCrop(
      createClipCropForAspect({
        crop,
        aspect: preset.aspect,
        sourceWidth: sourceSize.width,
        sourceHeight: sourceSize.height
      })
    )
  }

  const reset = () => {
    setCrop({ ...DEFAULT_CLIP_CROP })
    setPresetId('free')
    setZoom(100)
    setRotation(0)
  }

  const confirm = () => {
    onConfirm({
      crop,
      transform: {
        ...element.transform,
        position: { x: 0, y: 0 },
        scale: zoom / 100,
        rotate: rotation
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="clip-crop-dialog"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="clip-crop-header">
          <DialogTitle>调整大小</DialogTitle>
          <button type="button" aria-label="关闭" onClick={() => onOpenChange(false)}>
            <X />
          </button>
        </div>

        <div className="clip-crop-body">
          <section className="clip-crop-preview">
            <div
              ref={stageRef}
              className="clip-crop-stage"
              style={{
                aspectRatio: `${sourceSize.width} / ${sourceSize.height}`,
                width: `min(100%, calc((100vh - 220px) * ${sourceSize.width / sourceSize.height}))`
              }}
            >
              {element.type === 'video' ? (
                <canvas
                  ref={canvasRef}
                  aria-label="当前播放头画面"
                  style={{ transform: `scale(${zoom / 100}) rotate(${rotation}deg)` }}
                />
              ) : (
                <img
                  src={media.url}
                  alt=""
                  draggable={false}
                  onLoad={(event) =>
                    updateSourceSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
                  }
                  style={{ transform: `scale(${zoom / 100}) rotate(${rotation}deg)` }}
                />
              )}

              {element.type === 'video' && frameState !== 'ready' && (
                <div className="clip-crop-frame-status" role="status">
                  {frameState === 'error' ? '画面读取失败' : '正在读取当前画面'}
                </div>
              )}

              <div
                className="clip-crop-selection"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.width * 100}%`,
                  height: `${crop.height * 100}%`
                }}
                onPointerDown={beginInteraction('move')}
                onPointerMove={moveInteraction}
                onPointerUp={endInteraction}
                onPointerCancel={endInteraction}
              >
                <span className="clip-crop-grid clip-crop-grid-x first" />
                <span className="clip-crop-grid clip-crop-grid-x second" />
                <span className="clip-crop-grid clip-crop-grid-y first" />
                <span className="clip-crop-grid clip-crop-grid-y second" />
                {HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className="clip-crop-handle"
                    data-handle={handle}
                    onPointerDown={beginInteraction(handle)}
                    onPointerMove={moveInteraction}
                    onPointerUp={endInteraction}
                    onPointerCancel={endInteraction}
                  />
                ))}
              </div>
            </div>

            {element.type === 'video' && (
              <div className="clip-crop-scrubber">
                <span>{formatTime(displayedPreviewTime)}</span>
                <input
                  type="range"
                  min={minimumTime}
                  max={maximumTime || minimumTime + 0.001}
                  step={0.01}
                  value={clamp(displayedPreviewTime, minimumTime, maximumTime)}
                  onChange={(event) => setPreviewTime(Number(event.target.value))}
                />
                <span>{formatTime(maximumTime)}</span>
              </div>
            )}
          </section>

          <aside className="clip-crop-controls">
            <div className="clip-crop-control-group">
              <label htmlFor="clip-crop-preset">裁剪比例</label>
              <select
                id="clip-crop-preset"
                value={presetId}
                onChange={(event) => selectPreset(event.target.value)}
              >
                {CLIP_CROP_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="clip-crop-control-group">
              <div className="clip-crop-control-label">
                <label htmlFor="clip-crop-zoom">缩放</label>
                <output>{zoom}%</output>
              </div>
              <input
                id="clip-crop-zoom"
                type="range"
                min={100}
                max={400}
                step={1}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </div>

            <div className="clip-crop-control-group">
              <div className="clip-crop-control-label">
                <label htmlFor="clip-crop-rotation">旋转角度</label>
                <output>{rotation}°</output>
              </div>
              <input
                id="clip-crop-rotation"
                type="range"
                min={-180}
                max={180}
                step={1}
                value={rotation}
                onChange={(event) => setRotation(Number(event.target.value))}
              />
            </div>

            <button type="button" className="clip-crop-reset" onClick={reset}>
              <RotateCcw />
              重置
            </button>
          </aside>
        </div>

        <div className="clip-crop-footer">
          <button type="button" className="clip-crop-cancel" onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button type="button" className="clip-crop-confirm" onClick={confirm}>
            <Check />
            确定
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

