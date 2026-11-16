import { CanvasRenderer } from '@cutia/services/renderer/canvas-renderer'
import { BaseNode } from '@cutia/services/renderer/nodes/base-node'
import {
  getClipMaskLocalTime,
  normalizeClipMaskSettings,
  resolveClipMaskAtTime,
  type ClipMask,
  type ClipMaskSettings
} from '../clip-mask'

type DrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function clear(renderer: CanvasRenderer): void {
  renderer.context.save()
  renderer.context.setTransform(1, 0, 0, 1, 0, 0)
  renderer.context.globalAlpha = 1
  renderer.context.globalCompositeOperation = 'source-over'
  if ('filter' in renderer.context) renderer.context.filter = 'none'
  renderer.context.clearRect(0, 0, renderer.width, renderer.height)
  renderer.context.restore()
}

function drawStar(context: DrawingContext, width: number, height: number): void {
  const outer = 0.5
  const inner = 0.22
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner
    const angle = -Math.PI / 2 + (Math.PI * index) / 5
    const x = Math.cos(angle) * width * radius
    const y = Math.sin(angle) * height * radius
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
}

function drawHeart(context: DrawingContext, width: number, height: number): void {
  context.moveTo(0, height * 0.42)
  context.bezierCurveTo(
    -width * 0.08,
    height * 0.32,
    -width * 0.5,
    height * 0.08,
    -width * 0.5,
    -height * 0.18
  )
  context.bezierCurveTo(
    -width * 0.5,
    -height * 0.48,
    -width * 0.13,
    -height * 0.58,
    0,
    -height * 0.3
  )
  context.bezierCurveTo(
    width * 0.13,
    -height * 0.58,
    width * 0.5,
    -height * 0.48,
    width * 0.5,
    -height * 0.18
  )
  context.bezierCurveTo(width * 0.5, height * 0.08, width * 0.08, height * 0.32, 0, height * 0.42)
  context.closePath()
}

function drawMaskShape(
  context: DrawingContext,
  mask: ClipMask,
  canvasWidth: number,
  canvasHeight: number
): void {
  const width = Math.max(1, mask.width)
  const height = Math.max(1, mask.height)
  const extent = Math.hypot(canvasWidth, canvasHeight) * 2
  context.save()
  context.translate(canvasWidth / 2 + mask.position.x, canvasHeight / 2 + mask.position.y)
  context.rotate((mask.rotation * Math.PI) / 180)
  context.beginPath()
  switch (mask.type) {
    case 'linear':
      context.rect(-extent, -extent, extent * 2, extent)
      break
    case 'mirror':
      context.rect(-extent, -height / 2, extent * 2, height)
      break
    case 'circle':
      context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2)
      break
    case 'rectangle':
      context.rect(-width / 2, -height / 2, width, height)
      break
    case 'arc':
      context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2)
      context.ellipse(
        width * 0.2,
        -height * 0.03,
        width * 0.39,
        height * 0.46,
        0,
        0,
        Math.PI * 2,
        true
      )
      break
    case 'star':
      drawStar(context, width, height)
      break
    case 'heart':
      drawHeart(context, width, height)
      break
  }
  context.fillStyle = '#fff'
  if ('filter' in context) context.filter = mask.feather > 0 ? `blur(${mask.feather}px)` : 'none'
  context.fill(mask.type === 'arc' ? 'evenodd' : 'nonzero')
  context.restore()
}

export class ClipMaskNode extends BaseNode {
  private source?: CanvasRenderer
  private combined?: CanvasRenderer
  private shape?: CanvasRenderer
  private inverted?: CanvasRenderer

  constructor(
    private readonly input: {
      node: BaseNode
      settings: unknown
      startTime: number
      duration: number
    }
  ) {
    super()
  }

  private ensureCanvas(
    current: CanvasRenderer | undefined,
    renderer: CanvasRenderer
  ): CanvasRenderer {
    if (!current) {
      return new CanvasRenderer({
        width: renderer.width,
        height: renderer.height,
        fps: renderer.fps,
        imageSmoothingQuality: 'high'
      })
    }
    if (current.width !== renderer.width || current.height !== renderer.height) {
      current.setSize({ width: renderer.width, height: renderer.height })
    }
    return current
  }

  private drawCombinedMask(
    renderer: CanvasRenderer,
    settings: ClipMaskSettings,
    localTime: number
  ): HTMLCanvasElement | OffscreenCanvas {
    this.combined = this.ensureCanvas(this.combined, renderer)
    this.shape = this.ensureCanvas(this.shape, renderer)
    this.inverted = this.ensureCanvas(this.inverted, renderer)
    clear(this.combined)

    for (const originalMask of settings.masks) {
      if (!originalMask.enabled) continue
      clear(this.shape)
      const mask: ClipMask = resolveClipMaskAtTime(originalMask, localTime)
      drawMaskShape(this.shape.context, mask, renderer.width, renderer.height)
      let layer = this.shape.canvas
      if (mask.inverted) {
        clear(this.inverted)
        this.inverted.context.fillStyle = '#fff'
        this.inverted.context.fillRect(0, 0, renderer.width, renderer.height)
        this.inverted.context.globalCompositeOperation = 'destination-out'
        this.inverted.context.drawImage(this.shape.canvas, 0, 0)
        this.inverted.context.globalCompositeOperation = 'source-over'
        layer = this.inverted.canvas
      }
      this.combined.context.drawImage(layer, 0, 0)
    }
    return this.combined.canvas
  }

  async render({ renderer, time }: { renderer: CanvasRenderer; time: number }): Promise<void> {
    const settings = normalizeClipMaskSettings(
      this.input.settings,
      {
        width: renderer.width,
        height: renderer.height
      },
      this.input.duration
    )
    const activeMasks = settings.masks.filter((mask) => mask.enabled)
    if (!settings.enabled || activeMasks.length === 0) {
      await this.input.node.render({ renderer, time })
      return
    }

    this.source = this.ensureCanvas(this.source, renderer)
    clear(this.source)
    await this.input.node.render({ renderer: this.source, time })
    const localTime = getClipMaskLocalTime({
      startTime: this.input.startTime,
      duration: this.input.duration,
      timelineTime: time
    })
    const combinedMask = this.drawCombinedMask(renderer, settings, localTime)

    this.source.context.save()
    this.source.context.globalCompositeOperation = 'destination-in'
    this.source.context.drawImage(combinedMask, 0, 0)
    this.source.context.restore()
    renderer.context.drawImage(this.source.canvas, 0, 0)
  }
}
