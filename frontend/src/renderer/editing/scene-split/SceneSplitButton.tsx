import { useMemo, useRef, useState } from 'react'
import { ScanLine, Scissors, X } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@/hooks/use-editor'
import { useElementSelection } from '@/hooks/timeline/element/use-element-selection'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { MediaAsset } from '@/types/assets'
import type { VideoElement } from '@/types/timeline'
import { analyzeScenes, refineSceneBoundaries, type SceneAnalysis } from './scene-detection-service'
import { selectSceneBoundaries } from './scene-detection'
import { SceneSplitCommand } from './scene-split-command'
import { mapSourceCutsToTimeline } from './scene-split-plan'

interface SceneSplitTarget {
  trackId: string
  element: VideoElement
  media: MediaAsset
}

type Phase = 'idle' | 'analyzing' | 'ready' | 'applying' | 'error'

const formatTime = (seconds: number): string => {
  const value = Math.max(0, seconds)
  const minutes = Math.floor(value / 60)
  const remainder = value - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}`
}

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

function getSourceRange(element: VideoElement): { sourceStart: number; sourceEnd: number } {
  const rate = Math.max(0.01, element.playbackRate ?? 1)
  return {
    sourceStart: element.trimStart,
    sourceEnd: element.trimStart + element.duration * rate
  }
}

function ScenePreview({ duration, cuts }: { duration: number; cuts: number[] }) {
  const boundaries = [0, ...cuts, duration]
  const colors = ['bg-cyan-500/55', 'bg-amber-400/55', 'bg-emerald-500/50']
  return (
    <div className="relative flex h-12 w-full overflow-hidden rounded-sm border bg-muted/30">
      {boundaries.slice(0, -1).map((start, index) => {
        const segmentDuration = boundaries[index + 1] - start
        return (
          <div
            key={`${start}-${index}`}
            className={`relative flex min-w-0 items-center justify-center border-r border-background/70 last:border-r-0 ${colors[index % colors.length]}`}
            style={{ width: `${(segmentDuration / Math.max(duration, 1e-6)) * 100}%` }}
          >
            <span className="truncate px-1 text-[10px] font-medium text-foreground/80">
              {index + 1}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function SceneSplitButton() {
  const editor = useEditor()
  const { selectedElements } = useElementSelection()
  const [selected] =
    selectedElements.length === 1
      ? editor.timeline.getElementsWithTracks({ elements: selectedElements })
      : []
  const selectedVideo = selected?.element.type === 'video' ? selected.element : null
  const selectedMedia = selectedVideo
    ? (editor.media.getAssets().find((asset) => asset.id === selectedVideo.mediaId) ?? null)
    : null
  const available =
    selectedVideo !== null && selectedMedia?.type === 'video' && selectedVideo.duration >= 0.4

  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<SceneSplitTarget | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [analysis, setAnalysis] = useState<SceneAnalysis | null>(null)
  const [progress, setProgress] = useState(0)
  const [sensitivity, setSensitivity] = useState(65)
  const [minimumSceneDuration, setMinimumSceneDuration] = useState(0.5)
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const runRef = useRef(0)

  const boundaries = useMemo(() => {
    if (!analysis) return []
    return selectSceneBoundaries({
      changes: analysis.changes,
      sourceStart: analysis.sourceStart,
      sourceEnd: analysis.sourceEnd,
      sensitivity,
      minimumSceneDuration
    })
  }, [analysis, minimumSceneDuration, sensitivity])

  const timelineCuts = useMemo(() => {
    if (!target) return []
    return mapSourceCutsToTimeline({
      sourceCuts: boundaries.map((boundary) => boundary.time),
      element: target.element
    })
  }, [boundaries, target])

  const runAnalysis = async (nextTarget: SceneSplitTarget) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    const run = ++runRef.current
    controllerRef.current = controller
    setPhase('analyzing')
    setAnalysis(null)
    setProgress(0)
    setError('')
    try {
      const range = getSourceRange(nextTarget.element)
      const result = await analyzeScenes({
        file: nextTarget.media.file,
        ...range,
        signal: controller.signal,
        onProgress: (value) => {
          if (run === runRef.current) setProgress(value)
        }
      })
      if (run !== runRef.current || controller.signal.aborted) return
      setAnalysis(result)
      setProgress(1)
      setPhase('ready')
    } catch (cause) {
      if (isAbortError(cause)) return
      if (run !== runRef.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('error')
    }
  }

  const openDialog = () => {
    if (!available || !selected || selected.element.type !== 'video' || !selectedMedia) return
    const nextTarget = {
      trackId: selected.track.id,
      element: selected.element,
      media: selectedMedia
    }
    setTarget(nextTarget)
    setOpen(true)
    void runAnalysis(nextTarget)
  }

  const closeDialog = () => {
    controllerRef.current?.abort()
    runRef.current += 1
    setOpen(false)
    setPhase('idle')
  }

  const applySplit = async () => {
    if (!target || !analysis || boundaries.length === 0) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setPhase('applying')
    setProgress(0)
    setError('')
    try {
      const refined = await refineSceneBoundaries({
        file: target.media.file,
        boundaries,
        sourceStart: analysis.sourceStart,
        sourceEnd: analysis.sourceEnd,
        sampleFps: analysis.sampleFps,
        mediaFps: target.media.fps ?? 30,
        minimumSceneDuration,
        signal: controller.signal,
        onProgress: setProgress
      })
      const currentTrack = editor.timeline.getTrackById({ trackId: target.trackId })
      const currentElement = currentTrack?.elements.find(
        (element) => element.id === target.element.id
      )
      if (!currentElement || currentElement.type !== 'video')
        throw new Error('要分割的视频片段已经不在时间线上')
      const cuts = mapSourceCutsToTimeline({
        sourceCuts: refined.map((boundary) => boundary.time),
        element: currentElement
      })
      if (!cuts.length) throw new Error('精确校准后没有保留可用的镜头切点')
      const command = new SceneSplitCommand(target.trackId, currentElement.id, cuts)
      editor.command.execute({ command })
      toast.success(`已分成 ${command.getSegmentCount()} 个镜头片段`)
      setOpen(false)
      setPhase('idle')
    } catch (cause) {
      if (isAbortError(cause)) {
        setPhase('ready')
        return
      }
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('error')
    }
  }

  const tooltip = available ? '智能镜头分割' : '选择一个视频片段后可用'
  const relativeCuts = target
    ? timelineCuts
        .map((time) => time - target.element.startTime)
        .sort((left, right) => left - right)
    : []

  return (
    <>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="text"
            size="icon"
            type="button"
            className="rounded-sm"
            disabled={!available}
            aria-label={tooltip}
            onClick={(event) => {
              event.stopPropagation()
              openDialog()
            }}
          >
            <ScanLine />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>

      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) closeDialog()
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Scissors className="size-4" />
              智能镜头分割
            </DialogTitle>
            <DialogDescription className="truncate">
              {target?.element.name ?? '视频片段'} · {formatTime(target?.element.duration ?? 0)}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5">
            <div className="grid gap-4 border-y py-4 sm:grid-cols-[1fr_180px]">
              <label className="grid gap-2 text-sm">
                <span className="flex items-center justify-between">
                  <span>检测灵敏度</span>
                  <span className="tabular-nums text-muted-foreground">{sensitivity}</span>
                </span>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[sensitivity]}
                  disabled={phase === 'applying'}
                  onValueChange={(values) => setSensitivity(values[0])}
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span>最短镜头</span>
                <select
                  className="h-9 rounded-sm border bg-background px-2 text-sm"
                  value={minimumSceneDuration}
                  disabled={phase === 'applying'}
                  onChange={(event) => setMinimumSceneDuration(Number(event.target.value))}
                >
                  <option value={0.3}>0.3 秒</option>
                  <option value={0.5}>0.5 秒</option>
                  <option value={0.8}>0.8 秒</option>
                  <option value={1}>1.0 秒</option>
                  <option value={1.5}>1.5 秒</option>
                </select>
              </label>
            </div>

            {(phase === 'analyzing' || phase === 'applying') && (
              <div className="grid gap-2" role="status">
                <div className="flex items-center justify-between text-sm">
                  <span>{phase === 'applying' ? '正在逐帧校准切点' : '正在分析镜头'}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {Math.round(progress * 100)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="h-full bg-primary transition-[width] duration-150"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {analysis && phase !== 'analyzing' && (
              <div className="grid gap-3">
                <div className="flex items-center justify-between text-sm">
                  <span>
                    {boundaries.length
                      ? `检测到 ${boundaries.length} 个切点，将生成 ${boundaries.length + 1} 个片段`
                      : '当前设置下没有检测到镜头切点'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {analysis.sampleFps.toFixed(1)} fps
                  </span>
                </div>
                <ScenePreview duration={target?.element.duration ?? 0} cuts={relativeCuts} />
                {relativeCuts.length > 0 && (
                  <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
                    {relativeCuts.map((time, index) => (
                      <span
                        key={`${time}-${index}`}
                        className="rounded-sm border bg-muted/40 px-2 py-1 text-xs tabular-nums"
                      >
                        {formatTime(time)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div
                className="flex items-start gap-2 border-l-2 border-destructive pl-3 text-sm text-destructive"
                role="alert"
              >
                <X className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t pt-4">
              {(phase === 'error' || phase === 'ready') && target && (
                <Button variant="outline" onClick={() => void runAnalysis(target)}>
                  重新检测
                </Button>
              )}
              <Button variant="outline" onClick={closeDialog}>
                {phase === 'analyzing' || phase === 'applying' ? '取消处理' : '取消'}
              </Button>
              <Button
                disabled={phase !== 'ready' || boundaries.length === 0}
                onClick={() => void applySplit()}
              >
                <Scissors className="size-4" />
                应用分割
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
