import { CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useEditor } from '@/hooks/use-editor'
import type { ImageElement, VideoElement } from '@/types/timeline'
import { normalizeSmartCutout } from './smart-cutout'
import { useSmartCutoutRuntimeStatus } from './smart-cutout-runtime'

type VisualElementWithSmartCutout = (VideoElement | ImageElement) & { smartCutout?: unknown }

export function SmartCutoutProperties({
  element,
  trackId
}: {
  element: VisualElementWithSmartCutout
  trackId: string
}) {
  const editor = useEditor()
  const settings = normalizeSmartCutout(element.smartCutout)
  const runtime = useSmartCutoutRuntimeStatus()

  const updateEnabled = (enabled: boolean) => {
    editor.timeline.updateElements({
      updates: [
        {
          trackId,
          elementId: element.id,
          updates: { smartCutout: { enabled } }
        }
      ],
      pushHistory: true
    })
  }

  return (
    <section className="border-border border-b">
      <div className="flex min-h-12 items-center justify-between gap-3 px-4">
        <span className="text-xs font-medium">智能抠像</span>
        <Switch
          checked={settings.enabled}
          aria-label={settings.enabled ? '关闭智能抠像' : '开启智能抠像'}
          onCheckedChange={updateEnabled}
        />
      </div>
      {settings.enabled && runtime.state !== 'idle' && (
        <div className="text-muted-foreground flex h-8 items-center gap-1.5 border-t px-4 text-[11px]">
          {runtime.state === 'loading' && (
            <>
              <LoaderCircle className="size-3 animate-spin" />
              <span>模型加载中</span>
            </>
          )}
          {runtime.state === 'ready' && (
            <>
              <CircleCheck className="size-3 text-emerald-500" />
              <span>本地模型已就绪</span>
            </>
          )}
          {runtime.state === 'error' && (
            <>
              <TriangleAlert className="size-3 text-amber-500" />
              <span className="truncate" title={runtime.message}>
                模型加载失败
              </span>
            </>
          )}
        </div>
      )}
    </section>
  )
}
