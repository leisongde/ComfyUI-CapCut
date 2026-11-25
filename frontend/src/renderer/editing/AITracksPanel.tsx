import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Activity, Box, Clapperboard, Maximize2, Images, ImagePlus, ListChecks, LoaderCircle, Play, Plus, Sparkles, Trash2, UserRound, Video, WandSparkles } from 'lucide-react'
import { useEditor } from '@/hooks/use-editor'
import type { EditorCore } from '@/core'
import { Command } from '@/lib/commands/base-command'
import { toast } from 'sonner'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { formatRulerLabel, getRulerConfig, shouldShowLabel } from '@/lib/timeline/ruler-utils'
import type { EditingDirectorPlanningState, EditingDirectorShot } from '../../shared/editing'
import { AI_SHOT_GUIDE_FRAMES, getAIShotGuideFrames, getAIShotPredecessors, getAITrackOutputMode } from './ai-shot-output'
import { getDirectorTrackCount, removeEmptyDirectorTrack } from '../../shared/editing-director-tracks'
import { findDirectorScene, findDirectorShot, getDirectorPlanning, removeDirectorShot, setDirectorPlanning, updateDirectorShot } from './director-planning'
import { TextToVideoDialog } from './TextToVideoDialog'
import { CharacterSwapDialog } from './CharacterSwapDialog'
import { BodyRenderDialog } from './BodyRenderDialog'
import { MotionTransferDialog } from './MotionTransferDialog'
import { generateAIShots, generateTextToVideo, getTextToVideoSlot, recoverTextToVideoGenerations, saveTextToVideoDraft, textToVideoPlacement, updateTextToVideoTiming, type GenerationMode, type GenerationPosition, type ShotQueueProgress } from './text-to-video'
import { usePlaybackTime } from './playback-time'
import { getPreviewDuration } from './preview-duration'
import { TIMELINE_PIXELS_PER_SECOND, requestTimelineScroll, useTimelineViewport } from './timeline-sync'
import { DIRECTOR_EXPAND_REQUEST_EVENT, type DirectorExpandRequest } from './video-ai'

class ChangeAITracks extends Command {
  constructor(
    private editor: EditorCore,
    private before: EditingDirectorPlanningState,
    private after: EditingDirectorPlanningState
  ) { super() }
  private apply(planning: EditingDirectorPlanningState) {
    const current = getDirectorPlanning(this.editor.project.getActive())
    setDirectorPlanning(this.editor, { ...planning, scenes: planning.scenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => {
      const live = current && findDirectorShot(current, shot.id)
      if (!live) return shot
      // Undoing placement must not roll back a background generation's result.
      const { generationStatus, generationId, outputVersions, activeOutputVersionId, linkedVideoElementId, actualDuration, durationResolution } = live
      return { ...shot, generationStatus, generationId, outputVersions, activeOutputVersionId, linkedVideoElementId, actualDuration, durationResolution }
    }) })) })
  }
  execute() { this.apply(this.after) }
  undo() { this.apply(this.before) }
}

