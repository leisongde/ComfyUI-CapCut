import type { Backend, Dtype } from '~/model/backend.ts'
import { WebGLBackend } from '~/model/backends/webgl/index.ts'
import { WebGPUBackend } from '~/model/backends/webgpu/index.ts'
import type { ManualPreset } from '~/pipeline/presets.ts'
import { Renderer as LongpipeRenderer } from '~/pipeline/worker/renderer.ts'
import { setSmartCutoutRuntimeStatus } from '../smart-cutout-runtime'

const WEIGHTS_BASE_URL = new URL('./models/longpipe', window.location.href).href
const MODEL = 'medium' as const
const MODEL_RESOLUTION = { w: 512, h: 320 } as const
const MODEL_BYTE_LENGTH: Record<Dtype, number> = {
  f16: 7_040_874,
  f32: 14_074_452
}

const weights = new Map<Dtype, Promise<ArrayBuffer>>()

const loadWeights = (dtype: Dtype): Promise<ArrayBuffer> => {
  const cached = weights.get(dtype)
  if (cached) return cached
  const suffix = dtype === 'f16' ? '.f16.bin' : '.bin'
  const pending = fetch(`${WEIGHTS_BASE_URL}/model_${MODEL}${suffix}`).then(async (response) => {
    if (!response.ok) throw new Error(`智能抠像模型读取失败 (${response.status})`)
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength !== MODEL_BYTE_LENGTH[dtype]) {
      throw new Error(
        `智能抠像模型文件不完整 (应为 ${MODEL_BYTE_LENGTH[dtype]} 字节，实际 ${buffer.byteLength} 字节)`
      )
    }
    return buffer
  })
  weights.set(dtype, pending)
  pending.catch(() => weights.delete(dtype))
  return pending
}

async function createBackend(
  width: number,
  height: number
): Promise<{
  backend: Backend
  backendKind: 'webgpu' | 'webgl'
  canvas: OffscreenCanvas
  dtype: Dtype
}> {
  if (await WebGPUBackend.isAvailable()) {
    const dtype: Dtype = (await WebGPUBackend.hasF16Support()) ? 'f16' : 'f32'
    const canvas = new OffscreenCanvas(width, height)
    try {
      const backend = await WebGPUBackend.create({ canvas, dtype })
      return { backend, backendKind: 'webgpu', canvas, dtype }
    } catch (error) {
      console.warn('Longpipe WebGPU 初始化失败，尝试 WebGL', error)
    }
  }

  if (!WebGLBackend.isAvailable()) throw new Error('当前设备不支持智能抠像所需的 WebGPU/WebGL2')
  const canvas = new OffscreenCanvas(width, height)
  const backend = WebGLBackend.create({ canvas, dtype: 'f16' })
  return { backend, backendKind: 'webgl', canvas, dtype: 'f16' }
}

export class LongpipeSmartCutout {
  readonly canvas: OffscreenCanvas
  readonly backendKind: 'webgpu' | 'webgl'
  private readonly backend: Backend
  private readonly renderer: LongpipeRenderer

  private constructor(input: {
    backend: Backend
    backendKind: 'webgpu' | 'webgl'
    canvas: OffscreenCanvas
    renderer: LongpipeRenderer
  }) {
    this.backend = input.backend
    this.backendKind = input.backendKind
    this.canvas = input.canvas
    this.renderer = input.renderer
  }

  static async create(width: number, height: number): Promise<LongpipeSmartCutout> {
    setSmartCutoutRuntimeStatus({ state: 'loading' })
    try {
      const setup = await createBackend(width, height)
      const modelBytes = await loadWeights(setup.dtype)
      const renderer = new LongpipeRenderer({
        backend: setup.backend,
        backendKind: setup.backendKind,
        canvas: setup.canvas,
        background: { kind: 'transparent' },
        enabled: true,
        topology: { input: 'mstp', output: 'mstg' }
      })
      const preset: ManualPreset = {
        model: MODEL,
        dtype: setup.dtype,
        resolution: MODEL_RESOLUTION,
        skipFrames: 0
      }
      renderer.setPreset(preset, modelBytes)
      setSmartCutoutRuntimeStatus({ state: 'ready', backend: setup.backendKind })
      return new LongpipeSmartCutout({ ...setup, renderer })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSmartCutoutRuntimeStatus({ state: 'error', message })
      throw error
    }
  }

  async process(
    source: HTMLCanvasElement | OffscreenCanvas,
    time: number
  ): Promise<OffscreenCanvas> {
    const frame = new VideoFrame(source, {
      timestamp: Math.max(0, Math.round(time * 1_000_000)),
      alpha: 'keep'
    })
    try {
      this.renderer.process(frame)
      await this.backend.sync()
      return this.canvas
    } finally {
      frame.close()
    }
  }

  destroy(): void {
    this.renderer.destroy()
  }
}
