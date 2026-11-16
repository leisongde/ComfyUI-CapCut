import { useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@/hooks/use-editor'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import type { ExportQuality } from '@/types/export'
import { request } from './bridge'
import { getDirectorGenerationPlaceholders } from './director-generation-placeholders'
import {
  EDITING_EXPORT_RESOLUTIONS,
  resolveEditingExportCanvasSize,
  type EditingExportResolution
} from '../../shared/editing'

export function ExportDialog() {
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4')
  const [quality, setQuality] = useState<ExportQuality>('high')
  const [resolution, setResolution] = useState<EditingExportResolution>('project')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const cancelled = useRef(false)

  const run = async () => {
    setRunning(true)
    setError('')
    setProgress(0)
    cancelled.current = false
    try {
      if (getDirectorGenerationPlaceholders(editor.timeline.getTracks()).length)
        throw new Error('时间线上还有生成占位，请等待生成完成，或删除失败的占位后再导出。')
      const projectCanvasSize = editor.project.getActive().settings.canvasSize
      const canvasSize = resolveEditingExportCanvasSize(projectCanvasSize, resolution)
      const result = await editor.renderer.exportProject({
        options: {
          format,
          quality,
          canvasSize,
          fps: editor.project.getActive().settings.fps,
          includeAudio: true,
          onProgress: ({ progress }) => setProgress(progress),
          onCancel: () => cancelled.current
        }
      })
      if (result.cancelled) return
      if (!result.success || !result.buffer) throw new Error(result.error || '导出失败')
      const bytes = new Uint8Array(result.buffer)
      const saved = await request<{ canceled: boolean; path?: string }>(
        'export:save',
        { name: editor.project.getActive().metadata.name, format, bytes },
        [bytes.buffer]
      )
      if (!saved.canceled) {
        toast.success('视频已导出')
        setOpen(false)
      }
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <button
        className="primary-button"
        onClick={() => {
          setError('')
          setOpen(true)
        }}
        disabled={editor.timeline.getTotalDuration() === 0 || getDirectorGenerationPlaceholders(editor.timeline.getTracks()).length > 0}
        title={getDirectorGenerationPlaceholders(editor.timeline.getTracks()).length ? '生成占位完成或移除后即可导出' : undefined}
      >
        <Download size={15} />
        导出视频
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!running) setOpen(value)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>导出视频</DialogTitle>
            <DialogDescription>导出当前时间线，保存到本机并下载成片。</DialogDescription>
          </DialogHeader>
          <div className="desktop-settings export-settings">
            <label>
              格式
              <select
                aria-label="导出格式"
                value={format}
                disabled={running}
                onChange={(event) => setFormat(event.target.value as typeof format)}
              >
                <option value="mp4">MP4 · H.264</option>
                <option value="webm">WebM · VP9</option>
              </select>
            </label>
            <label>
              画质
              <select
                aria-label="导出画质"
                value={quality}
                disabled={running}
                onChange={(event) => setQuality(event.target.value as ExportQuality)}
              >
                <option value="low">低 · 文件较小</option>
                <option value="medium">中 · 平衡</option>
                <option value="high">高 · 推荐</option>
                <option value="very_high">最高</option>
              </select>
            </label>
            <label>
              分辨率
              <select
                aria-label="导出分辨率"
                value={resolution}
                disabled={running}
                onChange={(event) => setResolution(event.target.value as EditingExportResolution)}
              >
                {EDITING_EXPORT_RESOLUTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {
                resolveEditingExportCanvasSize(
                  editor.project.getActive().settings.canvasSize,
                  resolution
                ).width
              }{' '}
              ×{' '}
              {
                resolveEditingExportCanvasSize(
                  editor.project.getActive().settings.canvasSize,
                  resolution
                ).height
              }{' '}
              · {editor.project.getActive().settings.fps} fps · 含音频
            </p>
            {running && (
              <div role="status">
                <progress value={progress} max={1} />
                正在导出 {Math.round(progress * 100)}%
              </div>
            )}
            {error && (
              <p className="save-error" role="alert">
                {error}
              </p>
            )}
            <div className="export-actions">
              <button
                onClick={() => {
                  if (running) cancelled.current = true
                  else setOpen(false)
                }}
              >
                {running ? '取消导出' : '取消'}
              </button>
              <button className="primary-button" disabled={running} onClick={() => void run()}>
                开始导出
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
