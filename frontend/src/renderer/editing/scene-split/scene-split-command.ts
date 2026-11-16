import { EditorCore } from '@/core'
import { Command } from '@/lib/commands/base-command'
import type { TimelineTrack } from '@/types/timeline'
import { generateUUID } from '@/utils/id'
import {
  buildSceneSplitSegments,
  remapSceneSplitTransitions,
  type SceneSplitVideoElement
} from './scene-split-plan'

export class SceneSplitCommand extends Command {
  private savedState: TimelineTrack[] | null = null
  private previousSelection: Array<{ trackId: string; elementId: string }> = []
  private segmentIds: string[] = []
  private segmentCount = 0

  constructor(
    private trackId: string,
    private elementId: string,
    private timelineCuts: number[]
  ) {
    super()
  }

  getSegmentCount(): number {
    return this.segmentCount
  }

  execute(): void {
    const editor = EditorCore.getInstance()
    const tracks = editor.timeline.getTracks()
    const track = tracks.find((item) => item.id === this.trackId)
    const element = track?.elements.find((item) => item.id === this.elementId)
    if (!track || track.type !== 'video' || element?.type !== 'video')
      throw new Error('要分割的视频片段已经不在时间线上')

    this.savedState = tracks
    this.previousSelection = editor.selection.getSelectedElements()
    const segments = buildSceneSplitSegments({
      element: element as SceneSplitVideoElement,
      timelineCuts: this.timelineCuts,
      createId: (index) => {
        if (!this.segmentIds[index]) this.segmentIds[index] = generateUUID()
        return this.segmentIds[index]
      }
    })
    if (segments.length < 2) throw new Error('没有可应用的镜头切点')
    this.segmentCount = segments.length

    const updatedTracks = tracks.map((item) => {
      if (item.id !== track.id || item.type !== 'video') return item
      const elements = item.elements.flatMap((candidate) =>
        candidate.id === element.id ? segments : [candidate]
      )
      return {
        ...item,
        elements,
        transitions: remapSceneSplitTransitions({
          transitions: item.transitions,
          originalElementId: element.id,
          lastSegmentId: segments.at(-1)?.id ?? element.id
        })
      }
    })

    editor.timeline.updateTracks(updatedTracks)
    editor.selection.setSelectedElements({
      elements: segments.map((segment) => ({ trackId: track.id, elementId: segment.id }))
    })
  }

  undo(): void {
    if (!this.savedState) return
    const editor = EditorCore.getInstance()
    editor.timeline.updateTracks(this.savedState)
    editor.selection.setSelectedElements({ elements: this.previousSelection })
  }
}
