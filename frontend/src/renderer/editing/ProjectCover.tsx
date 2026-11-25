import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Pencil, RotateCcw, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@/hooks/use-editor'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CanvasRenderer } from '@/services/renderer/canvas-renderer'
import { buildScene } from '@/services/renderer/scene-builder'
import type { TProject } from '@/types/project'
import type { MediaAsset } from '@/types/assets'
import type { EditingProjectCover } from '../../shared/editing'
import { DEFAULT_COVER_STYLE, coverCanvasBlob, downloadCover, drawProjectCover, type CoverStyle } from './project-cover'

type CoverProject = TProject & { cover?: EditingProjectCover }
type SourceSelection = { kind: 'frame'; time: number } | { kind: 'upload'; file: File } |
  { kind: 'asset'; asset: MediaAsset; origin: 'frame' | 'image'; time?: number }
type CoverSource = { image: CanvasImageSource; width: number; height: number; file?: File; assetId?: string }

function formatFrame(frame: number, fps: number): string {
  const seconds = Math.floor(frame / fps)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60,
    Math.floor(frame - seconds * fps)].map(value => String(value).padStart(2, '0')).join(':')
}

export function ProjectCoverButton() {
  const editor = useEditor()
  const project = editor.project.getActive() as CoverProject
  const [open, setOpen] = useState(false)
  return <>
    <button className="project-cover-button" aria-label="编辑封面" title="编辑封面" onClick={() => {
      editor.playback.pause()
      setOpen(true)
    }}>
      {project.cover && project.metadata.thumbnail
        ? <img src={project.metadata.thumbnail} alt="封面" /> : <Pencil size={15} />}
      <span>封面</span>
    </button>
    {open && <ProjectCoverEditor key={project.metadata.id} onClose={() => setOpen(false)} />}
  </>
}

