import { useEffect, useRef, useState } from 'react'
import { Check, ImagePlus, RefreshCw, Sparkles, UserRound, Video } from 'lucide-react'
import { useEditor } from '@/hooks/use-editor'
import { processMediaAssets } from '@/lib/media/processing'
import { getMediaTypeFromFile } from '@/lib/media/media-utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { request } from './bridge'
import { MediaUpload } from './MediaUpload'
import { PromptEditor, type PromptReference } from './PromptEditor'
import type { GenerationPosition } from './text-to-video'

type Field = { name: string; label: string; default: unknown; options?: Array<string | { value: string; label: string }> }
type Module = { id: string; nodeType: string; fields: Field[] }
const selectionFields = ['prompt_skill', 'prompt_director', 'prompt_intensity', 'prompt_model']
const mediaFields = [
  { name: 'source_video', label: '原视频', kind: 'video', accept: 'video/*' },
  { name: 'character_image', label: '替换人物图片', kind: 'image', accept: 'image/png,image/jpeg,image/webp,image/bmp,image/gif' }
] as const

export function CharacterSwapDialog({ open, onOpenChange, position, draftId, initialValues, busy, generationError, onSave, onGenerate }: {
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
  const [module, setModule] = useState<Module | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState('')
  const [error, setError] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const keyWrites = useRef<Promise<unknown>>(Promise.resolve())
  const modelRequest = useRef(0)
  const enhancementEnabled = values.enhance_prompt === 'on'
  const disabled = loading || busy || Boolean(uploading) || savingKey
  const assetFor = (field: typeof mediaFields[number]) => editor.media.getAssets().find(asset => asset.id === values[field.name] && asset.type === field.kind)
  const references: PromptReference[] = mediaFields.flatMap(field => {
    const asset = assetFor(field)
    return asset ? [{ kind: field.kind === 'image' ? 'Picture' : 'Video', number: 1, name: asset.name,
      thumbnail: field.kind === 'image' ? asset.url ?? asset.thumbnailUrl : asset.thumbnailUrl }] : []
  })

  useEffect(() => {
    if (!open) return
    let active = true
    setValues({ ...initialValues, task_type: 'CharacterSwap', start_time: 0 })
    setModule(null)
    setLoading(true)
    setUploading('')
    modelRequest.current++
    setLoadingModels(false)
    setModels([])
    setError(generationError ?? '')
    void Promise.all([request<Module[]>('capcut:workflows' as never),
      keyWrites.current.catch(() => {}).then(() => request<{ key: string }>('capcut:minimax-key:get' as never))
    ]).then(([modules, saved]) => {
      if (!active) return
      const connected = modules.find(item => item.nodeType === 'CapCutMiniMaxH3CharacterSwapWorkflow')
      if (!connected) throw new Error('请在 ComfyUI 画布将“CapCut MiniMax H3 人物替换”连接到主控台，再打开面板。')
      setModule(connected)
      setValues({ ...Object.fromEntries(connected.fields.map(field => [field.name, field.default])), ...initialValues, task_type: 'CharacterSwap', start_time: 0, prompt_api_key: saved.key })
    }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; uploadRequest.current++; modelRequest.current++ }
  }, [open, draftId])

  const update = (name: string, value: unknown) => setValues(previous => ({ ...previous, [name]: value }))
  const upload = async (file: File, field: typeof mediaFields[number]) => {
    if (getMediaTypeFromFile({ file }) !== field.kind) { setError(`请选择${field.label}文件`); return }
    const current = ++uploadRequest.current
    const projectId = editor.project.getActive().metadata.id
    setUploading(field.name)
    setError('')
    try {
      const [asset] = await processMediaAssets({ files: [file] })
      if (!asset || asset.type !== field.kind) throw new Error(`无法读取${field.label}，请重新上传`)
      if (current !== uploadRequest.current) return
      const id = await editor.media.addMediaAsset({ projectId, asset })
      if (!editor.media.getAssets().some(asset => asset.id === id)) throw new Error('素材保存失败，请重新上传')
      if (current === uploadRequest.current) update(field.name, id)
    } catch (error) { if (current === uploadRequest.current) setError((error as Error).message) }
    finally { if (current === uploadRequest.current) setUploading('') }
  }
  const saveKey = () => {
    const key = String(values.prompt_api_key ?? '').trim()
    const write = keyWrites.current.catch(() => {}).then(() => request('capcut:minimax-key:set' as never, { key }))
    keyWrites.current = write
    return write
  }
  const refreshModels = async () => {
    const key = String(values.prompt_api_key ?? '').trim()
    if (!key || !module) return
    const current = ++modelRequest.current
    setLoadingModels(true)
    setError('')
    try {
      const options = await request<string[]>('capcut:workflow-models' as never, { id: module.id, key })
      if (current !== modelRequest.current) return
      setModels(options)
      setValues(previous => ({ ...previous, prompt_model: options.includes(String(previous.prompt_model)) ? previous.prompt_model : options[0] }))
    } catch (error) { if (current === modelRequest.current) setError((error as Error).message) }
    finally { if (current === modelRequest.current) setLoadingModels(false) }
  }
  const complete = async (generate = false) => {
    if (disabled || !module) return
    if (!form.current?.reportValidity()) return
    if (generate) {
      for (const field of mediaFields) if (!assetFor(field)) { setError(`请先上传${field.label}`); return }
      if (!String(values.subject_prompt ?? '').trim()) { setError('请描述原视频中需要被替换的人物'); return }
      if (!String(values.prompt ?? '').trim()) { setError('请填写人物替换提示词'); return }
      if (enhancementEnabled && !String(values.prompt_api_key ?? '').trim()) { setError('请填写 GPT 优化提示词的 API Key'); return }
    }
    setSavingKey(true)
    setError('')
    try {
      await saveKey()
      const parameters = { ...values, task_type: 'CharacterSwap', start_time: 0 }
      if (generate) onGenerate(module.id, parameters)
      else onSave(parameters)
      onOpenChange(false)
    } catch (error) { setError((error as Error).message) }
    finally { setSavingKey(false) }
  }
  const options = (name: string) => module?.fields.find(field => field.name === name)?.options ?? []

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="text-to-video-dialog" onEscapeKeyDown={event => {
    if (form.current?.querySelector('.prompt-editor[aria-expanded="true"]')) event.preventDefault()
  }}>
    <DialogHeader><DialogTitle><UserRound size={18} />人物替换</DialogTitle><DialogDescription>AI {position.trackIndex + 1} · 从 {position.startTime.toFixed(2)} 秒开始。选择替换人物图片，描述原视频中需要被替换的人。</DialogDescription></DialogHeader>
    <form ref={form} className="text-to-video-form" onSubmit={event => { event.preventDefault(); if (!loadingModels) void complete(true) }}>
      <fieldset disabled={disabled}>
        <div className="text-to-video-grid">{mediaFields.map(field => {
          const asset = assetFor(field)
          const Icon = field.kind === 'image' ? ImagePlus : Video
          return <div key={field.name} className="image-to-video-input">
            <span>{field.label}</span>
            <MediaUpload accept={field.accept} label={`${asset ? '更换' : '上传'}${field.label}`} disabled={disabled} onFileSelected={file => void upload(file, field)}>
              {asset && (field.kind === 'image' || asset.thumbnailUrl) ? <img src={field.kind === 'image' ? asset.url ?? asset.thumbnailUrl : asset.thumbnailUrl} alt={`${field.label}预览`} /> : <Icon size={28} />}
              <span>{uploading === field.name ? '正在保存素材…' : `点击或拖拽${asset ? '更换' : '上传'}`}</span>
            </MediaUpload>
            {asset && field.kind === 'video' && <video className="reference-media-preview" aria-label="原视频播放" src={asset.url} controls preload="metadata" />}
            {(asset || values[field.name]) && <div className="image-to-video-caption"><small>{asset?.name ?? '素材已移除，请重新上传'}</small><button type="button" onClick={() => update(field.name, '')}>移除</button></div>}
          </div>
        })}</div>
        <label>被替换人物的特征描述<textarea aria-label="被替换人物的特征描述" rows={2} value={String(values.subject_prompt ?? '')} onChange={event => update('subject_prompt', event.target.value)} /><small>描述原视频中的人物，例如 girl in pink dress（穿粉色裙子的女孩），建议英文。</small></label>
        <PromptEditor value={String(values.prompt ?? '')} references={references} disabled={disabled} onChange={value => update('prompt', value)} />
        <div className="text-to-video-key"><small>沿用原工作流的替换模板，可直接修改。</small><button type="button" onClick={() => update('prompt', module?.fields.find(field => field.name === 'prompt')?.default ?? '')}>恢复工作流模板</button></div>
        <label>GPT 优化提示词<select aria-label="GPT 优化提示词" value={String(values.enhance_prompt ?? 'off')} onChange={event => update('enhance_prompt', event.target.value)}>
          <option value="off">关闭，直接使用提示词</option><option value="on">开启，生成前使用 GPT 优化</option>
        </select></label>
        {enhancementEnabled && <>
          <label>系统提示词<textarea aria-label="系统提示词" rows={2} value={String(values.system_prompt ?? '')} onChange={event => update('system_prompt', event.target.value)} /></label>
          <div className="text-to-video-grid">{selectionFields.map(name => {
            const field = module?.fields.find(field => field.name === name)
            const options = name === 'prompt_model' && models.length ? [...models] : [...field?.options ?? []]
            const selected = String(values[name] ?? '')
            if (selected && !options.some(option => (typeof option === 'string' ? option : option.value) === selected)) options.push(selected)
            return <label key={name}>{field?.label ?? name}<select aria-label={field?.label ?? name} value={selected} disabled={name === 'prompt_model' && loadingModels} onChange={event => update(name, event.target.value)}>
              {options.map(option => <option key={typeof option === 'string' ? option : option.value} value={typeof option === 'string' ? option : option.value}>{typeof option === 'string' ? option : option.label}</option>)}
            </select></label>
          })}</div>
          <label>API Key<input aria-label="API Key" type="password" autoComplete="off" value={String(values.prompt_api_key ?? '')} onBlur={() => { void saveKey().catch(error => setError(`Key 保存失败：${error.message}`)); void refreshModels() }} onChange={event => {
            modelRequest.current++
            setLoadingModels(false)
            setModels([])
            update('prompt_api_key', event.target.value)
          }} /></label>
          <div className="text-to-video-key"><small>与其他生视频组件共用本机保存的 Key。</small><button type="button" disabled={loadingModels || !values.prompt_api_key} onMouseDown={event => event.preventDefault()} onClick={() => void refreshModels()}><RefreshCw size={12} />{loadingModels ? '读取中…' : '刷新模型'}</button></div>
        </>}
        <div className="text-to-video-grid">
          <label>时长（秒）<input aria-label="时长（秒）" type="number" min={4} max={15} step="any" required value={String(values.duration ?? 5)} onChange={event => update('duration', event.target.value)} /></label>
          <label>视频比例<select aria-label="视频比例" value={String(values.aspect_ratio ?? '')} onChange={event => update('aspect_ratio', event.target.value)}>{options('aspect_ratio').map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select></label>
          <label>分辨率（百万像素 / MP）<input aria-label="分辨率（百万像素 / MP）" type="number" min={0.01} step="any" required value={String(values.megapixels ?? 0.4)} onChange={event => update('megapixels', event.target.value)} /></label>
          <label>种子（-1 为随机）<input aria-label="种子" type="number" step={1} value={String(values.seed ?? -1)} onChange={event => update('seed', event.target.value)} /></label>
        </div>
        <label>声音处理<select aria-label="声音处理" value={String(values.audio_mode ?? 'source')} onChange={event => update('audio_mode', event.target.value)}>{options('audio_mode').map(option => <option key={typeof option === 'string' ? option : option.value} value={typeof option === 'string' ? option : option.value}>{typeof option === 'string' ? option : option.label}</option>)}</select><small>原视频没有音轨时请选择“静音”。</small></label>
      </fieldset>
      {error && <p role="alert" className="text-to-video-error">{error}</p>}
      <div className="text-to-video-actions"><span role="status">{loading ? '正在读取工作流选项…' : uploading ? '正在保存素材…' : savingKey ? '正在保存 Key…' : busy ? '正在生成，关闭后可在轨道查看进度。' : 'MiniMax H3 人物替换'}</span><div>
        <button type="submit" disabled={disabled || loadingModels || !module}><Sparkles size={15} />{busy ? '生成中…' : '生成'}</button>
        <button type="button" disabled={disabled || !module} onClick={() => void complete()}><Check size={15} />完成</button>
      </div></div>
    </form>
  </DialogContent></Dialog>
}
