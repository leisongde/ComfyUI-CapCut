import { toast } from 'sonner'
import type { EditorCore } from '@/core'
import {
  AddMediaAssetCommand,
  BatchCommand,
  Command,
  InsertElementCommand,
  SplitElementsCommand
} from '@/lib/commands'
import { i18next } from '@/lib/i18n'
import { buildImageElement } from '@/lib/timeline/element-utils'
import { cleanupTransitionsForTrack } from '@/lib/timeline/transition-utils'
import { storageService } from '@/services/storage/service'
import { CanvasRenderer } from '@/services/renderer/canvas-renderer'
import type { TimelineTrack, VideoTrack } from '@/types/timeline'
import { FREEZE_FRAME_DURATION, resolveFreezeFramePlacement } from './freeze-frame-plan'

interface TimelineElementReference {
  trackId: string
  elementId: string
}

class ShiftTrackElementsCommand extends Command {
  private savedTracks: TimelineTrack[] | null = null

  constructor(
    private editor: EditorCore,
    private trackId: string,
    private fromTime: number,
    private timeDelta: number
  ) {
    super()
  }

  execute(): void {
    const tracks = this.editor.timeline.getTracks()
    const track = tracks.find(({ id }) => id === this.trackId)
    if (!track || track.type !== 'video') throw new Error('Freeze-frame track is unavailable')

    this.savedTracks = tracks
    const movedTrack: VideoTrack = {
      ...track,
      elements: track.elements.map((element) =>
        element.startTime >= this.fromTime - 1e-6
          ? { ...element, startTime: element.startTime + this.timeDelta }
          : element
      )
    }
    const cleanedTrack = cleanupTransitionsForTrack({ track: movedTrack })
    this.editor.timeline.updateTracks(
      tracks.map((candidate) => (candidate.id === this.trackId ? cleanedTrack : candidate))
    )
  }

  undo(): void {
    if (this.savedTracks) this.editor.timeline.updateTracks(this.savedTracks)
  }
}

class SelectTimelineElementCommand extends Command {
  private previousSelection: TimelineElementReference[] | null = null

  constructor(
    private editor: EditorCore,
    private selection: TimelineElementReference
  ) {
    super()
  }

  execute(): void {
    this.previousSelection = this.editor.selection.getSelectedElements()
    this.editor.selection.setSelectedElements({ elements: [this.selection] })
  }

  undo(): void {
    if (this.previousSelection) {
      this.editor.selection.setSelectedElements({ elements: this.previousSelection })
    }
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Unable to encode the freeze frame'))
    }, 'image/png')
  })
}

async function capturePlayerFrame({
  editor,
  time,
  fileName
}: {
  editor: EditorCore
  time: number
  fileName: string
}): Promise<{ file: File; width: number; height: number }> {
  const renderTree = editor.renderer.getRenderTree()
  const activeProject = editor.project.getActive()
  if (!renderTree || !activeProject) throw new Error('Preview is unavailable')

  const { width, height } = activeProject.settings.canvasSize
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const renderer = new CanvasRenderer({
    width,
    height,
    fps: activeProject.settings.fps,
    imageSmoothingQuality: 'high'
  })

  await renderer.renderToCanvas({ node: renderTree, time, targetCanvas: canvas })
  const blob = await canvasToPng(canvas)
  return {
    file: new File([blob], fileName, { type: 'image/png' }),
    width,
    height
  }
}

export async function executeDesktopFreezeFrame({
  editor,
  sourceRef,
  inFlight
}: {
  editor: EditorCore
  sourceRef?: TimelineElementReference
  inFlight: { current: boolean }
}): Promise<void> {
  if (inFlight.current) return
  if (!sourceRef) {
    toast.warning(i18next.t('Select one video to freeze'))
    return
  }

  const [source] = editor.timeline.getElementsWithTracks({ elements: [sourceRef] })
  if (!source || source.element.type !== 'video' || source.track.type !== 'video') {
    toast.warning(i18next.t('Select one video to freeze'))
    return
  }

  const activeProject = editor.project.getActive()
  const placement = resolveFreezeFramePlacement({
    clipStart: source.element.startTime,
    clipDuration: source.element.duration,
    playheadTime: editor.playback.getCurrentTime(),
    fps: activeProject.settings.fps
  })
  if (!placement) {
    toast.warning(i18next.t('Move the playhead inside the video'))
    return
  }

  editor.playback.pause()
  inFlight.current = true
  const toastId = 'freeze-frame'
  toast.loading(i18next.t('Creating freeze frame'), { id: toastId })

  let assetId: string | undefined
  let objectUrl: string | undefined
  let batchCommand: BatchCommand | undefined
  let commandStarted = false
  let committed = false

  try {
    const sourceName = source.element.name.replace(/\.[^/.]+$/, '')
    const { file, width, height } = await capturePlayerFrame({
      editor,
      time: placement.captureTime,
      fileName: `${sourceName}-freeze-${placement.captureTime.toFixed(3)}.png`
    })
    objectUrl = URL.createObjectURL(file)
    const asset = {
      name: file.name,
      type: 'image' as const,
      file,
      url: objectUrl,
      width,
      height
    }
    const addMediaCommand = new AddMediaAssetCommand(
      activeProject.metadata.id,
      asset,
      true
    )
    assetId = addMediaCommand.getAssetId()
    await storageService.saveMediaAsset({
      projectId: activeProject.metadata.id,
      mediaAsset: { ...asset, id: assetId }
    })

    const imageElement = buildImageElement({
      mediaId: assetId,
      name: file.name,
      duration: FREEZE_FRAME_DURATION,
      startTime: placement.insertionTime
    })
    const insertCommand = new InsertElementCommand({
      element: imageElement,
      placement: { mode: 'explicit', trackId: source.track.id }
    })
    const commands: Command[] = [addMediaCommand]
    if (placement.shouldSplit) {
      commands.push(new SplitElementsCommand([sourceRef], placement.insertionTime))
    }
    commands.push(
      new ShiftTrackElementsCommand(
        editor,
        source.track.id,
        placement.insertionTime,
        FREEZE_FRAME_DURATION
      ),
      insertCommand,
      new SelectTimelineElementCommand(editor, {
        trackId: source.track.id,
        elementId: insertCommand.getElementId()
      })
    )

    batchCommand = new BatchCommand(commands)
    commandStarted = true
    editor.command.execute({ command: batchCommand })
    committed = true
    editor.playback.seek({ time: placement.insertionTime })
    toast.success(i18next.t('Freeze frame created'), { id: toastId })
  } catch (error) {
    console.error('Failed to create freeze frame:', error)
    if (commandStarted && !committed) batchCommand?.undo()
    if (!committed && assetId) {
      await storageService
        .deleteMediaAsset({ projectId: activeProject.metadata.id, id: assetId })
        .catch(() => undefined)
    }
    if (!committed && objectUrl) URL.revokeObjectURL(objectUrl)
    toast.error(i18next.t('Failed to create freeze frame'), { id: toastId })
  } finally {
    inFlight.current = false
  }
}

