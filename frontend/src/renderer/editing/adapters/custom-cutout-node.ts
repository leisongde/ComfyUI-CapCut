import { CanvasRenderer } from '@cutia/services/renderer/canvas-renderer'
import { BaseNode } from '@cutia/services/renderer/nodes/base-node'
import {
  expandCustomCutoutMask,
  findCustomCutoutKeyframe,
  normalizeCustomCutout,
  type CustomCutoutKeyframe
} from '../custom-cutout'
import { readCustomCutoutMask } from '../custom-cutout-api'
import { projectId } from '../bridge'
import { resolveVisualState } from '../visual-keyframes'

type CanvasSource = HTMLCanvasElement | OffscreenCanvas

const maskCache = new Map<string, Promise<CanvasSource>>()
const MASK_CACHE_LIMIT = 24

function createMaskCanvas(
  keyframe: CustomCutoutKeyframe,
  bytes: Uint8Array,
  expand: number
): CanvasSource {
  if (bytes.byteLength !== keyframe.width * keyframe.height)
    throw new Error('自定义抠像蒙版尺寸不匹配')
  const processed = expandCustomCutoutMask(bytes, keyframe.width, keyframe.height, expand)
  let canvas: CanvasSource
  try {
    canvas = new OffscreenCanvas(keyframe.width, keyframe.height)
  } catch {
    const fallback = document.createElement('canvas')
    fallback.width = keyframe.width
    fallback.height = keyframe.height
    canvas = fallback
  }
  const context = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) throw new Error('无法创建自定义抠像蒙版画布')
  const rgba = new Uint8ClampedArray(processed.byteLength * 4)
  for (let index = 0; index < processed.byteLength; index += 1) {
    const offset = index * 4
    rgba[offset] = 255
    rgba[offset + 1] = 255
    rgba[offset + 2] = 255
    rgba[offset + 3] = processed[index]
  }
  context.putImageData(new ImageData(rgba, keyframe.width, keyframe.height), 0, 0)
  return canvas
}

async function loadMask(
  keyframe: CustomCutoutKeyframe,
  expand: number,
  feather: number,
  invert: boolean
): Promise<CanvasSource> {
  const cacheKey = `${projectId}:${keyframe.maskRef}:${expand}:${feather}:${invert ? 1 : 0}`
  let pending = maskCache.get(cacheKey)
  if (!pending) {
    while (maskCache.size >= MASK_CACHE_LIMIT) {
      const oldest = maskCache.keys().next().value
      if (oldest === undefined) break
      maskCache.delete(oldest)
    }
    pending = readCustomCutoutMask(keyframe.maskRef).then((bytes) => {
      if (!bytes) throw new Error('自定义抠像蒙版文件不存在')
      return createMaskCanvas(keyframe, bytes, expand)
    })
    maskCache.set(cacheKey, pending)
  }
  return pending
}

function drawTransformedMask(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  mask: CanvasSource,
  renderer: CanvasRenderer,
  params: any,
  time: number,
  feather: number,
  invert: boolean
): void {
  const transform = resolveVisualState({ source: params, timelineTime: time }).transform
  const fitCanvasSize = params.fitCanvasSize
  const sourceWidth = mask.width
  const sourceHeight = mask.height
  const containScale = Math.min(
    (fitCanvasSize?.width ?? renderer.width) / sourceWidth,
    (fitCanvasSize?.height ?? renderer.height) / sourceHeight
  )
  const scaledWidth = sourceWidth * containScale * transform.scale
  const scaledHeight = sourceHeight * containScale * transform.scale
  const x = renderer.width / 2 + transform.position.x - scaledWidth / 2
  const y = renderer.height / 2 + transform.position.y - scaledHeight / 2
  const centerX = x + scaledWidth / 2
  const centerY = y + scaledHeight / 2

  context.save()
  if (invert) {
    context.fillStyle = '#fff'
    context.fillRect(0, 0, renderer.width, renderer.height)
    context.globalCompositeOperation = 'destination-out'
  }
  if ('filter' in context) context.filter = feather > 0 ? `blur(${feather}px)` : 'none'
  context.translate(centerX, centerY)
  if (transform.rotate) context.rotate((transform.rotate * Math.PI) / 180)
  if (transform.flipX || transform.flipY)
    context.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1)
  context.translate(-centerX, -centerY)
  context.drawImage(mask, x, y, scaledWidth, scaledHeight)
  context.restore()
}

export class CustomCutoutNode extends BaseNode {
  private intermediate?: CanvasRenderer
  private maskLayer?: CanvasRenderer
  private warned = false

  constructor(
    private readonly input: {
      node: BaseNode
      settings: unknown
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
    if (current.width !== renderer.width || current.height !== renderer.height)
      current.setSize({ width: renderer.width, height: renderer.height })
    return current
  }

  async render({ renderer, time }: { renderer: CanvasRenderer; time: number }): Promise<void> {
    const settings = normalizeCustomCutout(this.input.settings)
    const params = this.input.node.params as any
    const elapsed = time - (params.timeOffset ?? 0)
    const rate = params.playbackRate ?? 1
    const sourceTime = params.reversed
      ? (params.trimStart ?? 0) + rate * ((params.duration ?? 0) - elapsed)
      : (params.trimStart ?? 0) + elapsed * rate
    const keyframe = findCustomCutoutKeyframe(settings.keyframes, sourceTime)
    if (!settings.enabled || !keyframe) {
      await this.input.node.render({ renderer, time })
      return
    }
    this.intermediate = this.ensureCanvas(this.intermediate, renderer)
    this.maskLayer = this.ensureCanvas(this.maskLayer, renderer)
    const intermediate = this.intermediate
    const maskLayer = this.maskLayer
    intermediate.context.clearRect(0, 0, intermediate.width, intermediate.height)
    maskLayer.context.clearRect(0, 0, maskLayer.width, maskLayer.height)
    await this.input.node.render({ renderer: intermediate, time })

    try {
      const mask = await loadMask(keyframe, settings.expand, settings.feather, settings.invert)
      drawTransformedMask(
        maskLayer.context,
        mask,
        renderer,
        this.input.node.params,
        time,
        settings.feather,
        settings.invert
      )
      intermediate.context.save()
      intermediate.context.globalCompositeOperation = 'destination-in'
      intermediate.context.drawImage(maskLayer.canvas, 0, 0)
      intermediate.context.restore()
      renderer.context.drawImage(intermediate.canvas, 0, 0)
    } catch (error) {
      if (!this.warned) {
        this.warned = true
        console.warn('自定义抠像蒙版加载失败，已显示原始画面', error)
      }
      renderer.context.drawImage(intermediate.canvas, 0, 0)
    }
  }
}
