import { AlertCircle, Clock3, Loader2 } from 'lucide-react'
import { useEditor } from '@/hooks/use-editor'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { getDirectorPlanning, setDirectorPlanning } from './director-planning'
import type { DirectorGenerationPlaceholder as Placeholder } from './director-generation-placeholders'

export function DirectorGenerationPlaceholder({
  element,
  trackId,
  zoomLevel
}: {
  element: Placeholder
  trackId: string
  zoomLevel: number
}) {
  const editor = useEditor()
  const state = element.directorGeneration
  const label =
    state.status === 'failed' ? '生成失败' : state.status === 'queued' ? '等待生成' : '生成中'
  const progress = Number.isFinite(state.progress) ? Math.max(0, Math.min(100, Math.round(state.progress!))) : undefined
  const detail = state.status === 'running'
    ? `${label}${progress === undefined ? '' : ` ${progress}%`}${state.stage ? ` · ${state.stage}` : ''}`
    : label
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={`director-generation-placeholder status-${state.status}`}
          data-generation-placeholder={state.requestId}
          data-generation-status={state.status}
          data-timeline-element-id={element.id}
          data-timeline-track-id={trackId}
          style={{
            left: element.startTime * 50 * zoomLevel,
            width: element.duration * 50 * zoomLevel
          }}
          aria-label={`${element.name} · ${detail}`}
          title={state.error || `${element.name} · ${detail} · ${element.duration.toFixed(1)} 秒`}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            const planning = getDirectorPlanning(editor.project.getActive())
            if (planning)
              setDirectorPlanning(editor, { ...planning, selectedShotId: state.shotIds[0] })
          }}
        >
          {progress !== undefined && (
            <span
              className="director-generation-progress"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-label={`${element.name}生成进度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            />
          )}
          {state.status === 'failed' ? (
            <AlertCircle size={14} />
          ) : state.status === 'queued' ? (
            <Clock3 size={14} />
          ) : (
            <Loader2 size={14} className="spin" />
          )}
          <span className="director-generation-copy">
            <strong>{element.name}</strong>
            <small>{detail}</small>
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="z-200 w-40" onClick={(event) => event.stopPropagation()}>
        <ContextMenuItem
          onSelect={() =>
            editor.timeline.deleteElements({ elements: [{ trackId, elementId: element.id }] })
          }
        >
          移除占位
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
