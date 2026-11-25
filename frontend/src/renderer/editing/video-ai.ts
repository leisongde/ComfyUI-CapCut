import { generateUUID } from '@/utils/id'
import type { EditorCore } from '@/core'
import type { MediaAsset } from '@/types/assets'
import type { VideoElement } from '@/types/timeline'
import { toast } from 'sonner'
import { createStoredMediaAsset, flushMedia, storageService } from './adapters/storage'
import { extractDirectorVideoSource } from './director-video-source'
import { saveTextToVideoDraft } from './text-to-video'
import {
  createCharacterReplacementScene,
  createDirectorSceneAt,
  createEmptyDirectorTrack,
  createMotionTransferScene,
  createVideoModificationScene,
  createWhiteBodyVideoScene,
  DIRECTOR_SOURCE_VIDEO_MAX_DURATION,
  findDirectorScene,
  getDirectorPlanning,
  isDirectorSourceVideoDurationAllowed,
  setDirectorPlanning,
  updateDirectorShot
} from './director-planning'

export const DIRECTOR_EXPAND_REQUEST_EVENT = 'raccoon:director-expand-requested'

export interface DirectorExpandRequest {
  sceneId: string
  shotId?: string
  mode?: 'T2VA' | 'I2VA' | 'FL2VA' | 'Ref2VA' | 'V2VA' | 'V2VARef' | 'CharacterSwap' | 'BodyRender' | 'MotionTransfer' | 'RelayVSR'
  token: number
}

let expandRequest: DirectorExpandRequest | null = null

export function getDirectorExpandRequest(): DirectorExpandRequest | null {
  return expandRequest
}

export function requestDirectorExpansion(
  sceneId: string,
  shotId?: string,
  mode?: DirectorExpandRequest['mode']
): DirectorExpandRequest {
  expandRequest = { sceneId, ...(shotId ? { shotId } : {}), ...(mode ? { mode } : {}), token: (expandRequest?.token ?? 0) + 1 }
  window.dispatchEvent(new CustomEvent(DIRECTOR_EXPAND_REQUEST_EVENT, { detail: expandRequest }))
  return expandRequest
}

interface OpenVideoDirectorOptions {
  editor: EditorCore
  element: VideoElement
  mediaAsset: MediaAsset
}

function validateVideoDirectorSource(options: OpenVideoDirectorOptions, mode: VideoDirectorMode): boolean {
  if (options.mediaAsset.type !== 'video') {
    toast.error('无法读取当前视频素材')
    return false
  }
  if (mode === 'relayVSR') {
    if (Number.isFinite(options.element.duration) && options.element.duration > 0) return true
    toast.error('无法读取当前视频片段时长')
    return false
  }
  if (!isDirectorSourceVideoDurationAllowed(options.element.duration)) {
    if (Number(options.element.duration) > DIRECTOR_SOURCE_VIDEO_MAX_DURATION) {
      toast.error(`视频不能超过 ${DIRECTOR_SOURCE_VIDEO_MAX_DURATION} 秒`, {
        description: `请先将当前片段裁剪到 ${DIRECTOR_SOURCE_VIDEO_MAX_DURATION} 秒以内后再使用 AI 编辑。`
      })
    } else {
      toast.error('无法读取当前视频片段时长')
    }
    return false
  }
  return true
}

type VideoDirectorMode = 'v2v' | 'rv2v' | 'characterReplacement' | 'whiteBody' | 'motionTransfer' | 'relayVSR'
const preparingEditors = new WeakSet<EditorCore>()

