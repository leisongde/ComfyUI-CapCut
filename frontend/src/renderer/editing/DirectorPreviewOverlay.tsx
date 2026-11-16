import { useEffect, useMemo, useState } from 'react'
import { useEditor } from '@/hooks/use-editor'
import type { EditingDirectorScene, EditingDirectorShot } from '../../shared/editing'
import { usePlaybackTime } from './playback-time'
import {
  DIRECTOR_PLANNING_EVENT,
  getDirectorPlanning,
  getDirectorShotPreviewAssetId
} from './director-planning'

type ActiveDirectorShot = {
  scene: EditingDirectorScene
  shot: EditingDirectorShot
}

const findActiveDirectorShot = (
  scenes: EditingDirectorScene[],
  currentTime: number
): ActiveDirectorShot | null => {
  const active = scenes.flatMap((scene) =>
    scene.shots
      .filter((shot) => {
        // Hide only this shot; other AI clips keep their planning previews.
        if (shot.hidden) return false
        if (shot.generationStatus === 'succeeded' && shot.linkedVideoElementId) return false
        const startTime = Math.max(0, Number(shot.startTime) || 0)
        const duration = Math.max(0, Number(shot.duration) || 0)
        return currentTime >= startTime && currentTime < startTime + duration
      })
      .map((shot) => ({ scene, shot }))
  )
  active.sort(
    (left, right) =>
      Math.max(0, left.shot.trackIndex ?? 0) - Math.max(0, right.shot.trackIndex ?? 0)
  )
  return active[0] ?? null
}

/** A preview-only AI planning layer. It is intentionally absent from export rendering. */
export function DirectorPreviewOverlay() {
  const editor = useEditor()
  const currentTime = usePlaybackTime(editor.playback, 30)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1)
    window.addEventListener(DIRECTOR_PLANNING_EVENT, refresh)
    const unsubscribeProject = editor.project.subscribe(refresh)
    const unsubscribeMedia = editor.media.subscribe(refresh)
    return () => {
      window.removeEventListener(DIRECTOR_PLANNING_EVENT, refresh)
      unsubscribeProject()
      unsubscribeMedia()
    }
  }, [editor])

  const preview = useMemo(() => {
    const planning = getDirectorPlanning(editor.project.getActive())
    if (!planning) return null
    const active = findActiveDirectorShot(planning.scenes, currentTime)
    if (!active) return null
    const assetId = getDirectorShotPreviewAssetId(active.shot, active.scene)
    if (!assetId) return null
    const asset = editor.media.getAssets().find((item) => item.id === assetId)
    if (!asset || asset.type !== 'image') return null
    const source = asset.url ?? asset.thumbnailUrl
    return source ? { source, title: active.shot.title } : null
  }, [currentTime, editor, revision])

  if (!preview) return null

  return (
    <div className="director-preview-overlay" aria-label={`AI 镜头预演：${preview.title}`}>
      <img src={preview.source} alt="" draggable={false} />
    </div>
  )
}

