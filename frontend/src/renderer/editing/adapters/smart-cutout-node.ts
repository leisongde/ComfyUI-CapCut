import { CanvasRenderer } from '@cutia/services/renderer/canvas-renderer'
import { BaseNode } from '@cutia/services/renderer/nodes/base-node'
import { normalizeSmartCutout } from '../smart-cutout'
import { setSmartCutoutRuntimeStatus } from '../smart-cutout-runtime'
import { LongpipeSmartCutout } from './longpipe-smart-cutout'

const IDLE_DISPOSE_MS = 60_000

export class SmartCutoutNode extends BaseNode {
  private intermediate?: CanvasRenderer
  private engine?: LongpipeSmartCutout
  private enginePromise?: Promise<LongpipeSmartCutout>
  private engineGeneration = 0
  private disposeTimer?: ReturnType<typeof setTimeout>
  private warned = false
  private lastTime?: number

  constructor(
    private readonly input: {
      node: BaseNode
      settings: unknown
    }
  ) {
    super()
  }

  private ensureIntermediate(renderer: CanvasRenderer): CanvasRenderer {
    if (!this.intermediate) {
      this.intermediate = new CanvasRenderer({
        width: renderer.width,
        height: renderer.height,
        fps: renderer.fps,
        imageSmoothingQuality: 'high'
      })
    } else if (
      this.intermediate.width !== renderer.width ||
      this.intermediate.height !== renderer.height
    ) {
      this.intermediate.setSize({ width: renderer.width, height: renderer.height })
      this.releaseEngine()
    }
    return this.intermediate
  }

  private ensureEngine(width: number, height: number): Promise<LongpipeSmartCutout> {
    if (this.engine) return Promise.resolve(this.engine)
    if (!this.enginePromise) {
      const generation = this.engineGeneration
      const pending = LongpipeSmartCutout.create(width, height)
        .then((engine) => {
          if (generation !== this.engineGeneration) {
            engine.destroy()
            throw new Error('智能抠像渲染上下文已更新')
          }
          this.engine = engine
          this.warned = false
          return engine
        })
        .finally(() => {
          if (this.enginePromise === pending) this.enginePromise = undefined
        })
      this.enginePromise = pending
    }
    return this.enginePromise
  }

  private keepAlive(): void {
    if (this.disposeTimer) clearTimeout(this.disposeTimer)
    this.disposeTimer = setTimeout(() => this.releaseEngine(), IDLE_DISPOSE_MS)
  }

  private releaseEngine(): void {
    this.engineGeneration += 1
    if (this.disposeTimer) clearTimeout(this.disposeTimer)
    this.disposeTimer = undefined
    this.engine?.destroy()
    this.engine = undefined
    this.enginePromise = undefined
  }

  async render({ renderer, time }: { renderer: CanvasRenderer; time: number }): Promise<void> {
    const settings = normalizeSmartCutout(this.input.settings)
    if (!settings.enabled) {
      await this.input.node.render({ renderer, time })
      return
    }

    const discontinuityThreshold = Math.max(0.25, 4 / Math.max(1, renderer.fps))
    if (
      this.lastTime !== undefined &&
      (time < this.lastTime || time - this.lastTime > discontinuityThreshold)
    ) {
      this.releaseEngine()
    }
    this.lastTime = time

    const intermediate = this.ensureIntermediate(renderer)
    intermediate.context.save()
    intermediate.context.setTransform(1, 0, 0, 1, 0, 0)
    intermediate.context.clearRect(0, 0, intermediate.width, intermediate.height)
    intermediate.context.restore()
    await this.input.node.render({ renderer: intermediate, time })

    try {
      const engine = await this.ensureEngine(renderer.width, renderer.height)
      this.keepAlive()
      const keyed = await engine.process(intermediate.canvas, time)
      renderer.context.drawImage(keyed, 0, 0, renderer.width, renderer.height)
    } catch (error) {
      if (!this.warned) {
        this.warned = true
        console.warn('智能抠像不可用，已显示原始画面', error)
      }
      const message = error instanceof Error ? error.message : String(error)
      setSmartCutoutRuntimeStatus({ state: 'error', message })
      this.releaseEngine()
      renderer.context.drawImage(intermediate.canvas, 0, 0, renderer.width, renderer.height)
    }
  }
}
