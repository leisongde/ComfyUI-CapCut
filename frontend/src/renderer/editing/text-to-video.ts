import { generateUUID } from '@/utils/id'
import type { EditorCore } from '@/core'
import type { EditingDirectorPlanningState, EditingDirectorShot } from '../../shared/editing'
import { getDirectorTrackCount, removeEmptyDirectorTrack } from '../../shared/editing-director-tracks'
import { buildVideoElement } from '@/lib/timeline/element-utils'
import { processMediaAssets } from '@/lib/media/processing'
import { toast } from 'sonner'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { request, type WorkflowProgress } from './bridge'
import { nativeStorageState } from './adapters/storage'
import { createDirectorSceneAt, findDirectorScene, findDirectorShot, getDirectorPlanning, setDirectorPlanning, updateDirectorShot } from './director-planning'
import { createDirectorGenerationPlan, fillDirectorGenerationPlaceholder, getDirectorGenerationPlaceholders, reserveDirectorGenerationPlaceholders, updateDirectorGenerationPlaceholders } from './director-generation-placeholders'

export type GenerationPosition = { trackIndex: number; startTime: number }
export type GenerationMode = 'T2VA' | 'I2VA' | 'FL2VA' | 'Ref2VA' | 'V2VA' | 'V2VARef' | 'CharacterSwap' | 'BodyRender' | 'MotionTransfer'
const activeRequests = new Set<string>()
let shotQueueActive = false

type GenerationModule = { id: string; nodeType: string; fields: Array<{ name: string; default: unknown; type?: string; kind?: string; multiple?: boolean }> }
export type ShotQueueProgress = { shotIds: string[]; index: number; title: string }

function savedShotRequest(editor: EditorCore, shotId: string, modules: GenerationModule[], key: string, motionKey: string) {
  const planning = getDirectorPlanning(editor.project.getActive())
  const shot = planning && findDirectorShot(planning, shotId)
  const scene = planning && findDirectorScene(planning, shotId)
  if (!shot || !scene) throw new Error('AI 片段已移除')
  const mode = String(scene.settings.task_type ?? { t2v: 'T2VA', i2v: 'I2VA', fl2v: 'FL2VA', r2v: 'Ref2VA', v2v: 'V2VA' }[shot.taskType])
  const nodeType = { CharacterSwap: 'CapCutMiniMaxH3CharacterSwapWorkflow', BodyRender: 'CapCutBodyRenderWorkflow', MotionTransfer: 'CapCutMotionTransferWorkflow' }[mode] ?? 'CapCutMiniMaxH3Workflow'
  const module = modules.find(item => item.nodeType === nodeType)
  if (!module) throw new Error(`请先连接${shot.title}使用的工作流模块`)
  const values: Record<string, unknown> = { ...Object.fromEntries(module.fields.map(field => [field.name, field.default])),
    ...(nodeType === 'CapCutMiniMaxH3Workflow' ? { enhance_prompt: 'on' } : {}), ...scene.settings,
    task_type: mode, duration: shot.duration, prompt: shot.prompt, prompt_api_key: mode === 'MotionTransfer' ? motionKey : key,
    first_frame: shot.firstFrameAssetId ?? shot.imageAssetId ?? '', last_frame: shot.lastFrameAssetId ?? '',
    ref_images: shot.refs.map(ref => ref.assetId), ref_videos: shot.refVideos.map(ref => ref.assetId), ref_audios: shot.refAudios.map(ref => ref.assetId),
    source_video: shot.refVideos[0]?.assetId ?? '', character_image: shot.refs[0]?.assetId ?? '',
    character_images: shot.refs.map(ref => ref.assetId), character_slots: shot.refs.map((ref, index) => ref.index ?? index) }
  if (mode !== 'BodyRender' && mode !== 'MotionTransfer') {
    if (!shot.prompt.trim()) throw new Error('请填写提示词')
    if (values.enhance_prompt === 'on') {
      if (!key.trim()) throw new Error('请先在参数面板保存 API Key')
    }
  }
  if (mode === 'CharacterSwap' && !String(values.subject_prompt ?? '').trim()) throw new Error('请描述原视频中需要被替换的人物')
  const mediaFields = module.fields.filter(field => field.type === 'media' && (mode === 'CharacterSwap' || mode === 'BodyRender' || mode === 'MotionTransfer'
    || (mode === 'I2VA' && field.name === 'first_frame') || (mode === 'FL2VA' && ['first_frame', 'last_frame'].includes(field.name))
    || (mode === 'Ref2VA' && ['ref_images', 'ref_videos', 'ref_audios'].includes(field.name))
    || (mode === 'V2VA' && field.name === 'ref_videos') || (mode === 'V2VARef' && ['ref_images', 'ref_videos', 'ref_audios'].includes(field.name))))
  for (const field of mediaFields) {
    const ids = field.multiple ? values[field.name] as string[] : [values[field.name]].filter(Boolean) as string[]
    if (ids.some(id => !editor.media.getAssets().some(asset => asset.id === id && asset.type === field.kind))) throw new Error('参考素材已移除，请重新上传')
  }
  validateGenerationInputs(shot.taskType, mode, values)
  return { moduleId: module.id, values }
}