async function openVideoDirector(
  options: OpenVideoDirectorOptions,
  mode: VideoDirectorMode
): Promise<void> {
  if (!validateVideoDirectorSource(options, mode) || preparingEditors.has(options.editor)) return
  const { editor, mediaAsset } = options
  const element = { ...options.element }
  const projectId = editor.project.getActive().metadata.id
  const isCurrentProject = () => editor.project.getActive()?.metadata.id === projectId
  preparingEditors.add(editor)
  let progressToast: string | number | undefined
  try {
    await flushMedia()
    if (!isCurrentProject()) throw new Error('剪辑工程已切换，请重新选择视频片段')
    const relayVSR = mode === 'relayVSR'
    const fullVideo = !element.trimStart && !element.trimEnd && !element.reversed &&
      (element.playbackRate ?? 1) === 1 && Math.abs((mediaAsset.duration ?? 0) - element.duration) < 0.001
    let source = mediaAsset
    if (!relayVSR || !fullVideo) {
      progressToast = toast.loading('正在提取选中的视频片段…')
      const extracted = await extractDirectorVideoSource(element, mediaAsset, progress => {
        toast.loading(`正在提取选中的视频片段… ${Math.round(progress * 100)}%`, { id: progressToast })
      }, relayVSR ? { maxDuration: Infinity, useSourceFrameRate: true } : undefined)
      if (!isCurrentProject()) throw new Error('剪辑工程已切换，请重新选择视频片段')
      const id = generateUUID()
      await storageService.saveMediaAsset({ projectId, mediaAsset: { ...extracted, id } })
      if (!isCurrentProject()) throw new Error('剪辑工程已切换，请重新选择视频片段')
      const { file, ...details } = extracted
      source = createStoredMediaAsset(projectId, {
        ...details,
        id,
        mimeType: file.type,
        size: file.size,
        lastModified: file.lastModified
      })
      editor.media.setAssets({ assets: [...editor.media.getAssets(), source] })
    }
    const sourceOptions = {
      element: {
        ...element,
        mediaId: source.id,
        trimStart: 0,
        trimEnd: 0,
        playbackRate: 1,
        reversed: false
      },
      mediaAsset: source
    }
    const planning = getDirectorPlanning(editor.project.getActive())
    const result = relayVSR
      ? { planning: planning ?? createEmptyDirectorTrack(null), shotId: undefined, duration: element.duration }
      : mode === 'v2v' || mode === 'rv2v'
        ? createVideoModificationScene(planning, { ...sourceOptions, taskType: mode })
        : mode === 'characterReplacement'
          ? createCharacterReplacementScene(planning, sourceOptions)
          : mode === 'whiteBody'
            ? createWhiteBodyVideoScene(planning, sourceOptions)
            : createMotionTransferScene(planning, sourceOptions)
    const nextPlanning = mode === 'v2v' || mode === 'rv2v'
      ? saveTextToVideoDraft(result.planning, { startTime: element.startTime, trackIndex: 0 }, {
          task_type: mode === 'rv2v' ? 'V2VARef' : 'V2VA', duration: result.duration, prompt: '', ref_videos: [source.id]
        }, result.shotId)
      : mode === 'characterReplacement'
        ? saveTextToVideoDraft(result.planning, { startTime: element.startTime, trackIndex: 0 }, {
            task_type: 'CharacterSwap', duration: result.duration, source_video: source.id
          }, result.shotId)
      : mode === 'whiteBody'
        ? saveTextToVideoDraft(result.planning, { startTime: element.startTime, trackIndex: 0 }, {
            task_type: 'BodyRender', duration: result.duration, source_video: source.id, output_mode: 'colored'
          }, result.shotId)
      : saveTextToVideoDraft(result.planning, { startTime: element.startTime, trackIndex: 0 }, {
          task_type: relayVSR ? 'RelayVSR' : 'MotionTransfer', duration: element.duration, source_video: source.id
        }, result.shotId)
    setDirectorPlanning(editor, nextPlanning)
    editor.playback.seek({ time: Math.max(0, element.startTime) })
    editor.selection.clearSelection()
    requestDirectorExpansion(findDirectorScene(nextPlanning, nextPlanning.selectedShotId!)!.id)
    const titles: Record<VideoDirectorMode, string> = {
      v2v: '已打开视频编辑',
      rv2v: '已打开视频+参考修改',
      characterReplacement: '已打开人物替换',
      whiteBody: '已打开视频转白模',
      motionTransfer: '已打开动作迁移',
      relayVSR: '已打开视频放大'
    }
    toast.success(titles[mode], {
      id: progressToast,
      description: `已带入选中片段 ${element.duration.toFixed(1)} 秒${mode === 'motionTransfer' ? '，请自行添加角色参考图。' : ''}`
    })
  } catch (error) {
    toast.error('发送视频片段失败', {
      id: progressToast,
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    preparingEditors.delete(editor)
  }
}

export function openVideoModificationDirector(options: OpenVideoDirectorOptions): Promise<void> {
  return openVideoDirector(options, 'v2v')
}

export function openVideoReferenceModificationDirector(
  options: OpenVideoDirectorOptions
): Promise<void> {
  return openVideoDirector(options, 'rv2v')
}

export async function openVideoContinuationDirector(options: OpenVideoDirectorOptions): Promise<void> {
  if (options.mediaAsset.type !== 'video') {
    toast.error('无法读取当前视频素材')
    return
  }
  const { editor, mediaAsset } = options
  if (preparingEditors.has(editor)) return
  const projectId = editor.project.getActive().metadata.id
  const isCurrentProject = () => editor.project.getActive()?.metadata.id === projectId
  preparingEditors.add(editor)
  let progressToast: string | number | undefined
  try {
    await flushMedia()
    if (!isCurrentProject()) throw new Error('剪辑工程已切换，请重新选择视频片段')
    const element = { ...options.element }
    const fullVideo = !element.trimStart && !element.trimEnd && !element.reversed &&
      (element.playbackRate ?? 1) === 1 && Math.abs((mediaAsset.duration ?? 0) - element.duration) < 0.001
    let source = mediaAsset
    if (!fullVideo) {
      progressToast = toast.loading('正在提取选中的视频片段…')
      const extracted = await extractDirectorVideoSource(element, mediaAsset, progress => {
        toast.loading(`正在提取选中的视频片段… ${Math.round(progress * 100)}%`, { id: progressToast })
      }, { maxDuration: Infinity })
      if (!isCurrentProject()) throw new Error('剪辑工程已切换，请重新选择视频片段')
      const id = generateUUID()
      await storageService.saveMediaAsset({ projectId, mediaAsset: { ...extracted, id } })
      if (!isCurrentProject()) throw new Error('剪辑工程已切换，请重新选择视频片段')
      const { file, ...details } = extracted
      source = createStoredMediaAsset(projectId, {
        ...details,
        id,
        mimeType: file.type,
        size: file.size,
        lastModified: file.lastModified
      })
      editor.media.setAssets({ assets: [...editor.media.getAssets(), source] })
    }
    const planning = getDirectorPlanning(editor.project.getActive())
    let nextPlanning = createDirectorSceneAt(planning, {
      taskType: 't2v',
      startTime: Math.max(0, element.startTime + element.duration),
      trackIndex: 0,
      duration: 15
    })
    const shotId = nextPlanning.selectedShotId!
    nextPlanning = updateDirectorShot(nextPlanning, shotId, {
      guideSourceAssetId: source.id,
      aiTrackTransition: 'cut',
      aiTrackGuideFrames: 22
    })
    const scene = findDirectorScene(nextPlanning, shotId)
    if (!scene) throw new Error('无法创建续接视频片段')
    setDirectorPlanning(editor, nextPlanning)
    editor.playback.seek({ time: Math.max(0, element.startTime + element.duration) })
    editor.selection.clearSelection()
    requestDirectorExpansion(scene.id, shotId, 'T2VA')
    toast.success('已创建视频结尾续接片段', {
      id: progressToast,
      description: '请填写提示词和参数，生成时会读取当前视频结尾作为上下文。'
    })
  } catch (error) {
    toast.error('创建视频结尾续接失败', {
      id: progressToast,
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    preparingEditors.delete(editor)
  }
}

export function openCharacterReplacementDirector(options: OpenVideoDirectorOptions): Promise<void> {
  return openVideoDirector(options, 'characterReplacement')
}

export function openWhiteBodyVideoDirector(options: OpenVideoDirectorOptions): Promise<void> {
  return openVideoDirector(options, 'whiteBody')
}

export function openMotionTransferDirector(options: OpenVideoDirectorOptions): Promise<void> {
  return openVideoDirector(options, 'motionTransfer')
}

export function openRelayVSRDirector(options: OpenVideoDirectorOptions): Promise<void> {
  return openVideoDirector(options, 'relayVSR')
}
