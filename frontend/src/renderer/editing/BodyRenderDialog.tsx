import { useEffect, useRef, useState } from 'react'
import { Box, Check, Sparkles, Video } from 'lucide-react'
import { useEditor } from '@/hooks/use-editor'
import { processMediaAssets } from '@/lib/media/processing'
import { getMediaTypeFromFile } from '@/lib/media/media-utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { request } from './bridge'
import { MediaUpload } from './MediaUpload'
import type { GenerationPosition } from './text-to-video'

type Module = { id: string; nodeType: string; fields: Array<{ name: string; default: unknown }> }

export function BodyRenderDialog({ mode, open, onOpenChange, position, draftId, initialValues, busy, generationError, onSave, onGenerate }: {
  mode: 'BodyRender' | 'RelayVSR'
  open: boolean
  onOpenChange: (open: boolean) => void
  position: GenerationPosition
  draftId?: string
  initialValues?: Record<string, unknown>
  busy: boolean
  generationError?: string
  onSave: (values: Record<string, unknown>) => void
  onGenerate: (moduleId: string, values: Record<string, unknown>) => void
}) {
  const editor = useEditor()
  const uploadRequest = useRef(0)
  const [module, setModule] = useState<Module | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const disabled = loading || busy || uploading
  const relayVSR = mode === 'RelayVSR'
  const title = relayVSR ? 'Relay VSR 视频放大' : '视频转白模'
  const nodeType = relayVSR ? 'CapCutRelayVSRWorkflow' : 'CapCutBodyRenderWorkflow'
  const videoAssets = editor.media.getAssets().filter(asset => asset.type === 'video')
  const asset = videoAssets.find(asset => asset.id === values.source_video)

  useEffect(() => {
    if (!open) return
    let active = true
    setValues({ ...initialValues, task_type: mode, ...(!relayVSR && { output_mode: 'colored' }) })
    setModule(null)
    setLoading(true)
    setUploading(false)
    setError(generationError ?? '')
    void request<Module[]>('capcut:workflows' as never).then(modules => {
      if (!active) return
      const connected = modules.find(item => item.nodeType === nodeType)
      if (!connected) throw new Error(`请在 ComfyUI 画布将“CapCut ${relayVSR ? title : '人体白模渲染'}”连接到主控台，再打开面板。`)
      setModule(connected)
      setValues({ ...Object.fromEntries(connected.fields.map(field => [field.name, field.default])), ...initialValues,
        task_type: mode, ...(!relayVSR && { output_mode: 'colored' }) })
    }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; uploadRequest.current++ }
  }, [open, draftId, mode])

  const upload = async (file: File) => {
    if (getMediaTypeFromFile({ file }) !== 'video') { setError('请选择视频文件'); return }
    const current = ++uploadRequest.current
    const projectId = editor.project.getActive().metadata.id
    setUploading(true)
    setError('')
    try {
      const [asset] = await processMediaAssets({ files: [file] })
      if (!asset || asset.type !== 'video') throw new Error('无法读取视频，请重新上传')
      if (current !== uploadRequest.current) return
      const id = await editor.media.addMediaAsset({ projectId, asset })
      if (current !== uploadRequest.current) return
      if (!editor.media.getAssets().some(asset => asset.id === id)) throw new Error('素材保存失败，请重新上传')
      setValues(previous => ({ ...previous, source_video: id, duration: asset.duration ?? 5 }))
    } catch (error) { if (current === uploadRequest.current) setError((error as Error).message) }
    finally { if (current === uploadRequest.current) setUploading(false) }
  }
  const complete = (generate = false) => {
    if (disabled || !module) return
    if ((generate || relayVSR) && !asset) { setError('请先上传原视频'); return }
    const detail = Number(values.detail)
    if (relayVSR && (values.detail === '' || !Number.isFinite(detail) || detail < 0 || detail > 1)) {
      setError('细节需填写 0 到 1 之间的数字')
      return
    }
    try {
      const parameters = { ...values, task_type: mode, ...(relayVSR ? { detail } : { output_mode: 'colored' }), duration: asset?.duration ?? values.duration ?? 5 }
      if (generate) onGenerate(module.id, parameters)
      else onSave(parameters)
      onOpenChange(false)
    } catch (error) { setError((error as Error).message) }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="text-to-video-dialog">
    <DialogHeader><DialogTitle><Box size={18} />{title}</DialogTitle><DialogDescription>AI {position.trackIndex + 1} · 从 {position.startTime.toFixed(2)} 秒开始。{relayVSR ? '选择放大倍率并设置细节。' : '描述视频中需要跟踪的人物。'}</DialogDescription></DialogHeader>
    <form className="text-to-video-form" onSubmit={event => { event.preventDefault(); complete(true) }}>
      <fieldset disabled={disabled}>
        <div className="image-to-video-input">
          <span>原视频</span>
          {relayVSR && videoAssets.length > 0 && <label>工程素材<select value={asset?.id ?? ''} onChange={event => {
            const id = event.target.value
            setValues(previous => ({ ...previous, source_video: id }))
            setError('')
          }}><option value="">选择视频</option>{videoAssets.map(video => <option key={video.id} value={video.id}>{video.name}</option>)}</select></label>}
          <MediaUpload accept="video/*" label={`${asset ? '更换' : '上传'}原视频`} disabled={disabled} onFileSelected={file => void upload(file)}>
            {asset?.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="原视频预览" /> : <Video size={28} />}
            <span>{uploading ? '正在保存素材…' : `点击或拖拽${asset ? '更换' : '上传'}`}</span>
          </MediaUpload>
          {asset && <video className="reference-media-preview" aria-label="原视频播放" src={asset.url} controls preload="metadata" />}
          {(asset || values.source_video) && <div className="image-to-video-caption"><small>{asset?.name ?? '素材已移除，请重新上传'}</small><button type="button" onClick={() => setValues(previous => ({ ...previous, source_video: '' }))}>移除</button></div>}
        </div>
        {relayVSR && <>
          <label>放大倍率<select value={String(values.scale ?? 'x2')} onChange={event => setValues(previous => ({ ...previous, scale: event.target.value }))}>
            <option value="x2">X2</option>
            <option value="x4">X4</option>
          </select></label>
          <label>细节<input type="number" min={0} max={1} step={0.01} required value={String(values.detail ?? '')}
            onChange={event => setValues(previous => ({ ...previous, detail: event.target.value }))} /></label>
        </>}
        {!relayVSR && <label>提示词<textarea aria-label="提示词" rows={3} value={String(values.subject_prompt ?? '')} onChange={event => setValues(previous => ({ ...previous, subject_prompt: event.target.value }))} /><small>描述需要跟踪的人物，例如 person 或 man on the left，建议英文。</small></label>}
      </fieldset>
      {error && <p role="alert" className="text-to-video-error">{error}</p>}
      <div className="text-to-video-actions"><span role="status">{loading ? '正在读取工作流…' : uploading ? '正在保存素材…' : busy ? '正在生成，关闭后可在轨道查看进度。' : title}</span><div>
        <button type="submit" disabled={disabled || !module}><Sparkles size={15} />{busy ? '生成中…' : '生成'}</button>
        <button type="button" disabled={disabled || !module} onClick={() => complete()}><Check size={15} />完成</button>
      </div></div>
    </form>
  </DialogContent></Dialog>
}