export async function generateAIShots(editor: EditorCore, shotIds?: string[], onProgress?: (progress: ShotQueueProgress) => void) {
  if (shotQueueActive || activeRequests.size) throw new Error('已有镜头正在生成，请等待视频取回后再生成')
  const projectId = editor.project.getActive().metadata.id
  const shots = getDirectorPlanning(editor.project.getActive())?.scenes.flatMap(scene => scene.shots) ?? []
  const candidates = (shotIds ? shotIds.map(id => shots.find(shot => shot.id === id)).filter((shot): shot is EditingDirectorShot => Boolean(shot)) : shots)
    .sort((a, b) => a.startTime - b.startTime || (a.trackIndex ?? 0) - (b.trackIndex ?? 0))
  if (!candidates.length) throw new Error(shotIds ? '请先选择一个 AI 镜头' : '没有可生成的 AI 镜头')
  if (shots.some(shot => ['queued', 'running'].includes(shot.generationStatus))) throw new Error('已有镜头正在生成，请等待视频取回后再生成')
  shotQueueActive = true
  try {
    const needsMotionKey = candidates.some(shot => findDirectorScene(getDirectorPlanning(editor.project.getActive())!, shot.id)?.settings.task_type === 'MotionTransfer')
    const [modules, saved, motionSaved] = await Promise.all([request<GenerationModule[]>('capcut:workflows' as never),
      request<{ key: string }>('capcut:minimax-key:get' as never),
      needsMotionKey ? request<{ key: string }>('capcut:motion-transfer-key:get' as never) : Promise.resolve({ key: '' })])
    if (editor.project.getActiveOrNull()?.metadata.id !== projectId) throw new Error('工程已切换，生成队列已停止')
    const ready: string[] = [], skipped: string[] = []
    for (const shot of candidates) {
      try { savedShotRequest(editor, shot.id, modules, saved.key, motionSaved.key); ready.push(shot.id) }
      catch (error) {
        const reason = `${shot.title}：${(error as Error).message}`
        if (shotIds) throw new Error(reason)
        skipped.push(reason)
      }
    }
    if (!ready.length) throw new Error(`没有准备好的镜头。${skipped[0]}`)
    let completed = 0
    for (const [index, shotId] of ready.entries()) {
      if (editor.project.getActiveOrNull()?.metadata.id !== projectId) throw new Error('工程已切换，生成队列已停止')
      const shot = findDirectorShot(getDirectorPlanning(editor.project.getActive())!, shotId)
      if (!shot) throw new Error('待生成片段已移除，生成队列已停止')
      onProgress?.({ shotIds: ready, index, title: shot.title })
      try {
        const { moduleId, values } = savedShotRequest(editor, shotId, modules, saved.key, motionSaved.key)
        if (values.task_type === 'MotionTransfer') {
          const video = editor.media.getAssets().find(asset => asset.id === values.source_video)!
          const input = new Input({ source: new BlobSource(video.file), formats: ALL_FORMATS })
          try { values.audio_mode = await input.getPrimaryAudioTrack() ? 'source' : 'mute' }
          finally { input.dispose() }
          if (editor.project.getActiveOrNull()?.metadata.id !== projectId) throw new Error('工程已切换')
        }
        await runTextToVideo(editor, shotId, moduleId, values)
        if (editor.project.getActiveOrNull()?.metadata.id !== projectId) throw new Error('工程已切换')
        if (findDirectorShot(getDirectorPlanning(editor.project.getActive())!, shotId)?.generationStatus !== 'succeeded') throw new Error('片段已移除，结果未写回')
        await editor.save.flush()
      } catch (error) { throw new Error(`${shot.title}：${(error as Error).message}；队列已停止（已完成 ${completed}/${ready.length}）`) }
      completed++
    }
    return { completed, skipped }
  } finally { shotQueueActive = false }
}

