import { useEffect, useRef, useState } from 'react'
import { Activity, Check, ImagePlus, Sparkles, Video } from 'lucide-react'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { useEditor } from '@/hooks/use-editor'
import { processMediaAssets } from '@/lib/media/processing'
import { getMediaTypeFromFile } from '@/lib/media/media-utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { request } from './bridge'
import { MediaUpload } from './MediaUpload'
import type { GenerationPosition } from './text-to-video'

type Field = { name: string; default: unknown; options?: string[] }
type Module = { id: string; nodeType: string; fields: Field[] }
const imageAccept = 'image/png,image/jpeg,image/webp,image/bmp,image/gif'
const colors = ['蓝', '红', '绿', '品红（紫）', '青', '黄']
const imageIdsBySlot = (values: Record<string, unknown>): string[] => {
  const images = (values.character_images ?? []) as string[]
  const slots = values.character_slots as number[] | undefined
  return colors.map((_, index) => images[slots ? slots.indexOf(index) : index] ?? '')
}

export function MotionTransferDialog({ open, onOpenChange, position, draftId, initialValues, busy, generationError, onSave, onGenerate }: {
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
  const form = useRef<HTMLFormElement>(null)
  const uploadRequest = useRef(0)
  const keyWrites = useRef<Promise<unknown>>(Promise.resolve())
  const [module, setModule] = useState<Module | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const disabled = loading || busy || Boolean(uploading) || preparing
  const video = editor.media.getAssets().find(asset => asset.id === values.source_video && asset.type === 'video')
  const imageIds = imageIdsBySlot(values)

  useEffect(() => {
    if (!open) return
    let active = true
    setValues({ ...initialValues, task_type: 'MotionTransfer', seed: -1, enhance_prompt: 'off' })
    setModule(null)
    setLoading(true)
    setUploading('')
    setPreparing(false)
    setError(generationError ?? '')
    void Promise.all([request<Module[]>('capcut:workflows' as never),
      keyWrites.current.catch(() => {}).then(() => request<{ key: string }>('capcut:motion-transfer-key:get' as never))
    ]).then(([modules, saved]) => {
      if (!active) return
      const connected = modules.find(item => item.nodeType === 'CapCutMotionTransferWorkflow')
      if (!connected) throw new Error('请在 ComfyUI 画布将“CapCut MiniMax H3 动作迁移”连接到主控台，再打开面板。')
      setModule(connected)
      setValues({ ...Object.fromEntries(connected.fields.map(field => [field.name, field.default])), ...initialValues,
        task_type: 'MotionTransfer', seed: -1, enhance_prompt: 'off', prompt_api_key: saved.key })
    }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; uploadRequest.current++ }
  }, [open, draftId])

  const update = (name: string, value: unknown) => setValues(previous => ({ ...previous, [name]: value }))
  const saveKey = () => {
    const key = String(values.prompt_api_key ?? '').trim()
    const write = keyWrites.current.catch(() => {}).then(() => request('capcut:motion-transfer-key:set' as never, { key }))
    keyWrites.current = write
    return write
  }
  const updateImage = (slot: number, id: string) => setValues(previous => {
    const ids = imageIdsBySlot(previous)
    ids[slot] = id
    const selected = ids.flatMap((assetId, index) => assetId ? [{ assetId, index }] : [])
    return { ...previous, character_images: selected.map(item => item.assetId), character_slots: selected.map(item => item.index) }
  })
  const upload = async (file: File, slot?: number) => {
    const kind = slot === undefined ? 'video' : 'image'
    const label = slot === undefined ? '驱动视频' : `图 ${slot + 1}`
    if (getMediaTypeFromFile({ file }) !== kind) { setError(`请选择${label}文件`); return }
    const current = ++uploadRequest.current
    const projectId = editor.project.getActive().metadata.id
    setUploading(label)
    setError('')
    try {
      const [asset] = await processMediaAssets({ files: [file] })
      if (!asset || asset.type !== kind) throw new Error(`无法读取${label}，请重新上传`)
      if (current !== uploadRequest.current) return
      const id = await editor.media.addMediaAsset({ projectId, asset })
      if (current !== uploadRequest.current) return
      if (!editor.media.getAssets().some(asset => asset.id === id)) throw new Error('素材保存失败，请重新上传')
      if (slot === undefined) setValues(previous => ({ ...previous, source_video: id, duration: asset.duration ?? 5 }))
      else updateImage(slot, id)
    } catch (error) { if (current === uploadRequest.current) setError((error as Error).message) }
    finally { if (current === uploadRequest.current) setUploading('') }
  }
  const complete = async (generate = false) => {
    if (disabled || !module || !form.current?.reportValidity()) return
    if (generate) {
      if (!video) { setError('请先上传驱动视频'); return }
      if (!imageIds.some(Boolean)) { setError('请至少上传一张角色参考图'); return }
      if (imageIds.some(id => id && !editor.media.getAssets().some(asset => asset.id === id && asset.type === 'image'))) {
        setError('角色参考图已移除，请重新上传'); return
      }
    }
    const current = uploadRequest.current
    setPreparing(true)
    setError('')
    try {
      await saveKey()
      if (current !== uploadRequest.current) return
      let audio_mode = 'source'
      if (generate && video) {
        const input = new Input({ source: new BlobSource(video.file), formats: ALL_FORMATS })
        try { audio_mode = await input.getPrimaryAudioTrack() ? 'source' : 'mute' }
        finally { input.dispose() }
      }
      if (current !== uploadRequest.current) return
      const key = String(values.prompt_api_key ?? '').trim()
      const parameters = { ...values, task_type: 'MotionTransfer', seed: -1, enhance_prompt: key ? 'on' : 'off',
        prompt_api_key: key, prompt: '', audio_mode }
      if (generate) onGenerate(module.id, parameters)
      else onSave(parameters)
      onOpenChange(false)
    } catch (error) { if (current === uploadRequest.current) setError((error as Error).message) }
    finally { if (current === uploadRequest.current) setPreparing(false) }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="text-to-video-dialog">
    <DialogHeader><DialogTitle><Activity size={18} />动作迁移</DialogTitle><DialogDescription>AI {position.trackIndex + 1} · 从 {position.startTime.toFixed(2)} 秒开始。上传角色图，沿用驱动视频的动作与站位。</DialogDescription></DialogHeader>
    <form ref={form} className="text-to-video-form" onSubmit={event => { event.preventDefault(); void complete(true) }}>
      <fieldset disabled={disabled}>
        <div className="image-to-video-input">
          <span>驱动视频</span>
          <MediaUpload accept="video/*" label={`${video ? '更换' : '上传'}驱动视频`} disabled={disabled} onFileSelected={file => void upload(file)}>
            {video?.thumbnailUrl ? <img src={video.thumbnailUrl} alt="驱动视频预览" /> : <Video size={28} />}
            <span>{uploading === '驱动视频' ? '正在保存素材…' : `点击或拖拽${video ? '更换' : '上传'}`}</span>
          </MediaUpload>
          {video && <video className="reference-media-preview" aria-label="驱动视频播放" src={video.url} controls preload="metadata" />}
          {(video || values.source_video) && <div className="image-to-video-caption"><small>{video?.name ?? '素材已移除，请重新上传'}</small><button type="button" onClick={() => update('source_video', '')}>移除</button></div>}
        </div>
        <div className="text-to-video-grid">{colors.map((color, index) => {
          const asset = editor.media.getAssets().find(asset => asset.id === imageIds[index] && asset.type === 'image')
          return <div key={index} className="image-to-video-input">
            <span>图 {index + 1} · {color}色角色</span>
            <MediaUpload accept={imageAccept} label={`${asset ? '更换' : '上传'}图 ${index + 1}`} disabled={disabled} onFileSelected={file => void upload(file, index)}>
              {asset ? <img src={asset.url ?? asset.thumbnailUrl} alt={`图 ${index + 1}预览`} /> : <ImagePlus size={28} />}
              <span>{uploading === `图 ${index + 1}` ? '正在保存素材…' : `点击或拖拽${asset ? '更换' : '上传'}`}</span>
            </MediaUpload>
            {(asset || imageIds[index]) && <div className="image-to-video-caption"><small>{asset?.name ?? '素材已移除，请重新上传'}</small><button type="button" onClick={() => updateImage(index, '')}>移除</button></div>}
          </div>
        })}</div>
        <small>按需要上传角色图；空位保留对应关系。提示词自动生成，每次使用随机种子。</small>
        <label>API Key<input aria-label="API Key" type="password" autoComplete="off" value={String(values.prompt_api_key ?? '')}
          onChange={event => update('prompt_api_key', event.target.value)}
          onBlur={() => { void saveKey().catch(() => setError('Key 保存失败，请重新保存')) }} />
          <small>填写后使用原工作流自动看图并编排提示词；留空使用角色模板。Key 单独保存在本机。</small>
        </label>
        <div className="text-to-video-grid">
          <label>时长（秒）<input aria-label="时长（秒）" type="number" step="any" required value={String(values.duration ?? 5)} onChange={event => update('duration', event.target.value)} /></label>
          <label>视频比例<select aria-label="视频比例" value={String(values.aspect_ratio ?? '')} onChange={event => update('aspect_ratio', event.target.value)}>{(module?.fields.find(field => field.name === 'aspect_ratio')?.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}</select></label>
          <label>分辨率（百万像素 / MP）<input aria-label="分辨率（百万像素 / MP）" type="number" step="any" required value={String(values.megapixels ?? 0.4)} onChange={event => update('megapixels', event.target.value)} /></label>
        </div>
      </fieldset>
      {error && <p role="alert" className="text-to-video-error">{error}</p>}
      <div className="text-to-video-actions"><span role="status">{loading ? '正在读取工作流…' : uploading ? '正在保存素材…' : preparing ? '正在准备生成…' : busy ? '正在生成，关闭后可在轨道查看进度。' : 'MiniMax H3 动作迁移'}</span><div>
        <button type="submit" disabled={disabled || !module}><Sparkles size={15} />{busy ? '生成中…' : '生成'}</button>
        <button type="button" disabled={disabled || !module} onClick={() => void complete()}><Check size={15} />完成</button>
      </div></div>
    </form>
  </DialogContent></Dialog>
}
