import { useState } from 'react'
import type { ImageElement, VideoElement } from '@/types/timeline'
import { Brush, Shapes } from 'lucide-react'
import { isAdjustmentElement } from './adjustment-layer'
import { CustomCutoutProperties } from './CustomCutoutProperties'
import { MaskProperties } from './MaskProperties'

type AdjustmentMaskElement = (VideoElement | ImageElement) & {
  colorAdjustmentMask?: unknown
  colorAdjustmentCustomMask?: unknown
}

export function ColorAdjustmentMaskProperties({
  element,
  trackId
}: {
  element: AdjustmentMaskElement
  trackId: string
}) {
  const [mode, setMode] = useState<'shape' | 'brush'>('shape')
  const supportsBrush = !isAdjustmentElement(element)

  return (
    <div className="color-adjustment-mask">
      <div className="color-adjustment-subtabs" role="tablist" aria-label="调色蒙版类型">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'shape'}
          className={mode === 'shape' ? 'active' : ''}
          onClick={() => setMode('shape')}
        >
          <Shapes size={14} />
          形状蒙版
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'brush'}
          className={mode === 'brush' ? 'active' : ''}
          disabled={!supportsBrush}
          title={supportsBrush ? '智能画笔' : '调节层暂不支持智能画笔'}
          onClick={() => setMode('brush')}
        >
          <Brush size={14} />
          智能画笔
        </button>
      </div>
      {mode === 'shape' || !supportsBrush ? (
        <MaskProperties
          element={element}
          trackId={trackId}
          field="colorAdjustmentMask"
          title="调色蒙版"
          subtitle="形状蒙版"
        />
      ) : (
        <CustomCutoutProperties
          element={element}
          trackId={trackId}
          field="colorAdjustmentCustomMask"
          title="智能画笔蒙版"
        />
      )}
    </div>
  )
}