function validateGenerationInputs(taskType: string, mode: string, values: Record<string, unknown>) {
  const firstLastFrames = taskType === 'fl2v'
  const characterSwap = mode === 'CharacterSwap', bodyRender = mode === 'BodyRender', motionTransfer = mode === 'MotionTransfer'
  if ((taskType === 'i2v' || firstLastFrames) && !values.first_frame) throw new Error('请上传首帧图片')
  if (firstLastFrames && !values.last_frame) throw new Error('请上传尾帧图片')
  if (taskType === 'v2v' && (!Array.isArray(values.ref_videos) || !values.ref_videos[0])) throw new Error('请上传视频 1')
  if ((characterSwap || bodyRender || motionTransfer) && !values.source_video) throw new Error('请上传原视频')
  if (characterSwap && !values.character_image) throw new Error('请上传替换人物图片')
  if (motionTransfer && (!Array.isArray(values.character_images) || !values.character_images.length)) throw new Error('请至少上传一张角色参考图')
  if (taskType === 'r2v' && !characterSwap && !bodyRender && !motionTransfer && !['ref_images', 'ref_videos', 'ref_audios'].some(name => Array.isArray(values[name]) && values[name].length))
    throw new Error('请至少上传一项参考图片、音频或视频')
}

export function recoverTextToVideoGenerations(editor: EditorCore) {
  let planning = getDirectorPlanning(editor.project.getActive())
  if (!planning) return
  let tracks = editor.timeline.getTracks()
  let changed = false
  for (const scene of planning.scenes) for (const shot of scene.shots) {
    if (shot.taskType === 'r2v' && !['Ref2VA', 'CharacterSwap', 'BodyRender', 'MotionTransfer'].includes(String(scene.settings.task_type))) continue
    if (shot.taskType === 'v2v' && !['V2VA', 'V2VARef'].includes(String(scene.settings.task_type))) continue
    if (!['t2v', 'i2v', 'fl2v', 'r2v', 'v2v'].includes(shot.taskType) || !['queued', 'running'].includes(shot.generationStatus) || activeRequests.has(shot.generationId ?? '')) continue
    changed = true
    if (shot.generationId) tracks = updateDirectorGenerationPlaceholders(tracks, shot.generationId, 'failed', '生成连接已断开，请从 ComfyUI 生成结果导入，或等待队列完成后重试')
    planning = updateDirectorShot(planning, shot.id, { generationStatus: 'failed' })
  }
  if (changed) {
    editor.timeline.updateTracks(tracks)
    setDirectorPlanning(editor, planning)
  }
}

export function textToVideoPlacement(startTime: number, duration: number, delta: number, side: 'move' | 'left' | 'right', mode?: GenerationMode) {
  if (side === 'move') return { startTime: Math.max(0, Math.round((startTime + delta) * 100) / 100), duration }
  const end = startTime + duration
  const limit = mode === 'MotionTransfer' ? Infinity : 15
  const maximum = side === 'left' ? Math.min(limit, end) : limit
  const next = Math.min(maximum, Math.max(mode === 'MotionTransfer' ? 1 / 24 : 4, Math.round((duration + (side === 'left' ? -delta : delta)) * 100) / 100))
  return { startTime: side === 'left' ? Math.max(0, end - next) : startTime, duration: next }
}

