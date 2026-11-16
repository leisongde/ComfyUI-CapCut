import type { ImageElement, VideoElement } from '@/types/timeline'
import { SmartCutoutProperties } from './SmartCutoutProperties'
import { ChromaKeyProperties } from './ChromaKeyProperties'

type CutoutElement = (VideoElement | ImageElement) & {
  smartCutout?: unknown
  customCutout?: unknown
  chromaKey?: unknown
}

export function CutoutProperties({
  element,
  trackId
}: {
  element: CutoutElement
  trackId: string
}) {
  return (
    <div className="h-full overflow-y-auto">
      <SmartCutoutProperties element={element} trackId={trackId} />
      <p className="text-muted-foreground border-border border-b px-4 py-3 text-xs">自定义抠像待接入 ComfyUI 工作流。</p>
      <ChromaKeyProperties element={element} trackId={trackId} />
    </div>
  )
}
