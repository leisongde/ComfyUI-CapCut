import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Check, ImagePlus, Music, RefreshCw, Sparkles, Video } from 'lucide-react'
import { useEditor } from '@/hooks/use-editor'
import { processMediaAssets } from '@/lib/media/processing'
import { getMediaTypeFromFile } from '@/lib/media/media-utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { request } from './bridge'
import { MediaUpload } from './MediaUpload'
import { PromptEditor, type PromptReference } from './PromptEditor'
import type { GenerationMode, GenerationPosition } from './text-to-video'

type Field = { name: string; label: string; default: unknown; options?: Array<string | { value: string; label: string }> }
type Module = { id: string; nodeType: string; fields: Field[] }
type MediaField = { name: string; label: string; kind: 'image' | 'video' | 'audio'; accept: string; index?: number; description?: string }
const selectionFields = ['prompt_skill', 'prompt_director', 'prompt_intensity', 'prompt_model']
const imageAccept = 'image/png,image/jpeg,image/webp,image/bmp,image/gif'
const mediaLabels = { image: '图片', video: '视频', audio: '音频' }
const referenceGroups = [
  { name: 'ref_images', label: '参考图片', kind: 'image', tag: 'Picture', limit: 9, accept: imageAccept },
  { name: 'ref_audios', label: '参考音频', kind: 'audio', tag: 'Audio', limit: 3, accept: 'audio/*' },
  { name: 'ref_videos', label: '参考视频', kind: 'video', tag: 'Video', limit: 3, accept: 'video/*' }
] as const
const frameFields = [
  { name: 'first_frame', label: '首帧图片', description: '视频的起始画面。' },
  { name: 'last_frame', label: '尾帧图片', description: '视频的结束画面。' }
] as const