export function updateTextToVideoTiming(planning: EditingDirectorPlanningState, shotId: string, timing: { startTime: number; duration: number; trackIndex?: number }) {
  const shot = findDirectorShot(planning, shotId)
  if (!shot) return planning
  const next = updateDirectorShot({ ...planning, trackCount: getDirectorTrackCount(planning) }, shotId, { ...timing, targetDuration: timing.duration,
    sourceSnapshot: { ...shot.sourceSnapshot, duration: timing.duration } })
  const updated = { ...next, trackCount: getDirectorTrackCount(next), scenes: next.scenes.map(scene => scene.id === shot.sceneId
    ? { ...scene, settings: { ...scene.settings, duration: timing.duration } } : scene) }
  const insertedTop = getDirectorTrackCount(updated) > getDirectorTrackCount(planning) && findDirectorShot(updated, shotId)?.trackIndex === 0
  return removeEmptyDirectorTrack(updated, (shot.trackIndex ?? 0) + (insertedTop ? 1 : 0))
}

export function saveTextToVideoDraft(planning: EditingDirectorPlanningState, position: GenerationPosition, values: Record<string, unknown>, shotId?: string) {
  const motionTransfer = values.task_type === 'MotionTransfer'
  const duration = motionTransfer ? Number(values.duration) : Math.min(15, Math.max(4, Number(values.duration)))
  if (motionTransfer && (!Number.isFinite(duration) || duration <= 0)) throw new Error('生成时长需要大于 0 秒')
  const referenceEdit = values.task_type === 'V2VARef'
  const characterSwap = values.task_type === 'CharacterSwap'
  const bodyRender = values.task_type === 'BodyRender'
  const taskType = values.task_type === 'V2VA' || referenceEdit ? 'v2v' : values.task_type === 'Ref2VA' || characterSwap || bodyRender || motionTransfer ? 'r2v' : values.task_type === 'FL2VA' ? 'fl2v' : values.task_type === 'I2VA' ? 'i2v' : 't2v'
  const title = motionTransfer ? '动作迁移' : bodyRender ? '视频转白模' : characterSwap ? '人物替换' : referenceEdit ? '视频+参考修改' : { t2v: '文生视频', i2v: '图生视频', fl2v: '首尾帧生视频', r2v: '多参考生视频', v2v: '视频编辑' }[taskType]
  const firstFrame = typeof values.first_frame === 'string' ? values.first_frame || undefined : undefined
  const imageAssetId = taskType === 'i2v' ? firstFrame : undefined
  const firstFrameAssetId = taskType === 'fl2v' ? firstFrame : undefined
  const lastFrameAssetId = taskType === 'fl2v' && typeof values.last_frame === 'string' ? values.last_frame || undefined : undefined
  const references = (name: string) => (taskType === 'r2v' || referenceEdit) && Array.isArray(values[name])
    ? (values[name] as string[]).map((assetId, index) => ({ assetId, index })) : []
  const refs = motionTransfer ? ((values.character_images ?? []) as string[]).map((assetId, index) => ({ assetId, index: (values.character_slots as number[] | undefined)?.[index] ?? index }))
    : bodyRender ? [] : characterSwap ? (values.character_image ? [{ assetId: String(values.character_image), index: 0 }] : []) : references('ref_images')
  const refAudios = characterSwap || bodyRender || motionTransfer ? [] : references('ref_audios')
  const refVideos = characterSwap || bodyRender || motionTransfer ? (values.source_video ? [{ assetId: String(values.source_video), index: 0 }] : []) : taskType === 'v2v' && Array.isArray(values.ref_videos)
    ? (values.ref_videos as string[]).slice(0, 1).map(assetId => ({ assetId, index: 0 })) : references('ref_videos')
  let next = planning
  if (!shotId) {
    next = createDirectorSceneAt(planning, { ...position, duration, taskType })
    shotId = next.selectedShotId!
  }
  const shot = findDirectorShot(next, shotId)
  if (!shot) throw new Error('AI 片段已移除，请重新创建')
  const settings = Object.fromEntries(Object.entries(values).filter(([name]) => name !== 'prompt_api_key'))
  if (taskType === 'v2v') settings.ref_videos = refVideos.map(ref => ref.assetId)
  next = { ...next, selectedShotId: shotId, scenes: next.scenes.map(scene => scene.id === shot.sceneId
    ? { ...scene, title, settings: { ...scene.settings, ...settings, directorTaskType: taskType, duration } } : scene) }
  const prompt = motionTransfer ? '' : String(bodyRender ? values.subject_prompt ?? '' : values.prompt ?? '')
  return updateDirectorShot(next, shotId, { title, taskType, imageAssetId, firstFrameAssetId, lastFrameAssetId, refs, refVideos, refAudios, prompt, duration, targetDuration: duration,
    sourceSnapshot: { ...shot.sourceSnapshot, duration, imageAssetId: imageAssetId ?? null, firstFrameAssetId: firstFrameAssetId ?? null,
      lastFrameAssetId: lastFrameAssetId ?? null, refs, refVideos, refAudios, prompt } })
}

