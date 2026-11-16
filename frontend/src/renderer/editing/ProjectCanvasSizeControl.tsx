import { useRef, useState, type ComponentProps, type ComponentType } from 'react'
import { Ratio } from 'lucide-react'
import { useEditor } from '@/hooks/use-editor'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

type DesktopDropdownMenuContentProps = ComponentProps<typeof DropdownMenuContent> & {
  container?: HTMLElement | null
}
const DesktopDropdownMenuContent = DropdownMenuContent as ComponentType<DesktopDropdownMenuContentProps>

const PROJECT_CANVAS_PRESETS = [
  { value: '1920x1080', ratio: '16:9', name: '横屏', width: 1920, height: 1080 },
  { value: '1080x1920', ratio: '9:16', name: '竖屏', width: 1080, height: 1920 },
  { value: '1080x1080', ratio: '1:1', name: '方形', width: 1080, height: 1080 },
  { value: '1440x1080', ratio: '4:3', name: '横屏', width: 1440, height: 1080 },
  { value: '1080x1440', ratio: '3:4', name: '竖屏', width: 1080, height: 1440 },
  { value: '2560x1080', ratio: '21:9', name: '宽银幕', width: 2560, height: 1080 }
] as const

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.max(1, Math.round(Math.abs(a)))
  let right = Math.max(1, Math.round(Math.abs(b)))
  while (right !== 0) {
    const remainder = left % right
    left = right
    right = remainder
  }
  return left
}

function formatRatio(width: number, height: number): string {
  const divisor = greatestCommonDivisor(width, height)
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}

function RatioPreview({ width, height }: { width: number; height: number }) {
  const ratio = width / height
  const previewWidth = ratio >= 1 ? 24 : Math.max(8, 24 * ratio)
  const previewHeight = ratio >= 1 ? Math.max(8, 24 / ratio) : 24
  return (
    <span className="flex size-7 shrink-0 items-center justify-center" aria-hidden="true">
      <span
        className="block rounded-[2px] border border-current opacity-70"
        style={{ width: previewWidth, height: previewHeight }}
      />
    </span>
  )
}

export function ProjectCanvasSizeControl() {
  const editor = useEditor()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | undefined>()
  const { width, height } = editor.project.getActive().settings.canvasSize
  const currentValue = `${width}x${height}`
  const currentRatio = formatRatio(width, height)

  const changeCanvasSize = (value: string) => {
    const preset = PROJECT_CANVAS_PRESETS.find((candidate) => candidate.value === value)
    if (!preset || preset.value === currentValue) return
    void editor.project.updateSettings({
      settings: { canvasSize: { width: preset.width, height: preset.height } }
    })
  }

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) {
          setPortalContainer(triggerRef.current?.closest<HTMLElement>('.panel') ?? undefined)
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="text"
          size="icon"
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          title={`项目画幅：${currentRatio}（${width} × ${height}）`}
          aria-label="调整项目画幅和分辨率"
        >
          <Ratio />
        </Button>
      </DropdownMenuTrigger>
      <DesktopDropdownMenuContent
        container={portalContainer}
        align="end"
        side="top"
        sideOffset={8}
        className="w-64"
      >
        <DropdownMenuLabel className="normal-case tracking-normal">
          项目画幅与分辨率
        </DropdownMenuLabel>
        <div className="text-muted-foreground px-3 pb-2 text-xs">
          当前 {currentRatio} · {width} × {height}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={currentValue} onValueChange={changeCanvasSize}>
          {PROJECT_CANVAS_PRESETS.map((preset) => (
            <DropdownMenuRadioItem key={preset.value} value={preset.value} className="py-2.5">
              <RatioPreview width={preset.width} height={preset.height} />
              <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="font-medium">
                  {preset.ratio} · {preset.name}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {preset.width} × {preset.height}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DesktopDropdownMenuContent>
    </DropdownMenu>
  )
}