function ProjectCoverEditor({ onClose }: { onClose: () => void }) {
  const editor = useEditor()
  const project = editor.project.getActive() as CoverProject
  const saved = project.cover
  const { width, height } = project.settings.canvasSize
  const fps = project.settings.fps
  const duration = editor.timeline.getTotalDuration()
  const lastFrame = Math.max(0, Math.ceil(duration * fps) - 1)
  const initialFrame = Math.max(0, Math.min(lastFrame,
    Math.round((saved?.time ?? editor.playback.getCurrentTime()) * fps)))
  const [frame, setFrame] = useState(initialFrame)
  const [tab, setTab] = useState<'frame' | 'image'>(saved?.origin ?? (duration ? 'frame' : 'image'))
  const [selection, setSelection] = useState<SourceSelection | null>(() => {
    const asset = editor.media.getAssets().find(item => item.id === saved?.sourceAssetId)
    if (asset && saved) return { kind: 'asset', asset, origin: saved.origin, time: saved.time }
    return duration && !saved ? { kind: 'frame', time: initialFrame / fps } : null
  })
  const [source, setSource] = useState<CoverSource | null>(null)
  const [style, setStyle] = useState<CoverStyle>(() => {
    if (!saved) return { ...DEFAULT_COVER_STYLE }
    const { sourceAssetId: _source, origin: _origin, time: _time, ...savedStyle } = saved
    return { ...DEFAULT_COVER_STYLE, ...savedStyle }
  })
  const [loading, setLoading] = useState(Boolean(selection))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(saved && !selection ? '封面底图已被删除，请重新选帧或上传图片' : '')
  const preview = useRef<HTMLCanvasElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const renderQueue = useRef<Promise<void>>(Promise.resolve())
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const previewScale = Math.min(1, 960 / Math.max(width, height))

  useEffect(() => {
    if (!selection) return
    let cancelled = false
    let objectUrl: string | undefined
    setLoading(true)
    setSource(null)
    setError('')
    const timer = setTimeout(() => {
      const task = renderQueue.current.then(async () => {
        if (cancelled) return
        let next: CoverSource
        if (selection.kind === 'frame') {
          const node = buildScene({
            tracks: editor.timeline.getTracks(), mediaAssets: editor.media.getAssets(), duration,
            canvasSize: { width, height },
            fitCanvasSize: project.settings.originalCanvasSize ?? { width, height },
            background: project.settings.background
          })
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const renderer = new CanvasRenderer({ width, height, fps, imageSmoothingQuality: 'high' })
          await renderer.renderToCanvas({ node, time: selection.time, targetCanvas: canvas })
          next = { image: canvas, width, height }
        } else {
          const image = new Image()
          const url = selection.kind === 'asset' ? selection.asset.url :
            (objectUrl = URL.createObjectURL(selection.file))
          if (!url) throw new Error('封面图片不可用，请重新选择')
          image.src = url
          await image.decode()
          next = { image, width: image.naturalWidth, height: image.naturalHeight,
            ...(selection.kind === 'asset' ? { assetId: selection.asset.id } : { file: selection.file }) }
        }
        if (!cancelled) setSource(next)
      })
      renderQueue.current = task.catch(() => {})
      void task.catch(error => {
        if (!cancelled) setError(error instanceof Error ? error.message : '封面画面读取失败')
      }).finally(() => { if (!cancelled) setLoading(false) })
    }, selection.kind === 'frame' ? 150 : 0)
    return () => { cancelled = true; clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [selection, editor, width, height, fps, duration, project.settings])

  useEffect(() => {
    if (preview.current && source) drawProjectCover(preview.current, source.image, source, style)
  }, [source, style, width, height])

  const update = (patch: Partial<CoverStyle>) => setStyle(value => ({ ...value, ...patch }))
  const chooseFrame = (value: number) => {
    const next = Math.max(0, Math.min(lastFrame, Math.round(value)))
    setFrame(next)
    setSelection({ kind: 'frame', time: next / fps })
  }
  const renderCover = () => {
    if (!source) throw new Error('请先选择封面画面')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    drawProjectCover(canvas, source.image, source, style)
    return canvas
  }
  const save = async (download: boolean) => {
    if (!source || !selection || loading || saving) return
    setSaving(true)
    setError('')
    try {
      const canvas = renderCover()
      const blob = await coverCanvasBlob(canvas)
      let sourceAssetId = source.assetId
      if (!sourceAssetId) {
        const sourceCanvas = document.createElement('canvas')
        sourceCanvas.width = source.width
        sourceCanvas.height = source.height
        sourceCanvas.getContext('2d')!.drawImage(source.image, 0, 0)
        const file = source.file ?? new File([await coverCanvasBlob(sourceCanvas)],
          `${project.metadata.name}-封面底图.png`, { type: 'image/png' })
        const url = URL.createObjectURL(file)
        try {
          sourceAssetId = await editor.media.addMediaAsset({ projectId: project.metadata.id,
            asset: { type: 'image', name: file.name, file, url, width: source.width, height: source.height } })
        } catch (error) {
          URL.revokeObjectURL(url)
          throw error
        }
        setSource(value => value ? { ...value, assetId: sourceAssetId } : value)
      }
      const cover: EditingProjectCover = { ...style, sourceAssetId,
        origin: selection.kind === 'asset' ? selection.origin : selection.kind === 'frame' ? 'frame' : 'image',
        ...(selection.kind === 'frame' ? { time: selection.time } :
          selection.kind === 'asset' && selection.time !== undefined ? { time: selection.time } : {}) }
      const thumbnail = document.createElement('canvas')
      const scale = 360 / Math.max(width, height)
      thumbnail.width = Math.max(1, Math.round(width * scale))
      thumbnail.height = Math.max(1, Math.round(height * scale))
      thumbnail.getContext('2d')!.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height)
      const active = editor.project.getActive()
      editor.project.setActiveProject({ project: { ...active, cover,
        metadata: { ...active.metadata, thumbnail: thumbnail.toDataURL('image/jpeg', 0.85) } } as CoverProject })
      editor.save.markDirty()
      await editor.save.flush()
      if (download) downloadCover(blob, project.metadata.name)
      toast.success(download ? '封面已保存并下载' : '封面已保存')
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : '封面保存失败')
    } finally { setSaving(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
    <DialogContent className="project-cover-dialog" data-keybinding-free
      onEscapeKeyDown={event => { if (saving) event.preventDefault() }}
      onPointerDownOutside={event => { if (saving) event.preventDefault() }}>
      <DialogHeader><DialogTitle>编辑封面</DialogTitle>
        <DialogDescription>从成片中选取一帧，或上传图片制作封面。保存后可单独下载 PNG 图片。</DialogDescription>
      </DialogHeader>
      <div className="project-cover-body">
        <div className="project-cover-main">
          <div className="project-cover-tabs" role="tablist" aria-label="封面来源">
            <button role="tab" aria-selected={tab === 'frame'} disabled={saving || !duration} onClick={() => {
              setTab('frame'); chooseFrame(frame)
            }}>从视频选帧</button>
            <button role="tab" aria-selected={tab === 'image'} disabled={saving} onClick={() => setTab('image')}>上传图片</button>
          </div>
          <div className="project-cover-stage" style={{ aspectRatio: `${width} / ${height}` }}>
            <canvas ref={preview} width={Math.max(1, Math.round(width * previewScale))}
              height={Math.max(1, Math.round(height * previewScale))} aria-label="封面预览"
              style={{ aspectRatio: `${width} / ${height}`, visibility: source ? 'visible' : 'hidden' }}
              onPointerDown={event => {
                if (!source || loading || saving) return
                event.currentTarget.setPointerCapture(event.pointerId)
                drag.current = { x: event.clientX, y: event.clientY, offsetX: style.offsetX, offsetY: style.offsetY }
              }} onPointerMove={event => {
                if (!drag.current) return
                const rect = event.currentTarget.getBoundingClientRect()
                update({ offsetX: Math.max(-1, Math.min(1, drag.current.offsetX + (event.clientX - drag.current.x) / rect.width)),
                  offsetY: Math.max(-1, Math.min(1, drag.current.offsetY + (event.clientY - drag.current.y) / rect.height)) })
              }} onPointerUp={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }} />
            {(loading || !source) && <div className="project-cover-placeholder" role="status">
              {loading ? '正在读取画面…' : '请选择视频帧或上传封面图片'}
            </div>}
          </div>
          {tab === 'frame' ? <div className="project-cover-frame-controls">
            <input type="range" aria-label="选择封面帧" min={0} max={lastFrame} step={1}
              value={frame} disabled={saving || !duration} onChange={event => chooseFrame(Number(event.target.value))} />
            <div><button aria-label="封面上一帧" disabled={saving || frame === 0} onClick={() => chooseFrame(frame - 1)}><ChevronLeft size={16} /></button>
              <output>{formatFrame(frame, fps)} <span>/ {formatFrame(lastFrame, fps)}</span></output>
              <button aria-label="封面下一帧" disabled={saving || frame === lastFrame} onClick={() => chooseFrame(frame + 1)}><ChevronRight size={16} /></button>
              <button disabled={saving} onClick={() => chooseFrame(editor.playback.getCurrentTime() * fps)}>使用播放头画面</button>
            </div>
          </div> : <div className="project-cover-upload">
            <button disabled={saving} onClick={() => fileInput.current?.click()}><Upload size={15} />选择本地图片</button>
            <span>支持 PNG、JPG、WebP 等图片</span>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) { setSelection({ kind: 'upload', file }); update({ zoom: 1, offsetX: 0, offsetY: 0 }) }
            }} />
          </div>}
        </div>
        <fieldset className="project-cover-settings desktop-settings" disabled={saving}>
          <h3>画面</h3>
          <label>适配方式<select aria-label="封面适配方式" value={style.fit} onChange={event => update({ fit: event.target.value as CoverStyle['fit'] })}>
            <option value="cover">填满画面</option><option value="contain">完整显示</option>
          </select></label>
          <label>缩放 {Math.round(style.zoom * 100)}%<input type="range" aria-label="封面缩放" min={1} max={3} step={0.01} value={style.zoom} onChange={event => update({ zoom: Number(event.target.value) })} /></label>
          <p>在预览中拖动画面调整构图。</p>
          <button className="project-cover-reset" onClick={() => update({ zoom: 1, offsetX: 0, offsetY: 0 })}><RotateCcw size={14} />重置构图</button>
          <h3>标题</h3>
          <textarea aria-label="封面标题" placeholder="输入封面标题，可换行" rows={3} value={style.title} onChange={event => update({ title: event.target.value })} />
          <label>文字颜色<input type="color" aria-label="封面文字颜色" value={style.titleColor} onChange={event => update({ titleColor: event.target.value })} /></label>
          <label>文字大小 {Math.round(style.titleSize * 100)}%<input type="range" aria-label="封面文字大小" min={0.03} max={0.24} step={0.005} value={style.titleSize} onChange={event => update({ titleSize: Number(event.target.value) })} /></label>
          <label>标题水平位置 {Math.round(style.titleX * 100)}%<input type="range" aria-label="封面标题水平位置" min={0.05} max={0.95} step={0.01} value={style.titleX} onChange={event => update({ titleX: Number(event.target.value) })} /></label>
          <label>标题垂直位置 {Math.round(style.titleY * 100)}%<input type="range" aria-label="封面标题垂直位置" min={0.05} max={0.95} step={0.01} value={style.titleY} onChange={event => update({ titleY: Number(event.target.value) })} /></label>
        </fieldset>
      </div>
      {error && <p className="save-error" role="alert">{error}</p>}
      <div className="project-cover-footer export-actions"><span>{width} × {height} · 封面独立保存，不占用时间线时长</span>
        <button disabled={saving} onClick={onClose}>取消</button>
        <button disabled={saving || loading || !source} onClick={() => void save(true)}><Download size={15} />保存并下载</button>
        <button className="primary-button" disabled={saving || loading || !source} onClick={() => void save(false)}>{saving ? '正在保存…' : '保存封面'}</button>
      </div>
    </DialogContent>
  </Dialog>
}