/** Keep the request independent of the parameter dialog, which closes while generation runs. */
export async function generateTextToVideo(editor: EditorCore, shotId: string, moduleId: string, values: Record<string, unknown>) {
  if (shotQueueActive) throw new Error('生成队列执行中，请等待视频取回后再生成')
  return runTextToVideo(editor, shotId, moduleId, values)
}

async function runTextToVideo(editor: EditorCore, shotId: string, moduleId: string, values: Record<string, unknown>) {
  const project = editor.project.getActive()
  const projectId = project.metadata.id
  const planning = getDirectorPlanning(project)
  const scene = planning && findDirectorScene(planning, shotId)
  const shot = planning && findDirectorShot(planning, shotId)
  if (!planning || !scene || !shot) throw new Error('AI 片段已移除')
  if (shot.generationStatus === 'queued' || shot.generationStatus === 'running') throw new Error('这个片段正在生成')
  const firstLastFrames = shot.taskType === 'fl2v'
  const characterSwap = scene.settings.task_type === 'CharacterSwap'
  const bodyRender = scene.settings.task_type === 'BodyRender'
  const motionTransfer = scene.settings.task_type === 'MotionTransfer'
  const referenceToVideo = shot.taskType === 'r2v' && !characterSwap && !bodyRender && !motionTransfer
  const videoEdit = shot.taskType === 'v2v'
  const referenceEdit = videoEdit && scene.settings.task_type === 'V2VARef'
  const imageToVideo = shot.taskType === 'i2v' || firstLastFrames
  validateGenerationInputs(shot.taskType, String(scene.settings.task_type), values)
  const plan = createDirectorGenerationPlan({ ...scene, shots: [shot], settings: { ...scene.settings, directorRunSelectEnabled: false } }, project.settings.fps)
  const requestId = plan.requestId
  activeRequests.add(requestId)
  setDirectorPlanning(editor, updateDirectorShot(planning, shotId, { generationId: requestId, generationStatus: 'queued' }))
  editor.timeline.updateTracks(reserveDirectorGenerationPlaceholders(editor.timeline.getTracks(), plan))
  const current = () => {
    if (editor.project.getActiveOrNull()?.metadata.id !== projectId) return null
    const latest = getDirectorPlanning(editor.project.getActive())
    return latest && findDirectorShot(latest, shotId)?.generationId === requestId ? latest : null
  }
  const progress = (value: WorkflowProgress) => {
    const latest = current()
    if (!latest) return
    const tracks = editor.timeline.getTracks()
    editor.timeline.updateTracks(tracks.map(track => ({ ...track, elements: track.elements.map(element => {
      if (!('directorGeneration' in element) || element.directorGeneration?.requestId !== requestId) return element
      const state = element.directorGeneration
      return { ...element, directorGeneration: { ...state, status: value.status, stage: value.stage,
        progress: Number.isFinite(value.percent) ? Math.max(state.progress ?? 0, Math.min(100, Math.max(0, value.percent!))) : state.progress } }
    }) })) as typeof tracks)
    if (findDirectorShot(latest, shotId)?.generationStatus !== value.status)
      setDirectorPlanning(editor, updateDirectorShot(latest, shotId, { generationStatus: value.status }))
  }
  try {
    await editor.save.flush()
    if (!current()) return
    const generationValues = bodyRender ? {
      task_type: 'BodyRender', source_video: values.source_video, subject_prompt: values.subject_prompt,
      output_mode: 'colored', start_time: 0, duration: 0, frame_rate: values.frame_rate ?? 24,
      longest_side: values.longest_side ?? 736, audio_mode: 'source'
    } : motionTransfer ? {
      task_type: 'MotionTransfer', source_video: values.source_video, character_images: values.character_images,
      character_slots: values.character_slots, duration: shot.duration, start_time: 0,
      aspect_ratio: values.aspect_ratio, megapixels: values.megapixels, longest_side: values.longest_side ?? 736,
      seed: -1, prompt: '', enhance_prompt: String(values.prompt_api_key ?? '').trim() ? 'on' : 'off',
      prompt_api_key: String(values.prompt_api_key ?? '').trim(), prompt_model: values.prompt_model,
      audio_mode: values.audio_mode === 'mute' ? 'mute' : 'source'
    } : characterSwap ? { ...values, duration: shot.duration, start_time: 0, task_type: 'CharacterSwap' } : { ...values, duration: shot.duration, task_type: referenceEdit ? 'V2VARef' : videoEdit ? 'V2VA' : referenceToVideo ? 'Ref2VA' : firstLastFrames ? 'FL2VA' : imageToVideo ? 'I2VA' : 'T2VA', enhance_prompt: values.enhance_prompt === 'off' ? 'off' : 'on', audio_mode: 'native',
      first_frame: imageToVideo ? values.first_frame : '', last_frame: firstLastFrames ? values.last_frame : '',
      ref_images: referenceToVideo || referenceEdit ? values.ref_images ?? [] : [], ref_videos: videoEdit ? (values.ref_videos as string[]).slice(0, 1) : referenceToVideo ? values.ref_videos ?? [] : [], ref_audios: referenceToVideo || referenceEdit ? values.ref_audios ?? [] : [], drive_audio: '', final_audio: '' }
    const files = await request<Array<{ filename: string; subfolder: string; type: string }>>('capcut:run-workflow' as never,
      { id: moduleId, values: generationValues, settings: project.settings, projectId }, [], 24 * 60 * 60 * 1000, progress)
    if (!current()) {
      toast.success('生成已完成，可从 ComfyUI 生成结果导入原工程。')
      return
    }
    progress({ status: 'running', stage: '导入视频' })
    const file = files[0]
    if (!file) throw new Error('工作流未返回视频，请查看 ComfyUI 生成结果')
    const result = await request<{ name: string; bytes: Uint8Array; mimeType: string }>('capcut:import-result' as never, { file, projectId })
    if (!current()) return
    const assets = await processMediaAssets({ files: [new File([result.bytes], result.name, { type: result.mimeType })] })
    const asset = assets.find(item => item.type === 'video')
    if (!asset) throw new Error('无法读取生成的视频，请从 ComfyUI 生成结果重新导入')
    if (!current()) return
    const id = await editor.media.addMediaAsset({ projectId, asset })
    if (nativeStorageState.error) throw nativeStorageState.error
    const latest = current()
    if (!latest) return
    const duration = asset.duration ?? shot.duration
    const filled = fillDirectorGenerationPlaceholder(editor.timeline.getTracks(), [shotId],
      buildVideoElement({ mediaId: id, name: shot.title, duration, startTime: shot.startTime }), requestId)
    if (filled) editor.timeline.updateTracks(filled.tracks)
    const versionId = generateUUID()
    const latestShot = findDirectorShot(latest, shotId)!
    setDirectorPlanning(editor, updateDirectorShot(latest, shotId, { generationStatus: 'succeeded', actualDuration: duration,
      durationResolution: 'actual', linkedVideoElementId: filled?.element.id, activeOutputVersionId: versionId,
      outputVersions: [...latestShot.outputVersions, { id: versionId, assetId: id, generationId: requestId, createdAt: new Date().toISOString(),
        duration, status: 'ready', linkedVideoElementId: filled?.element.id }] }))
    toast.success(filled ? '视频已替换占位并加入素材库' : '视频已加入素材库，剪辑占位已移除')
  } catch (error) {
    const latest = current()
    if (latest) {
      editor.timeline.updateTracks(updateDirectorGenerationPlaceholders(editor.timeline.getTracks(), requestId, 'failed', (error as Error).message))
      setDirectorPlanning(editor, updateDirectorShot(latest, shotId, { generationStatus: 'failed' }))
    }
    throw error
  } finally { activeRequests.delete(requestId) }
}

export function getTextToVideoSlot(editor: EditorCore, shotId: string) {
  const shot = getDirectorPlanning(editor.project.getActive())?.scenes.flatMap(scene => scene.shots).find(item => item.id === shotId)
  return getDirectorGenerationPlaceholders(editor.timeline.getTracks()).find(item => item.directorGeneration.requestId === shot?.generationId)?.directorGeneration
}
