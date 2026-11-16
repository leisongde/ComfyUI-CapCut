import type { EditorCore } from '@/core'
import type { MediaAsset } from '@/types/assets'
import type { ImageElement } from '@/types/timeline'
import { toast } from 'sonner'
import {
  createFirstLastFrameVideoScene,
  createImageToVideoScene,
  getDirectorPlanning,
  setDirectorPlanning
} from './director-planning'
import { requestDirectorExpansion } from './video-ai'

interface OpenImageDirectorOptions {
  editor: EditorCore
  element: ImageElement
  mediaAsset: MediaAsset
}

export function openImageToVideoDirector(options: OpenImageDirectorOptions): void {
  if (options.mediaAsset.type !== 'image') {
    toast.error('无法读取当前图片素材')
    return
  }
  const result = createImageToVideoScene(
    getDirectorPlanning(options.editor.project.getActive()),
    options
  )
  setDirectorPlanning(options.editor, result.planning)
  options.editor.playback.seek({ time: Math.max(0, options.element.startTime) })
  options.editor.selection.clearSelection()
  requestDirectorExpansion(result.sceneId)
  toast.success('已打开图生视频', {
    description: `已带入当前图片，生成时长 ${result.duration.toFixed(1)} 秒`
  })
}

export function openFirstLastFrameVideoDirector(options: OpenImageDirectorOptions): void {
  if (options.mediaAsset.type !== 'image') {
    toast.error('无法读取当前图片素材')
    return
  }
  const result = createFirstLastFrameVideoScene(
    getDirectorPlanning(options.editor.project.getActive()),
    options
  )
  setDirectorPlanning(options.editor, result.planning)
  options.editor.playback.seek({ time: Math.max(0, options.element.startTime) })
  options.editor.selection.clearSelection()
  requestDirectorExpansion(result.sceneId)
  toast.success('已打开首尾帧生视频', {
    description: `已将当前图片设为首帧，生成时长 ${result.duration.toFixed(1)} 秒`
  })
}
