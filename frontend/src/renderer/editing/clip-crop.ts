export interface ClipCrop {
  x: number
  y: number
  width: number
  height: number
}

export type ClipCropHandle =
  | 'move'
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'bottom-left'

export const DEFAULT_CLIP_CROP: ClipCrop = {
  x: 0,
  y: 0,
  width: 1,
  height: 1
}

export const CLIP_CROP_PRESETS = [
  { id: 'free', label: '自由', aspect: null },
  { id: '16:9', label: '16:9', aspect: 16 / 9 },
  { id: '9:16', label: '9:16', aspect: 9 / 16 },
  { id: '1:1', label: '1:1', aspect: 1 },
  { id: '4:3', label: '4:3', aspect: 4 / 3 },
  { id: '3:4', label: '3:4', aspect: 3 / 4 },
  { id: '21:9', label: '21:9', aspect: 21 / 9 }
] as const

const MIN_CROP_SIZE = 0.02

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeClipCrop(value: unknown): ClipCrop | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Partial<ClipCrop>
  const width = clamp(finite(input.width, 1), MIN_CROP_SIZE, 1)
  const height = clamp(finite(input.height, 1), MIN_CROP_SIZE, 1)
  return {
    x: clamp(finite(input.x, 0), 0, 1 - width),
    y: clamp(finite(input.y, 0), 0, 1 - height),
    width,
    height
  }
}

export function getClipCrop(value: unknown): ClipCrop {
  return normalizeClipCrop(value) ?? { ...DEFAULT_CLIP_CROP }
}

export function createClipCropForAspect({
  crop,
  aspect,
  sourceWidth,
  sourceHeight
}: {
  crop?: unknown
  aspect: number | null
  sourceWidth: number
  sourceHeight: number
}): ClipCrop {
  const current = getClipCrop(crop)
  if (!aspect || aspect <= 0 || sourceWidth <= 0 || sourceHeight <= 0) return current

  const normalizedAspect = (aspect * sourceHeight) / sourceWidth
  let width = current.width
  let height = current.height
  if (width / height > normalizedAspect) width = height * normalizedAspect
  else height = width / normalizedAspect

  return normalizeClipCrop({
    x: current.x + (current.width - width) / 2,
    y: current.y + (current.height - height) / 2,
    width,
    height
  })!
}

export function updateClipCropFromPointer({
  crop,
  handle,
  deltaX,
  deltaY,
  aspect,
  sourceWidth,
  sourceHeight
}: {
  crop: ClipCrop
  handle: ClipCropHandle
  deltaX: number
  deltaY: number
  aspect: number | null
  sourceWidth: number
  sourceHeight: number
}): ClipCrop {
  const start = getClipCrop(crop)
  if (handle === 'move') {
    return {
      ...start,
      x: clamp(start.x + deltaX, 0, 1 - start.width),
      y: clamp(start.y + deltaY, 0, 1 - start.height)
    }
  }

  const movesLeft = handle.includes('left')
  const movesRight = handle.includes('right')
  const movesTop = handle.includes('top')
  const movesBottom = handle.includes('bottom')
  const right = start.x + start.width
  const bottom = start.y + start.height
  let left = movesLeft ? clamp(start.x + deltaX, 0, right - MIN_CROP_SIZE) : start.x
  let nextRight = movesRight ? clamp(right + deltaX, left + MIN_CROP_SIZE, 1) : right
  let top = movesTop ? clamp(start.y + deltaY, 0, bottom - MIN_CROP_SIZE) : start.y
  let nextBottom = movesBottom ? clamp(bottom + deltaY, top + MIN_CROP_SIZE, 1) : bottom

  if (aspect && aspect > 0 && sourceWidth > 0 && sourceHeight > 0) {
    const normalizedAspect = (aspect * sourceHeight) / sourceWidth
    const isCorner = (movesLeft || movesRight) && (movesTop || movesBottom)
    const widthFromPointer = nextRight - left
    const heightFromPointer = nextBottom - top
    const useWidth =
      isCorner
        ? Math.abs(deltaX * sourceWidth) >= Math.abs(deltaY * sourceHeight)
        : movesLeft || movesRight
    let width = useWidth ? widthFromPointer : heightFromPointer * normalizedAspect
    let height = useWidth ? widthFromPointer / normalizedAspect : heightFromPointer

    const anchorX = movesLeft ? right : movesRight ? start.x : start.x + start.width / 2
    const anchorY = movesTop ? bottom : movesBottom ? start.y : start.y + start.height / 2
    const maxWidth =
      movesLeft ? anchorX : movesRight ? 1 - anchorX : 2 * Math.min(anchorX, 1 - anchorX)
    const maxHeight =
      movesTop ? anchorY : movesBottom ? 1 - anchorY : 2 * Math.min(anchorY, 1 - anchorY)
    const scale = Math.min(1, maxWidth / width, maxHeight / height)
    width = Math.max(MIN_CROP_SIZE, width * scale)
    height = Math.max(MIN_CROP_SIZE, height * scale)

    left = movesLeft ? anchorX - width : movesRight ? anchorX : anchorX - width / 2
    nextRight = left + width
    top = movesTop ? anchorY - height : movesBottom ? anchorY : anchorY - height / 2
    nextBottom = top + height
  }

  return normalizeClipCrop({
    x: left,
    y: top,
    width: nextRight - left,
    height: nextBottom - top
  })!
}

export interface ClipCropRenderLayout {
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  x: number
  y: number
  width: number
  height: number
}

export function getClipCropRenderLayout({
  crop,
  sourceWidth,
  sourceHeight,
  canvasWidth,
  canvasHeight,
  fitCanvasWidth = canvasWidth,
  fitCanvasHeight = canvasHeight,
  scale = 1,
  rotation = 0,
  position = { x: 0, y: 0 }
}: {
  crop?: unknown
  sourceWidth: number
  sourceHeight: number
  canvasWidth: number
  canvasHeight: number
  fitCanvasWidth?: number
  fitCanvasHeight?: number
  scale?: number
  rotation?: number
  position?: { x: number; y: number }
}): ClipCropRenderLayout {
  const normalized = normalizeClipCrop(crop)
  const sourceCrop = normalized ?? DEFAULT_CLIP_CROP
  const croppedWidth = Math.max(1, sourceWidth * sourceCrop.width)
  const croppedHeight = Math.max(1, sourceHeight * sourceCrop.height)

  let baseScale: number
  if (normalized) {
    const radians = (rotation * Math.PI) / 180
    const cosine = Math.abs(Math.cos(radians))
    const sine = Math.abs(Math.sin(radians))
    baseScale = Math.max(
      (canvasWidth * cosine + canvasHeight * sine) / croppedWidth,
      (canvasWidth * sine + canvasHeight * cosine) / croppedHeight
    )
  } else {
    baseScale = Math.min(fitCanvasWidth / croppedWidth, fitCanvasHeight / croppedHeight)
  }

  const width = croppedWidth * baseScale * Math.max(0.01, scale)
  const height = croppedHeight * baseScale * Math.max(0.01, scale)
  return {
    sourceX: sourceWidth * sourceCrop.x,
    sourceY: sourceHeight * sourceCrop.y,
    sourceWidth: croppedWidth,
    sourceHeight: croppedHeight,
    x: canvasWidth / 2 + position.x - width / 2,
    y: canvasHeight / 2 + position.y - height / 2,
    width,
    height
  }
}

