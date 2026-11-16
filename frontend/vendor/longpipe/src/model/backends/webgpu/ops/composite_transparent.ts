import type { Tensor } from '~/model/backend.ts'
import type { WebGPUTensor } from '~/model/backends/webgpu/base_webgpu_op.ts'
import type { WebGPUBackend } from '~/model/backends/webgpu/index.ts'
import compositeTransparentF16Src from '~/model/backends/webgpu/shaders/composite_transparent_f16.wgsl'
import compositeTransparentF32Src from '~/model/backends/webgpu/shaders/composite_transparent.wgsl'

export class CompositeTransparentWebGPU {
  private readonly pipeline: GPURenderPipeline
  private readonly bindGroup: GPUBindGroup
  private readonly uniformBuffer: GPUBuffer
  private outputView: GPUTextureView | null = null

  constructor(
    private readonly backend: WebGPUBackend,
    image: Tensor,
    alpha: Tensor
  ) {
    if (image.h !== alpha.h || image.w !== alpha.w) {
      throw new Error(
        `CompositeTransparent: image (${image.h}x${image.w}) and alpha ` +
          `(${alpha.h}x${alpha.w}) must match. Run the upscaler first.`
      )
    }

    const device = backend.device
    this.uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
    device.queue.writeBuffer(this.uniformBuffer, 0, new Uint32Array([image.w, 0, 0, 0]))

    const source = backend.dtype === 'f16' ? compositeTransparentF16Src : compositeTransparentF32Src
    const module = device.createShaderModule({ code: source })
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: backend.canvasFormat }] },
      primitive: { topology: 'triangle-list' }
    })
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: (image as WebGPUTensor).buffer } },
        { binding: 1, resource: { buffer: (alpha as WebGPUTensor).buffer } },
        { binding: 2, resource: { buffer: this.uniformBuffer } }
      ]
    })
  }

  setOutput(texture: GPUTexture): void {
    this.outputView = texture.createView()
  }

  run(): void {
    if (!this.outputView) {
      throw new Error('CompositeTransparentWebGPU.run() called before setOutput()')
    }

    const encoder = this.backend.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.outputView,
          clearValue: [0, 0, 0, 0],
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroup)
    pass.draw(6)
    pass.end()
    this.backend.device.queue.submit([encoder.finish()])
    this.outputView = null
  }
}
