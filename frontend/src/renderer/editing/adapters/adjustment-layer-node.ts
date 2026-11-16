import { BaseNode } from '@cutia/services/renderer/nodes/base-node'
import type { CanvasRenderer } from '@cutia/services/renderer/canvas-renderer'
import { EffectNode } from './clip-effect-node'
import { FilterNode } from './clip-filter-node'
import { ColorAdjustmentNode } from './color-adjustment-node'

export class AdjustmentLayerNode extends BaseNode {
  private readonly processed: BaseNode

  constructor(
    private readonly input: {
      node: BaseNode
      startTime: number
      duration: number
      colorFilter?: unknown
      colorAdjustment?: unknown
      colorAdjustmentMask?: unknown
      colorAdjustmentCustomMask?: unknown
      effects?: unknown
    }
  ) {
    super()
    let processed = input.colorFilter
      ? new FilterNode({ node: input.node, filter: input.colorFilter })
      : input.node
    if (Array.isArray(input.effects) && input.effects.length) {
      processed = new EffectNode({ node: processed, effects: input.effects })
    }
    if (input.colorAdjustment) {
      processed = new ColorAdjustmentNode({
        node: processed,
        adjustment: input.colorAdjustment,
        startTime: input.startTime,
        duration: input.duration,
        shapeMask: input.colorAdjustmentMask,
        customMask: input.colorAdjustmentCustomMask
      })
    }
    this.processed = processed
  }

  async render({ renderer, time }: { renderer: CanvasRenderer; time: number }): Promise<void> {
    const isActive =
      time >= this.input.startTime && time < this.input.startTime + this.input.duration
    await (isActive ? this.processed : this.input.node).render({ renderer, time })
  }
}