export function AITracksPanel() {
  const editor = useEditor()
  const project = editor.project.getActive()
  const planning = getDirectorPlanning(project)
  const trackCount = getDirectorTrackCount(planning)
  const [selected, setSelected] = useState<number | null>(null)
  const [generationOpen, setGenerationOpen] = useState(false)
  const [generationMode, setGenerationMode] = useState<GenerationMode>('T2VA')
  const [generationPosition, setGenerationPosition] = useState<GenerationPosition>({ trackIndex: 0, startTime: 0 })
  const [editingShotId, setEditingShotId] = useState<string>()
  const [contextShotId, setContextShotId] = useState<string>()
  const [queueProgress, setQueueProgress] = useState<ShotQueueProgress | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [checkedShotIds, setCheckedShotIds] = useState<string[]>([])
  const [placement, setPlacement] = useState<{ shotId: string; startTime: number; duration: number; trackIndex: number } | null>(null)
  const drag = useRef<{ shot: EditingDirectorShot; x: number; y: number; scrollLeft: number; pointerId: number; projectId: string; side: 'move' | 'left' | 'right' } | null>(null)
  const viewport = useTimelineViewport()
  const currentTime = usePlaybackTime(editor.playback)
  const body = useRef<HTMLDivElement>(null)
  const origin = useRef<HTMLDivElement>(null)
  const [labelWidth, setLabelWidth] = useState(64)
  const fps = project.settings.fps
  const pixelsPerSecond = TIMELINE_PIXELS_PER_SECOND * viewport.zoomLevel
  const playheadOffset = currentTime * pixelsPerSecond - viewport.scrollLeft
  const { tickIntervalSeconds, labelIntervalSeconds } = getRulerConfig({ zoomLevel: viewport.zoomLevel, fps })
  const tickStart = Math.max(0, Math.floor(viewport.scrollLeft / pixelsPerSecond / tickIntervalSeconds))
  const tickCount = Math.ceil(viewport.viewportWidth / pixelsPerSecond / tickIntervalSeconds) + 2
  const shots = (planning?.scenes.flatMap(scene => scene.shots) ?? []).map(shot => placement?.shotId === shot.id
    ? { ...shot, startTime: placement.startTime, duration: placement.duration } : shot)
  const guideEnabled = planning?.aiTrackGuideEnabled === true
  const outputMode = getAITrackOutputMode(planning)
  const predecessors = getAIShotPredecessors(shots.map(shot => placement?.shotId === shot.id
    ? { ...shot, trackIndex: placement.trackIndex } : shot), fps)
  const movingShot = placement && shots.find(shot => shot.id === placement.shotId)
  const editingShot = planning && editingShotId ? findDirectorShot(planning, editingShotId) : null
  const editingScene = planning && editingShotId ? findDirectorScene(planning, editingShotId) : null
  const editingSlot = editingShotId ? getTextToVideoSlot(editor, editingShotId) : undefined
  const selectedShot = shots.find(shot => shot.id === planning?.selectedShotId)
  const checkedShots = shots.filter(shot => checkedShotIds.includes(shot.id))
  const waitingShotIds = queueProgress?.shotIds.slice(queueProgress.index + 1) ?? []
  const anyGenerating = shots.some(shot => shot.generationStatus === 'queued' || shot.generationStatus === 'running')
  const busy = Boolean(queueProgress) || editingShot?.generationStatus === 'queued' || editingShot?.generationStatus === 'running'
  const activeRow = selected !== null && selected < trackCount ? selected : null

  useEffect(() => {
    setQueueProgress(null)
    setSelectionMode(false)
    setCheckedShotIds([])
    recoverTextToVideoGenerations(editor)
  }, [editor, project.metadata.id])

  useEffect(() => {
    const openSourceDraft = (event: Event) => {
      const detail = (event as CustomEvent<DirectorExpandRequest>).detail
      const scene = getDirectorPlanning(editor.project.getActive())?.scenes.find(scene => scene.id === detail.sceneId)
      const characterSwap = scene?.settings.task_type === 'CharacterSwap'
      const bodyRender = scene?.settings.task_type === 'BodyRender'
      const relayVSR = scene?.settings.task_type === 'RelayVSR'
      const motionTransfer = scene?.settings.task_type === 'MotionTransfer'
      const requestedShot = detail.shotId ? scene?.shots.find(shot => shot.id === detail.shotId) : undefined
      const shot = requestedShot ?? scene?.shots.find(shot => shot.taskType === 'i2v' || shot.taskType === 'fl2v' || shot.taskType === 'v2v' || shot.taskType === 't2v' || (shot.taskType === 'r2v' && (characterSwap || bodyRender || motionTransfer || relayVSR)))
      if (!shot) return
      setEditingShotId(shot.id)
      const referenceEdit = scene?.settings.task_type === 'V2VARef'
      setGenerationMode(detail.mode ?? (relayVSR ? 'RelayVSR' : motionTransfer ? 'MotionTransfer' : bodyRender ? 'BodyRender' : characterSwap ? 'CharacterSwap' : shot.taskType === 'v2v' ? referenceEdit ? 'V2VARef' : 'V2VA' : shot.taskType === 'fl2v' ? 'FL2VA' : shot.taskType === 'r2v' ? 'Ref2VA' : 'T2VA'))
      setGenerationPosition({ trackIndex: shot.trackIndex ?? 0, startTime: shot.startTime })
      setSelected(shot.trackIndex ?? 0)
      setGenerationOpen(true)
    }
    window.addEventListener(DIRECTOR_EXPAND_REQUEST_EVENT, openSourceDraft)
    return () => window.removeEventListener(DIRECTOR_EXPAND_REQUEST_EVENT, openSourceDraft)
  }, [editor])

  useLayoutEffect(() => {
    const measure = () => {
      if (origin.current && viewport.viewportLeft)
        setLabelWidth(Math.max(0, viewport.viewportLeft - origin.current.getBoundingClientRect().left))
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (origin.current) observer.observe(origin.current)
    return () => observer.disconnect()
  }, [viewport.viewportLeft])

  const change = (next: EditingDirectorPlanningState) => {
    const before = planning ?? { schemaVersion: 1, scenes: [], assetMap: {}, trackCount }
    editor.command.execute({ command: new ChangeAITracks(editor, before, next) })
  }
  const addTrack = () => {
    change({ ...(planning ?? { schemaVersion: 1, scenes: [], assetMap: {} }), trackCount: trackCount + 1 })
    setSelected(trackCount)
    requestAnimationFrame(() => body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' }))
  }
  const deleteTrack = (index: number) => {
    const before = planning ?? { schemaVersion: 1, scenes: [], assetMap: {}, trackCount }
    const after = removeEmptyDirectorTrack(before, index)
    if (after !== before) {
      change(after)
      setSelected(null)
    }
  }
  const seek = (clientX: number, left: number) => {
    const raw = (clientX - left + viewport.scrollLeft) / pixelsPerSecond
    editor.playback.seek({ time: Math.min(getPreviewDuration(editor), Math.max(0, Math.round(raw * fps) / fps)) })
  }

  const selectShot = (shotId?: string) => {
    const latest = getDirectorPlanning(editor.project.getActive())
    if (latest && latest.selectedShotId !== shotId) setDirectorPlanning(editor, { ...latest, selectedShotId: shotId })
    editor.selection.clearSelection()
  }
  const runShots = async (shotIds?: string[]) => {
    const projectId = project.metadata.id
    setQueueProgress({ shotIds: [], index: 0, title: '正在准备生成队列' })
    try {
      const result = await generateAIShots(editor, shotIds, progress => {
        if (editor.project.getActiveOrNull()?.metadata.id === projectId) setQueueProgress(progress)
      })
      const completed = `已生成并取回 ${result.completed} 个镜头${result.merged ? `，合并 ${result.merged} 组相邻片段` : ''}`
      toast.success(`${completed}${result.skipped.length ? `，跳过 ${result.skipped.length} 个未备齐片段` : ''}`,
        { description: result.skipped[0] })
    } catch (error) { toast.error('生成队列已停止', { description: (error as Error).message }) }
    finally { if (editor.project.getActiveOrNull()?.metadata.id === projectId) setQueueProgress(null) }
  }

  const openDraft = (shot?: EditingDirectorShot, mode: GenerationMode = 'T2VA') => {
    if (shot) selectShot(shot.id)
    setEditingShotId(shot?.id)
    const referenceEdit = shot && planning?.scenes.find(scene => scene.id === shot.sceneId)?.settings.task_type === 'V2VARef'
    const characterSwap = shot && planning?.scenes.find(scene => scene.id === shot.sceneId)?.settings.task_type === 'CharacterSwap'
    const bodyRender = shot && planning?.scenes.find(scene => scene.id === shot.sceneId)?.settings.task_type === 'BodyRender'
    const relayVSR = shot && planning?.scenes.find(scene => scene.id === shot.sceneId)?.settings.task_type === 'RelayVSR'
    const motionTransfer = shot && planning?.scenes.find(scene => scene.id === shot.sceneId)?.settings.task_type === 'MotionTransfer'
    setGenerationMode(shot ? relayVSR ? 'RelayVSR' : motionTransfer ? 'MotionTransfer' : bodyRender ? 'BodyRender' : characterSwap ? 'CharacterSwap' : shot.taskType === 'v2v' ? referenceEdit ? 'V2VARef' : 'V2VA' : shot.taskType === 'r2v' ? 'Ref2VA' : shot.taskType === 'fl2v' ? 'FL2VA' : shot.taskType === 'i2v' ? 'I2VA' : 'T2VA' : mode)
    if (shot) setGenerationPosition({ trackIndex: shot.trackIndex ?? 0, startTime: shot.startTime })
    setGenerationOpen(true)
  }
  const saveDraft = (values: Record<string, unknown>) => {
    const before = getDirectorPlanning(editor.project.getActive()) ?? { schemaVersion: 1, scenes: [], assetMap: {}, trackCount }
    const after = saveTextToVideoDraft(before, generationPosition, values, editingShotId)
    editor.command.execute({ command: new ChangeAITracks(editor, before, after) })
    return after.selectedShotId!
  }
  const generate = (moduleId: string, values: Record<string, unknown>) => {
    const shotId = saveDraft(values)
    void generateTextToVideo(editor, shotId, moduleId, values).catch(error => toast.error('生成失败', { description: error.message }))
  }
  const beginDrag = (event: PointerEvent<HTMLDivElement>, shot: EditingDirectorShot) => {
    if (event.button !== 0) return
    event.stopPropagation()
    selectShot(shot.id)
    setSelected(shot.trackIndex ?? 0)
    if (shot.generationStatus === 'queued' || shot.generationStatus === 'running' || waitingShotIds.includes(shot.id)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-resize]')
    drag.current = { shot, x: event.clientX, y: event.clientY, scrollLeft: viewport.scrollLeft, pointerId: event.pointerId, projectId: project.metadata.id,
      side: (handle?.dataset.resize as 'left' | 'right' | undefined) ?? 'move' }
  }
  const dragPlacement = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId || state.projectId !== editor.project.getActive().metadata.id) return null
    const delta = event.clientX - state.x + viewport.scrollLeft - state.scrollLeft
    if (Math.abs(delta) < 2 && (state.side !== 'move' || Math.abs(event.clientY - state.y) < 2) && !placement) return null
    let trackIndex = state.shot.trackIndex ?? 0
    if (state.side === 'move' && body.current) {
      const rows = [...body.current.querySelectorAll<HTMLElement>('[data-ai-track-index]')]
      const row = rows.find(row => { const rect = row.getBoundingClientRect(); return event.clientY >= rect.top && event.clientY < rect.bottom })
      if (row) trackIndex = Number(row.dataset.aiTrackIndex)
      else if (rows.length) trackIndex = event.clientY < rows[0].getBoundingClientRect().top ? -1 : trackCount
    }
    const motionTransfer = planning?.scenes.find(scene => scene.id === state.shot.sceneId)?.settings.task_type === 'MotionTransfer'
    return { shotId: state.shot.id, trackIndex, ...textToVideoPlacement(state.shot.startTime, state.shot.duration, delta / pixelsPerSecond, state.side, motionTransfer ? 'MotionTransfer' : undefined) }
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const next = dragPlacement(event)
    drag.current = null
    setPlacement(null)
    const before = getDirectorPlanning(editor.project.getActive())
    if (next && before && findDirectorShot(before, next.shotId)) {
      const after = updateTextToVideoTiming(before, next.shotId, next)
      editor.command.execute({ command: new ChangeAITracks(editor, before, after) })
      setSelected(findDirectorShot(after, next.shotId)?.trackIndex ?? null)
    }
  }

  return <section ref={origin} className="ai-tracks-panel" aria-label="AI 多轨时间线">
    <header className="ai-tracks-header">
      <div><Clapperboard size={15} /><strong>AI 轨道</strong>
        <button type="button" role="switch" aria-checked={guideEnabled} disabled={!planning || anyGenerating || Boolean(queueProgress)}
          title="同轨相邻镜头可从上一段末尾接着生成" onClick={() => { if (planning) change({ ...planning, aiTrackGuideEnabled: !guideEnabled }) }}>
          <i className="ai-guide-toggle" aria-hidden="true" />段间引导
        </button><span>{trackCount} 条轨道</span>
      </div>
      <div>
        <button type="button" aria-pressed={selectionMode} disabled={!shots.length || anyGenerating || Boolean(queueProgress)} title="勾选需要生成的 AI 片段，再点击生成已选" onClick={() => { setSelectionMode(!selectionMode); setCheckedShotIds([]) }}><ListChecks size={13} />{selectionMode ? '取消选择' : '选择生成'}</button>
        <button type="button" disabled={!selectedShot || anyGenerating || Boolean(queueProgress)} title={selectedShot ? `生成选中的镜头：${selectedShot.title}` : '请先点击一个 AI 片段'} onClick={() => void runShots([selectedShot!.id])}><WandSparkles size={13} />生成当前镜头</button>
        <label className="ai-output-mode">输出方式
          <select value={outputMode} disabled={!planning || anyGenerating || Boolean(queueProgress)} title="全部导出只合并同轨首尾相接的片段，其余片段单独导出"
            onChange={event => { if (planning) change({ ...planning, aiTrackOutputMode: event.currentTarget.value === 'all' ? 'all' : 'segments' }) }}>
            <option value="segments">分段导出</option><option value="all">全部导出</option>
          </select>
        </label>
        <button type="button" disabled={!(selectionMode ? checkedShots.length : shots.length) || anyGenerating || Boolean(queueProgress)} title={selectionMode ? '只生成打勾的 AI 片段，取回视频后再生成下一段' : '按时间顺序生成所有 AI 轨道中已备齐的片段，已生成的也会重新生成，取回视频后再生成下一段'} onClick={() => void runShots(selectionMode ? checkedShots.map(shot => shot.id) : undefined)}>{queueProgress ? <LoaderCircle size={13} className="spin" /> : <Play size={13} />}{queueProgress ? '队列执行中' : selectionMode ? `生成已选（${checkedShots.length}）` : '批量生成'}</button>
        <button type="button" disabled={!trackCount} onClick={() => { setGenerationPosition({ trackIndex: activeRow ?? 0, startTime: currentTime }); openDraft() }}><Sparkles size={13} />文生视频</button>
        <button type="button" onClick={addTrack}><Plus size={14} />添加 AI 轨道</button>
      </div>
    </header>
    <div className="ai-tracks-body" ref={body} style={{ '--ai-label-width': `${labelWidth}px` } as CSSProperties}
      onPointerMove={event => {
        const next = dragPlacement(event)
        if (next) { event.currentTarget.setPointerCapture(event.pointerId); setPlacement(next) }
      }}
      onPointerUp={endDrag}
      onPointerCancel={() => { drag.current = null; setPlacement(null) }}
      onLostPointerCapture={event => { if (event.target === event.currentTarget) { drag.current = null; setPlacement(null) } }}>
      <div className="ai-tracks-ruler">
        <div className="ai-tracks-ruler-label">AI</div>
        <div className="ai-tracks-ruler-time" onPointerDown={event => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          seek(event.clientX, event.currentTarget.getBoundingClientRect().left)
        }} onPointerMove={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            seek(event.clientX, event.currentTarget.getBoundingClientRect().left)
        }}>
          {Array.from({ length: tickCount }, (_, index) => {
            const time = (tickStart + index) * tickIntervalSeconds
            const major = shouldShowLabel({ time, labelIntervalSeconds })
            return <span key={tickStart + index} className={major ? 'major' : ''} style={{ left: time * pixelsPerSecond - viewport.scrollLeft }}>
              {major ? formatRulerLabel({ timeInSeconds: time, fps }) : ''}
            </span>
          })}
        </div>
      </div>
      {Array.from({ length: trackCount }, (_, index) => {
        const rowShots = shots.filter(shot => (shot.trackIndex ?? 0) === index)
        return <div key={index} data-ai-track-index={index}
          className={`ai-track-row ${activeRow === index ? 'selected' : ''} ${placement?.trackIndex === index ? 'drop-target' : ''} ${index === 0 && placement?.trackIndex === -1 ? 'drop-before' : ''}`}>
          <div className="ai-track-label">
            <button type="button" aria-label={`选择 AI 轨道 ${index + 1}`} aria-pressed={activeRow === index} onClick={() => setSelected(index)}>AI {index + 1}</button>
            <button type="button" aria-label={`删除 AI 轨道 ${index + 1}`} title={rowShots.length ? '请先移除轨道中的镜头' : '删除空轨道'} disabled={rowShots.length > 0} onClick={() => deleteTrack(index)}><Trash2 size={12} /></button>
          </div>
          <ContextMenu><ContextMenuTrigger asChild><div className="ai-track-lane" role="button" tabIndex={0} aria-label={`AI 轨道 ${index + 1}，${rowShots.length ? `${rowShots.length} 个镜头` : '空白'}`}
            onContextMenu={event => {
              const raw = event.clientX ? (event.clientX - event.currentTarget.getBoundingClientRect().left + viewport.scrollLeft) / pixelsPerSecond : currentTime
              const shotId = (event.target as HTMLElement).closest<HTMLElement>('[data-ai-shot]')?.dataset.aiShot
              setContextShotId(shotId)
              selectShot(shotId)
              setSelected(index)
              setGenerationPosition({ trackIndex: index, startTime: Math.max(0, Math.round(raw * fps) / fps) })
            }}
            onClick={() => { setSelected(index); selectShot() }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(index) } }}
            onWheel={event => { if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) requestTimelineScroll(viewport.scrollLeft + (event.deltaX || event.deltaY)) }}>
            {!rowShots.length && <span className="ai-track-empty"><Plus size={15} />空白 AI 轨道</span>}
            {guideEnabled && !placement && rowShots.filter(shot => predecessors.has(shot.id)).map(shot => {
              const linked = shot.aiTrackTransition !== 'cut'
              return <div key={`seam-${shot.id}`} className="ai-shot-seam" data-linked={linked}
                style={{ left: shot.startTime * pixelsPerSecond - viewport.scrollLeft }}
                onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
                onKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}>
                <button type="button" aria-pressed={linked} aria-label={`${shot.title}段间引导：${linked ? '引用上段' : '硬切'}`}
                  title={linked ? '引用上段末尾画面和音频，点击切换为硬切' : '硬切，点击切换为引用上段'}
                  disabled={anyGenerating || Boolean(queueProgress)}
                  onClick={() => { if (planning) change(updateDirectorShot(planning, shot.id, { aiTrackTransition: linked ? 'cut' : 'guide' })) }}>
                  {linked ? '引用上段' : '硬切'}
                </button>
                {linked && <select aria-label={`${shot.title}引用上段帧数`} title="引用上一段末尾的画面和音频帧数"
                  value={getAIShotGuideFrames(shot)} disabled={anyGenerating || Boolean(queueProgress)}
                  onChange={event => { if (planning) change(updateDirectorShot(planning, shot.id, { aiTrackGuideFrames: Number(event.currentTarget.value) })) }}>
                  {AI_SHOT_GUIDE_FRAMES.map(frames => <option key={frames} value={frames}>{frames} 帧</option>)}
                </select>}
              </div>
            })}
            {rowShots.map(shot => {
              const relayVSR = planning?.scenes.find(scene => scene.id === shot.sceneId)?.settings.task_type === 'RelayVSR'
              const slot = getTextToVideoSlot(editor, shot.id)
              const generating = shot.generationStatus === 'queued' || shot.generationStatus === 'running'
              const status = waitingShotIds.includes(shot.id) ? '等待批量生成' : ({ idle: '待生成', queued: '排队中', running: slot?.stage ?? '生成中', succeeded: '已生成', failed: '生成失败' })[shot.generationStatus]
              return <div key={shot.id} data-ai-shot={shot.id} data-start-time={shot.startTime} data-duration={shot.duration}
                className={`ai-track-existing-shot status-${shot.generationStatus} ${selectionMode ? 'has-generation-checkbox' : ''} ${selectionMode && checkedShotIds.includes(shot.id) ? 'checked-for-generation' : ''} ${selectedShot?.id === shot.id ? 'selected' : ''} ${placement?.shotId === shot.id && placement.trackIndex !== index ? 'dragging-away' : ''}`} role="button" tabIndex={0} aria-pressed={selectedShot?.id === shot.id}
                aria-label={`${shot.title} · ${shot.duration.toFixed(2)} 秒 · ${status}`} title={slot?.error || `${shot.title} · ${shot.duration.toFixed(2)} 秒 · ${status}；双击编辑参数${relayVSR ? '' : '，拖两端调整时长'}`}
                style={{ left: shot.startTime * pixelsPerSecond - viewport.scrollLeft, width: Math.max(12, shot.duration * pixelsPerSecond) }}
                onPointerDown={event => beginDrag(event, shot)}
                onClick={event => { event.stopPropagation(); selectShot(shot.id); setSelected(index) }}
                onDoubleClick={event => { event.stopPropagation(); openDraft(shot) }}
                onKeyDown={event => {
                  if (event.key === 'Enter') { event.stopPropagation(); openDraft(shot) }
                  if (event.key === ' ') { event.preventDefault(); event.stopPropagation(); selectShot(shot.id); setSelected(index) }
                }}>
                {generating && <span className="director-generation-progress" role="progressbar" aria-label={`${shot.title}采样进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={slot?.progress ?? 0} style={{ width: `${slot?.progress ?? 0}%` }} />}
                {selectionMode && <input type="checkbox" className="ai-shot-generation-checkbox" checked={checkedShotIds.includes(shot.id)} disabled={anyGenerating || Boolean(queueProgress)}
                  aria-label={`选择生成：${shot.title}，AI ${index + 1}，${shot.startTime.toFixed(2)} 秒开始`}
                  onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
                  onChange={event => { const checked = event.currentTarget.checked; setCheckedShotIds(ids => checked ? [...ids, shot.id] : ids.filter(id => id !== shot.id)) }} />}
                <span className="ai-shot-copy">{shot.title} · {shot.duration.toFixed(2)} 秒 <small>{status}{slot?.progress === undefined ? '' : ` · ${slot.progress}%`}</small></span>
                {!generating && !relayVSR && <><span className="ai-shot-resize left" data-resize="left" aria-label="调整 AI 片段起点" /><span className="ai-shot-resize right" data-resize="right" aria-label="调整 AI 片段终点" /></>}
              </div>
            })}
            {placement?.trackIndex === index && movingShot && (movingShot.trackIndex ?? 0) !== index && <div className="ai-track-existing-shot ai-shot-drop-preview" aria-hidden="true"
              style={{ left: placement.startTime * pixelsPerSecond - viewport.scrollLeft, width: Math.max(12, placement.duration * pixelsPerSecond) }}>
              <span className="ai-shot-copy">{movingShot.title} · {placement.duration.toFixed(2)} 秒<small>松开移入此轨道</small></span>
            </div>}
          </div></ContextMenuTrigger><ContextMenuContent>
            <ContextMenuItem onSelect={() => openDraft(shots.find(shot => shot.id === contextShotId))}><Sparkles size={14} />{contextShotId ? '编辑参数 / 生成' : '文生视频'}</ContextMenuItem>
            {!contextShotId && <ContextMenuItem onSelect={() => openDraft(undefined, 'I2VA')}><ImagePlus size={14} />图生视频</ContextMenuItem>}
            {!contextShotId && <ContextMenuItem onSelect={() => openDraft(undefined, 'FL2VA')}><Clapperboard size={14} />首尾帧生视频</ContextMenuItem>}
            {!contextShotId && <ContextMenuItem onSelect={() => openDraft(undefined, 'Ref2VA')}><Images size={14} />多参考生视频</ContextMenuItem>}
            {!contextShotId && <ContextMenuItem onSelect={() => openDraft(undefined, 'V2VA')}><Video size={14} />视频编辑</ContextMenuItem>}
            {!contextShotId && <ContextMenuItem onSelect={() => openDraft(undefined, 'V2VARef')}><Images size={14} />视频+参考修改</ContextMenuItem>}
            {!contextShotId && <ContextMenuItem onSelect={() => openDraft(undefined, 'CharacterSwap')}><UserRound size={14} />人物替换</ContextMenuItem>}
            {!contextShotId && <ContextMenuItem onSelect={() => openDraft(undefined, 'BodyRender')}><Box size={14} />视频转白模</ContextMenuItem>}
            {!contextShotId && <ContextMenuItem onSelect={() => openDraft(undefined, 'MotionTransfer')}><Activity size={14} />动作迁移</ContextMenuItem>}
            {!contextShotId && <ContextMenuItem onSelect={() => openDraft(undefined, 'RelayVSR')}><Maximize2 size={14} />Relay VSR 视频放大</ContextMenuItem>}
            {contextShotId && <ContextMenuItem disabled={waitingShotIds.includes(contextShotId) || shots.some(shot => shot.id === contextShotId && ['queued', 'running'].includes(shot.generationStatus))} onSelect={() => {
              const before = getDirectorPlanning(editor.project.getActive())
              if (before) change(removeDirectorShot(before, contextShotId))
            }}><Trash2 size={14} />删除 AI 片段</ContextMenuItem>}
          </ContextMenuContent></ContextMenu>
        </div>
      })}
      {placement?.trackIndex === trackCount && <div className="ai-track-drop-new"><Plus size={14} />松开新建 AI 轨道</div>}
      {!trackCount && <div className="ai-tracks-empty">点击“添加 AI 轨道”创建轨道</div>}
      {trackCount > 0 && playheadOffset >= 0 && <div className="ai-tracks-playhead" aria-hidden="true" style={{ left: labelWidth + playheadOffset }} />}
    </div>
    <footer className="ai-tracks-footer"><span role="status">{queueProgress ? queueProgress.shotIds.length ? queueProgress.index >= queueProgress.shotIds.length ? queueProgress.title : `生成 ${queueProgress.index + 1}/${queueProgress.shotIds.length} · ${queueProgress.title}` : queueProgress.title : selectionMode ? `已勾选 ${checkedShots.length} 个镜头 · 点击“生成已选”只生成打勾片段` : placement && (placement.trackIndex < 0 || placement.trackIndex === trackCount) ? '松开新建 AI 轨道' : selectedShot ? `已选择：${selectedShot.title}` : activeRow === null ? '选择一条 AI 轨道' : `已选择 AI ${activeRow + 1}`}</span><span>上下拖动换轨 · 双击编辑 · 拖两端调整时长</span></footer>
    {generationMode === 'MotionTransfer' ? <MotionTransferDialog open={generationOpen} onOpenChange={setGenerationOpen}
      position={editingShot ? { startTime: editingShot.startTime, trackIndex: editingShot.trackIndex ?? 0 } : generationPosition}
      draftId={editingShotId} initialValues={editingScene && editingShot ? { ...editingScene.settings,
        source_video: editingShot.refVideos[0]?.assetId ?? '', character_images: editingShot.refs.map(ref => ref.assetId),
        character_slots: editingShot.refs.map(ref => ref.index), duration: editingShot.duration } : undefined}
      busy={busy} generationError={editingSlot?.error} onSave={saveDraft} onGenerate={generate} />
    : (generationMode === 'BodyRender' || generationMode === 'RelayVSR') ? <BodyRenderDialog mode={generationMode} open={generationOpen} onOpenChange={setGenerationOpen}
      position={editingShot ? { startTime: editingShot.startTime, trackIndex: editingShot.trackIndex ?? 0 } : generationPosition}
      draftId={editingShotId} initialValues={editingScene && editingShot ? { ...editingScene.settings,
        source_video: editingShot.refVideos[0]?.assetId ?? '', duration: editingShot.duration } : undefined}
      busy={busy} generationError={editingSlot?.error} onSave={saveDraft} onGenerate={generate} />
    : generationMode === 'CharacterSwap' ? <CharacterSwapDialog open={generationOpen} onOpenChange={setGenerationOpen}
      position={editingShot ? { startTime: editingShot.startTime, trackIndex: editingShot.trackIndex ?? 0 } : generationPosition}
      draftId={editingShotId} initialValues={editingScene && editingShot ? { ...editingScene.settings,
        source_video: editingShot.refVideos[0]?.assetId ?? '', character_image: editingShot.refs[0]?.assetId ?? '', duration: editingShot.duration } : undefined}
      busy={busy} generationError={editingSlot?.error} onSave={saveDraft} onGenerate={generate} />
    : <TextToVideoDialog open={generationOpen} onOpenChange={setGenerationOpen} mode={generationMode} position={editingShot ? { startTime: editingShot.startTime, trackIndex: editingShot.trackIndex ?? 0 } : generationPosition}
      draftId={editingShotId} guideFrames={editingShot?.guideSourceAssetId ? getAIShotGuideFrames(editingShot) : undefined} initialValues={editingScene && editingShot ? { ...editingScene.settings, first_frame: editingShot.firstFrameAssetId ?? editingShot.imageAssetId ?? '',
        last_frame: editingShot.lastFrameAssetId ?? '', ref_images: editingShot.refs.map(ref => ref.assetId), ref_videos: editingShot.refVideos.map(ref => ref.assetId),
        ref_audios: editingShot.refAudios.map(ref => ref.assetId), prompt: editingShot.prompt, duration: editingShot.duration } : undefined}
      busy={busy} generationError={editingSlot?.error} onSave={saveDraft} onGenerate={generate} />}
  </section>
}
