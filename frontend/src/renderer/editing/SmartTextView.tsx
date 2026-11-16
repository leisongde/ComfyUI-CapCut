import { useEffect, useState } from 'react'
import { AudioLines, CheckCircle2, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'

import { SUBTITLE_TEMPLATES, createSubtitleFromTemplate } from '@/constants/subtitle-constants'
import { useEditor } from '@/hooks/use-editor'
import { extractTimelineAudio } from '@/lib/media/mediabunny'
import type { EditingCaptionRuntimeStatus } from '../../shared/editing'
import { getCaptionRuntimeStatus, transcribeTimelineAudio } from './adapters/caption-transcription'

const INITIAL_STATUS: EditingCaptionRuntimeStatus = {
  modelReady: false,
  busy: false,
  phase: 'idle'
}

const containsAudioSignal = (buffer: ArrayBuffer): boolean => {
  if (buffer.byteLength <= 44) return false
  const view = new DataView(buffer)
  for (let offset = 44; offset + 3 < view.byteLength; offset += 200) {
    if (Math.abs(view.getInt16(offset, true)) > 3 || Math.abs(view.getInt16(offset + 2, true)) > 3)
      return true
  }
  return false
}

const statusText = (status: EditingCaptionRuntimeStatus): string => {
  if (status.detail) return status.detail
  if (status.busy) return '正在处理轨道音频'
  return status.modelReady ? '字幕模型已就绪' : '首次识别将下载字幕模型（约 1.83 GB）'
}

export function SmartTextView() {
  const editor = useEditor()
  const [runtime, setRuntime] = useState<EditingCaptionRuntimeStatus>(INITIAL_STATUS)
  const [processing, setProcessing] = useState(false)
  const [step, setStep] = useState('')
  const [progress, setProgress] = useState<number | undefined>()
  const [error, setError] = useState('')
  const [createdCount, setCreatedCount] = useState(0)

  useEffect(() => {
    let mounted = true
    void getCaptionRuntimeStatus()
      .then((status) => {
        if (mounted) setRuntime(status)
      })
      .catch((reason: unknown) => {
        if (mounted) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!runtime.busy || processing) return
    const timer = window.setInterval(() => {
      void getCaptionRuntimeStatus().then(setRuntime).catch(() => {})
    }, 1000)
    return () => window.clearInterval(timer)
  }, [runtime.busy, processing])

  const recognize = async () => {
    if (processing || runtime.busy) return
    let statusTimer: number | undefined
    try {
      setProcessing(true)
      setCreatedCount(0)
      setError('')
      setStep('正在读取轨道音频')
      setProgress(0)

      const audioBlob = await extractTimelineAudio({
        tracks: editor.timeline.getTracks(),
        mediaAssets: editor.media.getAssets(),
        totalDuration: editor.timeline.getTotalDuration(),
        onProgress: (value) => setProgress(Math.round(value))
      })
      const audioBuffer = await audioBlob.arrayBuffer()
      if (!containsAudioSignal(audioBuffer)) throw new Error('当前时间线没有可识别的音频')

      setStep('正在准备字幕识别')
      setProgress(undefined)
      statusTimer = window.setInterval(() => {
        void getCaptionRuntimeStatus()
          .then((status) => {
            setRuntime(status)
            setStep(statusText(status))
            setProgress(status.progress)
          })
          .catch(() => {})
      }, 500)

      const result = await transcribeTimelineAudio(new Uint8Array(audioBuffer))
      if (!result.segments.length) throw new Error('没有识别到可用语音，请检查轨道声音后重试')

      const timelineDuration = editor.timeline.getTotalDuration()
      const captions = result.segments
        .filter((caption) => caption.startTime < timelineDuration)
        .map((caption) => ({
          ...caption,
          duration: Math.min(caption.duration, timelineDuration - caption.startTime)
        }))
      if (!captions.length) throw new Error('识别结果没有有效的字幕时间段')

      const captionTrackId = editor.timeline.addTrack({ type: 'text', index: 0 })
      const baseCaptionElement = createSubtitleFromTemplate({
        template: SUBTITLE_TEMPLATES[1],
        startTime: 0
      })
      captions.forEach((caption, index) => {
        editor.timeline.insertElement({
          placement: { mode: 'explicit', trackId: captionTrackId },
          element: {
            ...baseCaptionElement,
            name: `自动字幕 ${index + 1}`,
            content: caption.text,
            duration: caption.duration,
            startTime: caption.startTime,
            trimStart: 0,
            trimEnd: 0
          }
        })
      })

      setCreatedCount(captions.length)
      setStep(`已生成 ${captions.length} 条字幕`)
      setProgress(100)
      setRuntime((current) => ({
        ...current,
        modelReady: true,
        busy: false,
        phase: 'complete',
        progress: 100,
        detail: `已识别 ${captions.length} 条字幕`
      }))
      toast.success(`已生成 ${captions.length} 条可编辑字幕`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      setStep('')
      setProgress(undefined)
      toast.error(message)
    } finally {
      if (statusTimer !== undefined) window.clearInterval(statusTimer)
      setProcessing(false)
      void getCaptionRuntimeStatus()
        .then(setRuntime)
        .catch(() => {})
    }
  }

  const isBusy = processing || runtime.busy
  const displayStep = step || statusText(runtime)

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="border-b pb-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AudioLines className="size-4" />
          轨道字幕
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          {isBusy ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : runtime.modelReady ? (
            <CheckCircle2 className="size-3.5 text-emerald-500" />
          ) : (
            <span className="size-2 rounded-full bg-amber-500" />
          )}
          <span>{displayStep}</span>
        </div>
        {progress !== undefined && isBusy ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        ) : null}
        <button
          type="button"
          className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isBusy}
          onClick={() => void recognize()}
        >
          {isBusy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <AudioLines className="size-4" />
          )}
          {isBusy ? '正在识别' : '识别轨道字幕'}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {createdCount > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          字幕已添加到新的文字轨道，可在时间线中继续编辑。
        </p>
      ) : null}
    </div>
  )
}