export function TextToVideoDialog({ open, onOpenChange, mode, position, draftId, initialValues, busy, generationError, onSave, onGenerate }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: Exclude<GenerationMode, 'CharacterSwap' | 'BodyRender' | 'MotionTransfer'>
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
  const [uploading, setUploading] = useState(false)
  const [module, setModule] = useState<Module | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false), [loadingModels, setLoadingModels] = useState(false)
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const keyWrites = useRef<Promise<unknown>>(Promise.resolve())
  const modelRequest = useRef(0)
  const referenceEdit = mode === 'V2VARef'
  const videoEdit = mode === 'V2VA' || referenceEdit
  const enhancementEnabled = values.enhance_prompt !== 'off'
  const title = { T2VA: '文生视频', I2VA: '图生视频', FL2VA: '首尾帧生视频', Ref2VA: '多参考生视频', V2VA: '视频编辑', V2VARef: '视频+参考修改' }[mode]
  const frames: MediaField[] = frameFields.filter(field => (mode === 'I2VA' || mode === 'FL2VA') && (field.name === 'first_frame' || mode === 'FL2VA'))
    .map(field => ({ ...field, kind: 'image', accept: imageAccept }))
  const referenceUploads = referenceGroups.filter(group => mode === 'Ref2VA' || (referenceEdit && group.kind !== 'video')).map(group => {
    const ids = Array.isArray(values[group.name]) ? values[group.name] as string[] : []
    return { label: `${group.label}（${ids.length}/${group.limit}）`, description: `依次添加，移除后编号顺延；提示词使用 <${group.tag} 1> 等编号。`,
      fields: Array.from({ length: ids.length < group.limit ? ids.length + 1 : ids.length }, (_, index) => ({ ...group, index, label: `${mediaLabels[group.kind]} ${index + 1}` })) }
  })
  const uploadGroups: Array<{ label?: string; description?: string; fields: MediaField[] }> = videoEdit
    ? [{ label: referenceEdit ? '原始视频' : undefined, description: referenceEdit ? '上传需要修改的原始视频，提示词中用 <Video 1> 引用；下方可添加参考图片和音频。' : '上传待编辑的视频，在提示词中描述需要修改的内容。',
      fields: [{ name: 'ref_videos', index: 0, label: '视频 1', kind: 'video', accept: 'video/*' }] }, ...referenceUploads]
    : referenceUploads.length ? referenceUploads : frames.length ? [{ fields: frames }] : []
  const mediaId = (field: MediaField) => field.index === undefined ? values[field.name] : (values[field.name] as string[] | undefined)?.[field.index]
  const references: PromptReference[] = uploadGroups.flatMap(group => group.fields).flatMap(field => {
    const media = editor.media.getAssets().find(asset => asset.id === mediaId(field) && asset.type === field.kind)
    return media ? [{ kind: field.kind === 'image' ? 'Picture' : field.kind === 'video' ? 'Video' : 'Audio',
      number: field.index === undefined ? (field.name === 'last_frame' ? 2 : 1) : field.index + 1,
      name: media.name, thumbnail: field.kind === 'image' ? media.url ?? media.thumbnailUrl : media.thumbnailUrl }] : []
  })

  useEffect(() => {
    if (!open) return
    let active = true
    modelRequest.current++
    setLoadingModels(false)
    setUploading(false)
    setModels([])
    setValues({ enhance_prompt: 'on', ...initialValues, task_type: mode })
    setModule(null)
    setLoading(true)
    setError(generationError ?? '')
    void Promise.all([request<Module[]>('capcut:workflows' as never),
      keyWrites.current.catch(() => {}).then(() => request<{ key: string }>('capcut:minimax-key:get' as never))
    ]).then(([modules, saved]) => {
      if (!active) return
      const connected = modules.find(item => item.nodeType === 'CapCutMiniMaxH3Workflow')
      setModule(connected ?? null)
      if (!connected) throw new Error('请在 ComfyUI 画布将“CapCut MiniMax H3 生视频”连接到主控台，再打开面板。')
      setValues({ ...Object.fromEntries(connected.fields.map(field => [field.name, field.default])), ...(videoEdit ? { prompt: '' } : {}), system_prompt: '不要背景音乐', enhance_prompt: 'on', ...initialValues, task_type: mode, prompt_api_key: saved.key })
    }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; uploadRequest.current++; modelRequest.current++ }
  }, [open, draftId, mode])

  const field = (name: string) => module?.fields.find(item => item.name === name)
  const update = (name: string, value: unknown) => setValues(previous => ({ ...previous, [name]: value }))
  const updateMedia = (field: MediaField, id: string) => setValues(previous => {
    if (field.index === undefined) return { ...previous, [field.name]: id }
    const ids = Array.isArray(previous[field.name]) ? [...previous[field.name] as string[]] : []
    if (id) ids[field.index] = id
    else ids.splice(field.index, 1)
    return { ...previous, [field.name]: ids }
  })
  const uploadMedia = async (file: File, field: MediaField) => {
    const label = mediaLabels[field.kind]
    if (getMediaTypeFromFile({ file }) !== field.kind) { setError(`请上传${label}文件`); return }
    const current = ++uploadRequest.current
    const projectId = editor.project.getActive().metadata.id
    setUploading(true)
    setError('')
    try {
      const [asset] = await processMediaAssets({ files: [file] })
      if (!asset || asset.type !== field.kind) throw new Error(`无法读取${label}，请重新选择文件`)
      if (current !== uploadRequest.current) return
      const id = await editor.media.addMediaAsset({ projectId, asset })
      if (!editor.media.getAssets().some(item => item.id === id)) throw new Error(`${label}保存失败，请重新上传`)
      if (current === uploadRequest.current) updateMedia(field, id)
    } catch (error) { if (current === uploadRequest.current) setError((error as Error).message) }
    finally { if (current === uploadRequest.current) setUploading(false) }
  }
  const refreshModels = async (automatic = false) => {
    const key = String(values.prompt_api_key ?? '').trim()
    if (!enhancementEnabled || !key || !module) return
    const current = ++modelRequest.current
    setLoadingModels(true)
    if (!automatic) setError('')
    try {
      const options = await request<string[]>('capcut:workflow-models' as never, { id: module.id, key })
      if (current !== modelRequest.current) return
      setModels(options)
      setValues(previous => ({ ...previous, prompt_model: options.includes(String(previous.prompt_model)) ? previous.prompt_model : options[0] }))
    } catch (error) {
      if (current === modelRequest.current) setError((error as Error).message)
    } finally { if (current === modelRequest.current) setLoadingModels(false) }
  }

  useEffect(() => {
    if (open && !loading && module && enhancementEnabled) void refreshModels(true)
  }, [loading, module, enhancementEnabled])

  const saveKey = () => {
    const key = String(values.prompt_api_key ?? '').trim()
    const write = keyWrites.current.catch(() => {}).then(() => request('capcut:minimax-key:set' as never, { key }))
    keyWrites.current = write
    return write
  }
  const complete = async (generate = false) => {
    if (busy) { onOpenChange(false); return }
    const numbers = form.current?.querySelectorAll<HTMLInputElement>('input[type="number"]') ?? []
    if ([...numbers].some(input => !input.reportValidity())) return
    if (generate && !module) return
    if (generate) {
      if (!String(values.prompt ?? '').trim()) { setError('请填写提示词'); form.current?.querySelector<HTMLElement>('.prompt-editor')?.focus(); return }
      const selected = uploadGroups.flatMap(group => group.fields).filter(field => (videoEdit && field.name === 'ref_videos') || field.index === undefined || mediaId(field))
      if (mode === 'Ref2VA' && !selected.length) { setError('请至少上传一项参考图片、音频或视频'); return }
      for (const field of selected) if (!editor.media.getAssets().some(asset => asset.id === mediaId(field) && asset.type === field.kind)) {
        setError(`请先上传${field.label}`); return
      }
    }
    setSavingKey(true)
    setError('')
    try {
      await saveKey()
      if (generate) onGenerate(module!.id, values)
      else onSave(values)
      onOpenChange(false)
    } catch (error) { setError(`保存失败：${(error as Error).message}`) }
    finally { setSavingKey(false) }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="text-to-video-dialog" onEscapeKeyDown={event => {
    if (form.current?.querySelector('.prompt-editor[aria-expanded="true"]')) event.preventDefault()
  }}>
    <DialogHeader><DialogTitle>{mode === 'T2VA' ? <Sparkles size={18} /> : videoEdit ? <Video size={18} /> : <ImagePlus size={18} />}{title}</DialogTitle><DialogDescription>AI {position.trackIndex + 1} · 从 {position.startTime.toFixed(2)} 秒开始。完成可先保存 AI 片段，生成时会在视频轨道预留位置。</DialogDescription></DialogHeader>
    <form ref={form} className="text-to-video-form" onSubmit={event => { event.preventDefault(); if (module && !busy && !savingKey) void complete(true) }}>
      <fieldset disabled={loading || busy || savingKey || uploading}>
        {uploadGroups.map((group, groupIndex) => <div key={groupIndex} className="generation-media-group">
          {group.label && <strong>{group.label}</strong>}
          {group.description && <small>{group.description}</small>}
          {mode === 'FL2VA' && <div className="frame-swap-actions"><button type="button" disabled={!values.first_frame && !values.last_frame}
            title="交换左右图片，只有一张时移到另一侧" onClick={() => setValues(previous => ({ ...previous, first_frame: previous.last_frame ?? '', last_frame: previous.first_frame ?? '' }))}>
            <ArrowLeftRight size={14} />交换首尾帧
          </button></div>}
          <div className={mode === 'Ref2VA' || (referenceEdit && group.fields[0]?.kind !== 'video') ? 'reference-media-grid' : mode === 'FL2VA' ? 'text-to-video-grid' : undefined}>{group.fields.map(field => {
          const media = editor.media.getAssets().find(asset => asset.id === mediaId(field) && asset.type === field.kind)
          const label = mediaLabels[field.kind]
          const Icon = field.kind === 'image' ? ImagePlus : field.kind === 'audio' ? Music : Video
          return <div key={`${field.name}-${field.index ?? ''}`} className="image-to-video-input">
            <span>{field.label}</span>
            <MediaUpload accept={field.accept} label={`${media ? '更换' : '上传'}${field.label}`} disabled={loading || busy || savingKey || uploading} onFileSelected={file => void uploadMedia(file, field)}>
              {media && (field.kind === 'image' || media.thumbnailUrl) ? <img src={field.kind === 'image' ? media.url ?? media.thumbnailUrl : media.thumbnailUrl} alt={`${field.label}预览`} /> : <Icon size={28} />}
              <span>{uploading ? '正在保存素材…' : `${media ? '点击或拖拽更换' : '点击或拖拽上传'}${label}`}</span>
            </MediaUpload>
            {media && field.kind === 'audio' && <audio className="reference-media-preview" aria-label={`${field.label}试听`} src={media.url} controls preload="metadata" />}
            {media && field.kind === 'video' && <video className="reference-media-preview" aria-label={`${field.label}播放`} src={media.url} controls preload="metadata" />}
            {(media || mediaId(field)) && <div className="image-to-video-caption"><small>{media?.name ?? '素材已移除'}</small><button type="button" aria-label={`移除${field.label}`} onClick={() => updateMedia(field, '')}>移除{label}</button></div>}
            <small>{!media && mediaId(field) ? '原素材已从素材库移除，请重新上传。' : field.description}</small>
          </div>
        })}</div></div>)}
        <label>系统提示词<textarea aria-label="系统提示词" rows={2} value={String(values.system_prompt ?? '')} onChange={event => update('system_prompt', event.target.value)} /></label>
        <PromptEditor value={String(values.prompt ?? '')} references={references} disabled={loading || busy || savingKey || uploading} onChange={value => update('prompt', value)} />
        <label>提示词增强<select aria-label="提示词增强" value={enhancementEnabled ? 'on' : 'off'} onChange={event => {
          modelRequest.current++
          setLoadingModels(false)
          setError('')
          update('enhance_prompt', event.target.value)
        }}><option value="on">开启（自动优化提示词）</option><option value="off">关闭（直接使用提示词）</option></select>
          <small>关闭后，直接使用上方填写的系统提示词和提示词。</small>
        </label>
        {enhancementEnabled && <div className="text-to-video-grid">{selectionFields.map(name => {
          const options = name === 'prompt_model' && models.length ? [...models] : [...field(name)?.options ?? []]
          const selected = String(values[name] ?? '')
          if (selected && !options.some(option => (typeof option === 'string' ? option : option.value) === selected)) options.push(selected)
          return <label key={name}>{field(name)?.label ?? ({ prompt_skill: 'Skill', prompt_director: '导演', prompt_intensity: '动作强度', prompt_model: '模型' }[name])}
          <select aria-label={field(name)?.label ?? name} value={String(values[name] ?? '')} disabled={name === 'prompt_model' && loadingModels} onChange={event => update(name, event.target.value)}>
            {options.map(option => <option key={typeof option === 'string' ? option : option.value} value={typeof option === 'string' ? option : option.value}>{typeof option === 'string' ? option : option.label}</option>)}
          </select>
        </label>})}</div>}
        <label>提示词模式<input aria-label="提示词模式" value={`${mode} · ${title}`} readOnly /></label>
        <div className="text-to-video-grid">
          <label>时长（秒）<input aria-label="时长（秒）" type="number" min={4} max={15} step="any" required value={String(values.duration ?? 15)} onChange={event => update('duration', event.target.value)} /><small>4–15 秒</small></label>
          <label>画面比例<select aria-label="画面比例" value={String(values.aspect_ratio ?? '')} onChange={event => update('aspect_ratio', event.target.value)}>{field('aspect_ratio')?.options?.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select></label>
        </div>
        <label>分辨率（百万像素 / MP）<input aria-label="分辨率（百万像素 / MP）" type="number" min={0.01} step="any" required value={String(values.megapixels ?? 0.4)} onChange={event => update('megapixels', event.target.value)} /><small>沿用原工作流的分辨率设置，例如 0.4 MP。</small></label>
        {enhancementEnabled && <><label>API Key<input aria-label="API Key" type="password" autoComplete="off" required value={String(values.prompt_api_key ?? '')} onBlur={() => { void saveKey().catch(error => setError(`Key 保存失败：${error.message}`)); void refreshModels() }} onChange={event => {
          modelRequest.current++
          setLoadingModels(false)
          setModels([])
          update('prompt_api_key', event.target.value)
        }} /></label>
        <div className="text-to-video-key"><small>Key 自动保存到当前 ComfyUI 用户的本机配置，下次打开自动填入。</small><button type="button" disabled={loadingModels || !values.prompt_api_key} onMouseDown={event => event.preventDefault()} onClick={() => void refreshModels()}><RefreshCw size={12} />{loadingModels ? '读取中…' : '刷新模型'}</button></div></>}
      </fieldset>
      {error && <p role="alert" className="text-to-video-error">{error}</p>}
      <div className="text-to-video-actions"><span role="status">{loading ? '正在读取工作流选项…' : uploading ? '正在保存素材…' : savingKey ? '正在保存 Key…' : busy ? '正在生成，关闭后可在轨道查看进度。' : 'MiniMax H3'}</span><div>
        <button type="submit" disabled={loading || loadingModels || busy || savingKey || uploading || !module}><Sparkles size={15} />{busy ? '生成中…' : '生成'}</button>
        <button type="button" disabled={loading || savingKey || uploading || !module} onClick={() => void complete()}><Check size={15} />完成</button>
      </div></div>
    </form>
  </DialogContent></Dialog>
}
