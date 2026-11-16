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
  createMotionTransferScene,
  createVideoModificationScene,
  createWhiteBodyVideoScene,
  DIRECTOR_SOURCE_VIDEO_MAX_DURATION,
  getDirectorPlanning,
  isDirectorSourceVideoDurationAllowed,
  setDirectorPlanning
} from './director-planning'

export const DIRECTOR_EXPAND_REQUEST_EVENT = 'raccoon:director-expand-requested'

export interface DirectorExpandRequest {
  sceneId: string
  token: number
}

let expandRequest: DirectorExpandRequest | null = null

export function getDirectorExpandRequest(): DirectorExpandRequest | null {
  return expandRequest
}

export function requestDirectorExpansion(sceneId: string): DirectorExpandRequest {
  expandRequest = { sceneId, token: (expandRequest?.token ?? 0) + 1 }
  window.dispatchEvent(new CustomEvent(DIRECTOR_EXPAND_REQUEST_EVENT, { detail: expandRequest }))
  return expandRequest
}

interface OpenVideoDirectorOptions {
  editor: EditorCore
  element: VideoElement
  mediaAsset: MediaAsset
}

function validateVideoDirectorSource(options: OpenVideoDirectorOptions): boolean {
  if (options.mediaAsset.type !== 'video') {
    toast.error('无法读取当前视频素材')
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

type VideoDirectorMode = 'v2v' | 'rv2v' | 'characterReplacement' | 'whiteBody' | 'motionTransfer'
const preparingEditors = new WeakSet<EditorCore>()

async function openVideoDirector(
  options: OpenVideoDirectorOptions,
  mode: VideoDirectorMode
): Promise<void> {
  if (!validateVideoDirectorSource(options) || preparingEditors.has(options.editor)) return
  const { editor, mediaAsset } = options
  const element = { ...options.element }
  const projectId = editor.project.getActive().metadata.id
  const isCurrentProject = () => editor.project.getActive()?.metadata.id === projectId
  preparingEditors.add(editor)
  const progressToast = toast.loading('正在提取选中的视频片段…')
  try {
    await flushMedia()
    const extracted = await extractDirectorVideoSource(element, mediaAsset, (progress) => {
      toast.loading(`正在提取选中的视频片段… ${Math.round(progress * 100)}%`, { id: progressToast })
    })
    if (!isCurrentProject()) throw new Error('剪辑工程已切换，请重新选择视频片段')
    const id = generateUUID()
    await storageService.saveMediaAsset({ projectId, mediaAsset: { ...extracted, id } })
    if (!isCurrentProject()) throw new Error('剪辑工程已切换，请重新选择视频片段')
    const { file, ...details } = extracted
    const source = createStoredMediaAsset(projectId, {
      ...details,
      id,
      mimeType: file.type,
      size: file.size,
      lastModified: file.lastModified
    })
    editor.media.setAssets({ assets: [...editor.media.getAssets(), source] })
    const sourceOptions = {
      element: {
        ...element,
        mediaId: id,
        trimStart: 0,
        trimEnd: 0,
        playbackRate: 1,
        reversed: false
      },
      mediaAsset: source
    }
    const planning = getDirectorPlanning(editor.project.getActive())
    const result =
      mode === 'v2v' || mode === 'rv2v'
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
          task_type: 'MotionTransfer', duration: element.duration, source_video: source.id, seed: -1
        }, result.shotId)
    setDirectorPlanning(editor, nextPlanning)
    editor.playback.seek({ time: Math.max(0, element.startTime) })
    editor.selection.clearSelection()
    requestDirectorExpansion(result.sceneId)
    const titles: Record<VideoDirectorMode, string> = {
      v2v: '已打开视频编辑',
      rv2v: '已打开视频+参考修改',
      characterReplacement: '已打开人物替换',
      whiteBody: '已打开视频转白模',
      motionTransfer: '已打开动作迁移'
    }
    toast.success(titles[mode], {
      description: `已带入选中片段 ${element.duration.toFixed(1)} 秒${mode === 'motionTransfer' ? '，请自行添加角色参考图。' : ''}`
    })
  } catch (error) {
    toast.error('发送视频片段失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    toast.dismiss(progressToast)
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

export function openCharacterReplacementDirector(options: OpenVideoDirectorOptions): Promise<void> {
  return openVideoDirector(options, 'characterReplacement')
}

export function openWhiteBodyVideoDirector(options: OpenVideoDirectorOptions): Promise<void> {
  return openVideoDirector(options, 'whiteBody')
}

export function openMotionTransferDirector(options: OpenVideoDirectorOptions): Promise<void> {
  return openVideoDirector(options, 'motionTransfer')
}
