/** Desktop-owned persistence and communication boundary for the Cutia module. */
export const EDITING_PROJECT_VERSION = 3
export const EDITING_BRIDGE_CHANNEL = 'raccoon-editing-v1'

export interface EditingCanvasSizePreset {
  value: `${number}x${number}`
  label: string
  width: number
  height: number
}

/**
 * Canvas sizes offered by the native editing project dialog. Keep the value
 * in width x height form so it can be passed directly to the editor bridge.
 */
export const EDITING_CANVAS_SIZE_PRESETS: readonly EditingCanvasSizePreset[] = [
  { value: '1920x1080', label: '横屏 16:9 · 1080p', width: 1920, height: 1080 },
  { value: '1080x1920', label: '竖屏 9:16 · 1080p', width: 1080, height: 1920 },
  { value: '1080x1080', label: '方形 1:1', width: 1080, height: 1080 },
  { value: '1280x720', label: '横屏 16:9 · 720p', width: 1280, height: 720 },
  { value: '2560x1440', label: '横屏 16:9 · 2K', width: 2560, height: 1440 },
  { value: '1440x2560', label: '竖屏 9:16 · 2K', width: 1440, height: 2560 },
  { value: '2560x2560', label: '方形 1:1 · 2K', width: 2560, height: 2560 },
  { value: '3840x2160', label: '横屏 16:9 · 4K', width: 3840, height: 2160 },
  { value: '2160x3840', label: '竖屏 9:16 · 4K', width: 2160, height: 3840 },
  { value: '3840x3840', label: '方形 1:1 · 4K', width: 3840, height: 3840 }
] as const

export type EditingExportResolution = 'project' | '2k' | '4k'

export const EDITING_EXPORT_RESOLUTIONS: readonly {
  value: EditingExportResolution
  label: string
}[] = [
  { value: 'project', label: '项目尺寸' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' }
] as const

/** Scale the current project canvas to a target long edge while preserving its aspect ratio. */
export const resolveEditingExportCanvasSize = (
  source: { width: number; height: number },
  resolution: EditingExportResolution
): { width: number; height: number } => {
  if (resolution === 'project') return { width: source.width, height: source.height }
  const longEdge = resolution === '4k' ? 3840 : 2560
  if (source.width === source.height) return { width: longEdge, height: longEdge }
  if (source.width > source.height) {
    return {
      width: longEdge,
      height: Math.max(2, Math.round((longEdge * source.height) / source.width / 2) * 2)
    }
  }
  return {
    width: Math.max(2, Math.round((longEdge * source.width) / source.height / 2) * 2),
    height: longEdge
  }
}

export interface EditingProjectDocument {
  metadata: {
    id: string
    name: string
    duration: number
    createdAt: string
    updatedAt: string
    thumbnail?: string
  }
  scenes: Array<{
    id: string
    name: string
    isMain: boolean
    tracks: Array<Record<string, unknown>>
    bookmarks: number[]
    createdAt: string
    updatedAt: string
  }>
  currentSceneId: string
  settings: {
    fps: number
    canvasSize: { width: number; height: number }
    background: Record<string, unknown>
    originalCanvasSize?: { width: number; height: number } | null
  }
  version: number
  timelineViewState?: { zoomLevel: number; scrollLeft: number; playheadTime: number }
  agentMessages?: unknown[]
  directorPlanning?: EditingDirectorPlanningState
  directorLibrary?: EditingDirectorLibraryItem[]
  cover?: EditingProjectCover
}

export interface EditingProjectCover {
  sourceAssetId: string
  origin: 'frame' | 'image'
  time?: number
  fit: 'contain' | 'cover'
  zoom: number
  offsetX: number
  offsetY: number
  title: string
  titleColor: string
  titleSize: number
  titleX: number
  titleY: number
}

export type EditingDirectorTaskType = 't2v' | 'i2v' | 'fl2v' | 'r2v' | 'v2v' | 'rv2v'

export interface EditingDirectorOutputVersion {
  id: string
  assetId: string
  generationId: string
  createdAt: string
  duration: number
  status: 'ready' | 'failed'
  error?: string
  linkedVideoElementId?: string
}

/** A generated video is committed to project media before it is sent to an editor page. */
export interface EditingDirectorGenerationOutput {
  shotId: string
  shotIds: string[]
  generationId: string
  media: EditingMediaMetadata
  durationSeconds: number
  name: string
}

export interface EditingDirectorGenerationJob {
  id: string
  /** Identifies the timeline slots reserved before this host job starts. */
  clientRequestId?: string
  shotIds: string[]
  status: 'running' | 'completed' | 'failed'
  outputs: EditingDirectorGenerationOutput[]
  errors: Array<{ shotId: string; error: string }>
  /** Per-output progress; absent on jobs created by older hosts. */
  progress?: EditingDirectorGenerationProgress[]
}

export interface EditingDirectorGenerationProgress {
  shotIds: string[]
  percent: number
  stage: string
}

export interface EditingDirectorGenerationSlot {
  aiTrackBatch?: true
  requestId: string
  sceneId: string
  shotIds: string[]
  status: 'queued' | 'running' | 'failed'
  error?: string
  progress?: number
  stage?: string
}

export function isEditingDirectorGenerationPlaceholder(value: unknown): value is {
  type: 'video'; directorGeneration: EditingDirectorGenerationSlot
} {
  const item = value as { type?: unknown; directorGeneration?: EditingDirectorGenerationSlot } | null
  return item?.type === 'video' && typeof item.directorGeneration?.requestId === 'string' &&
    Array.isArray(item.directorGeneration.shotIds)
}

export interface EditingDirectorShot {
  id: string
  sceneId: string
  sceneTitle: string
  sourceSegmentId?: string
  title: string
  startTime: number
  duration: number
  /** Zero-based visual row inside the AI generation track. */
  trackIndex?: number
  /** Whether this AI clip is hidden from the preview layer. */
  hidden?: boolean
  prompt: string
  taskType: EditingDirectorTaskType
  continuityFromPrev: boolean
  /** AI timeline seam preference, separate from imported Director scene settings. */
  aiTrackTransition?: 'guide' | 'cut'
  aiTrackGuideFrames?: number
  /** Uploaded or materialized video whose ending supplies the continuation guide. */
  guideSourceAssetId?: string
  videoClipId?: string
  imageAssetId?: string
  firstFrameAssetId?: string
  lastFrameAssetId?: string
  refs: Array<{ assetId: string; index?: number; originalName?: string }>
  refVideos: Array<{ assetId: string; index?: number; originalName?: string }>
  refAudios: Array<{ assetId: string; index?: number; originalName?: string }>
  generationStatus: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'
  generationId?: string
  outputVersions: EditingDirectorOutputVersion[]
  activeOutputVersionId?: string
  linkedVideoElementId?: string
  targetDuration?: number
  actualDuration?: number
  durationResolution?: 'pending' | 'trim' | 'speed' | 'actual'
  sourceSnapshot?: Record<string, unknown>
}

export interface EditingDirectorScene {
  id: string
  title: string
  /** Editing-library item that created this independent planning copy. */
  sourceLibraryItemId?: string
  /** This scene was created directly from the editing timeline. */
  createdInEditing?: boolean
  settings: Record<string, unknown>
  shots: EditingDirectorShot[]
}

export interface EditingDirectorPlanningState {
  schemaVersion: 1
  source?: {
    kind: 'canvas-director'
    canvasProjectId: string
    canvasProjectName: string
    canvasNodeId: string
    importedAt: string
  }
  scenes: EditingDirectorScene[]
  assetMap: Record<string, string>
  selectedShotId?: string
  aiTrackGuideEnabled?: boolean
  aiTrackOutputMode?: 'segments' | 'all'
  /** Number of AI timeline rows, including empty rows. */
  trackCount?: number
  /** Persist one user-created empty AI row until director shots are added. */
  emptyTrack?: boolean
}

export interface EditingDirectorLibraryItem {
  id: string
  name: string
  source: EditingDirectorPlanningState['source']
  importedAt: string
  planning: EditingDirectorPlanningState
}

export interface EditingDirectorLibrarySummary {
  id: string
  name: string
  sourceProjectName: string
  sceneCount: number
  shotCount: number
  importedAt: string
  previewAssetId?: string
}

export interface EditingProjectSummary {
  id: string
  name: string
  duration: number
  createdAt: string
  updatedAt: string
  thumbnail?: string
  width: number
  height: number
  fps: number
}

export interface EditingMediaMetadata {
  id: string
  name: string
  type: 'image' | 'video' | 'audio'
  mimeType: string
  size: number
  lastModified: number
  width?: number
  height?: number
  duration?: number
  fps?: number
  ephemeral?: boolean
  thumbnailUrl?: string
  /** Source catalog entry, used to reuse a previously copied shared upload. */
  sharedSourceId?: string
}

/** A canvas-owned media asset that can be copied into an editing project. */
export interface EditingCanvasAssetSource {
  name: string
  type: 'image' | 'video' | 'audio'
  mimeType: string
  size: number
  lastModified: number
  width?: number
  height?: number
  duration?: number
  fps?: number
}

export interface EditingLibraryAsset {
  id: string
  name: string
  folderId: string | null
  type: 'image' | 'video' | 'audio' | 'workflow' | 'preset' | 'file'
  mimeType: string
  size: number
  previewUrl?: string
}

export interface EditingLibraryFolder {
  id: string
  parentId: string | null
  name: string
  assetCount: number
  childCount: number
  createdAt: number
  updatedAt: number
}

export interface EditingTransitionMetadata {
  id: string
  name: string
  displayNameZh?: string
  sourceName: string
  kind: 'shader'
  category: string
  sourceUrl: string
  remotePath: string
  sha256: string
  sizeBytes: number
  license: string
  author: string
  params?: {
    types?: Record<string, string>
    defaults?: Record<string, unknown>
  }
  downloadedAt: string
}

export interface EditingEffectMetadata {
  id: string
  name: string
  displayNameZh: string
  category: string
  categoryLabel: string
  tags: string[]
  classification: 'effect'
  runtime: {
    engine: string
    version: string
    entry: string
    peerDependencies?: Record<string, string>
    sourceFormat?: string[]
  }
  source: {
    provider: string
    repository: string
    commit: string
    paths: string[]
    license: string
    licenseFile: string
  }
  sourceUrl: string
  remotePath: string
  sha256: string
  sizeBytes: number
  downloadedAt: string
}

export interface EditingAudioMetadata {
  id: string
  name: string
  category: string
  categoryLabel: string
  sourceUrl: string
  remotePath: string
  sha256: string
  sizeBytes: number
  mimeType: string
  license: string
  author: string
  duration?: number
  downloadedAt: string
}

export interface EditingTextTemplateKeyframe {
  at: number
  opacity?: number
  x?: number
  y?: number
  scale?: number
  rotate?: number
  color?: string
}

export interface EditingTextTemplatePhase {
  duration: number
  easing?: string
  keyframes: EditingTextTemplateKeyframe[]
}

export interface EditingTextTemplateDefinition {
  schemaVersion: 1
  id: string
  name: string
  displayNameZh: string
  category: string
  categoryLabel: string
  tags: string[]
  description?: string
  style?: {
    fontSize?: number
    fontWeight?: 'normal' | 'bold'
    color?: string
    stroke?: { color: string; width: number }
    shadow?: { color: string; offsetX: number; offsetY: number; blur: number }
  }
  animation: {
    intro?: EditingTextTemplatePhase
    outro?: EditingTextTemplatePhase
  }
}

export interface EditingStaticTextStyleDefinition {
  schemaVersion: 1
  kind: 'static-text-style'
  id: string
  name: string
  displayNameZh: string
  category: string
  categoryLabel: string
  tags: string[]
  style: {
    fontFamily?: string
    fontSize?: number
    fontWeight?: 'normal' | 'bold'
    color?: string
    stroke?: { color: string; width: number }
    shadow?: { color: string; offsetX: number; offsetY: number; blur: number }
    backgroundColor?: string
    backgroundOpacity?: number
    backgroundBorderRadius?: number
    backgroundPaddingX?: number
    backgroundPaddingY?: number
  }
  source?: {
    repository?: string
    commit?: string
    file?: string
    presetId?: string
    originalName?: string
  }
  license?: string
}

export interface EditingTextTemplateMetadata {
  id: string
  name: string
  displayNameZh: string
  category: string
  categoryLabel: string
  tags: string[]
  sourceUrl: string
  remotePath: string
  sha256: string
  sizeBytes: number
  license: string
  author: string
  downloadedAt: string
}

export interface EditingFontMetadata {
  id: string
  family: string
  displayNameZh: string
  sourceUrl: string
  sourceRepository: string
  sourceCommit: string
  remotePath: string
  sha256: string
  sizeBytes: number
  mimeType: string
  license: string
  author: string
  downloadedAt: string
}

export type EditingCaptionPhase =
  | 'idle'
  | 'preparing-model'
  | 'downloading-model'
  | 'loading-model'
  | 'transcribing'
  | 'complete'
  | 'error'

export interface EditingCaptionRuntimeStatus {
  modelReady: boolean
  busy: boolean
  phase: EditingCaptionPhase
  progress?: number
  transferredBytes?: number
  totalBytes?: number
  detail?: string
}

export interface EditingCaptionSegment {
  startTime: number
  duration: number
  text: string
  speaker: string
}

export interface EditingCaptionTranscriptionResult {
  segments: EditingCaptionSegment[]
  elapsedSeconds: number
}

export type EditingCustomCutoutPhase =
  | 'idle'
  | 'downloading-model'
  | 'downloading-tracker'
  | 'loading-model'
  | 'loading-tracker'
  | 'segmenting'
  | 'tracking'
  | 'ready'
  | 'error'

export interface EditingCustomCutoutRuntimeStatus {
  modelReady: boolean
  trackingModelReady?: boolean
  busy: boolean
  phase: EditingCustomCutoutPhase
  progress?: number
  detail?: string
}

export interface EditingCustomCutoutPoint {
  x: number
  y: number
  positive: boolean
}

export interface EditingCustomCutoutSegmentResult {
  bytes: Uint8Array
  width: number
  height: number
  elapsedSeconds: number
}

export interface EditingCustomCutoutTrackingSession {
  sessionId: string
  elapsedSeconds: number
}

export type EditingCustomCutoutTrackingResult = EditingCustomCutoutSegmentResult

export type EditingOperation =
  | 'tools:fighting-design:open'
  | 'projects:list'
  | 'projects:create'
  | 'projects:load'
  | 'projects:save'
  | 'projects:rename'
  | 'projects:remove'
  | 'media:list'
  | 'media:read'
  | 'media:save'
  | 'media:update-metadata'
  | 'media:remove'
  | 'media:import-canvas-asset'
  | 'capcut:shot-guide-file'
  | 'capcut:concat-ai-shots'
  | 'library:list'
  | 'library:folders:list'
  | 'library:read'
  | 'media:fetch-url'
  | 'canvas-directors:list'
  | 'canvas-directors:read'
  | 'director:import-canvas'
  | 'director:library:list'
  | 'director:library:read'
  | 'director:generate'
  | 'director:generate-scene'
  | 'director:jobs:list'
  | 'director:jobs:ack'
  | 'director:skills'
  | 'director:models'
  | 'director:defaults:get'
  | 'director:defaults:save'
  | 'director:media:pick'
  | 'director:media:list-shared'
  | 'director:media:import-shared'
  | 'director:video:probe'
  | 'director:video:detect'
  | 'transitions:list'
  | 'transitions:save'
  | 'transitions:read'
  | 'effects:list'
  | 'effects:save'
  | 'effects:read'
  | 'effects:remove'
  | 'audio:list'
  | 'audio:save'
  | 'audio:read'
  | 'text-templates:list'
  | 'text-templates:save'
  | 'text-templates:read'
  | 'fonts:list'
  | 'fonts:save'
  | 'fonts:read'
  | 'fonts:fetch-url'
  | 'captions:status'
  | 'captions:transcribe'
  | 'custom-cutout:status'
  | 'custom-cutout:prewarm'
  | 'custom-cutout:segment'
  | 'custom-cutout:track:start'
  | 'custom-cutout:track:step'
  | 'custom-cutout:track:end'
  | 'custom-cutout:mask:save'
  | 'custom-cutout:mask:save-batch'
  | 'custom-cutout:mask:read'
  | 'custom-cutout:mask:remove'
  | 'export:save'

export interface EditingDesktopApi {
  getContext(): Promise<{ workspaceKey: string }>
  request(workspaceKey: string, operation: EditingOperation, payload?: unknown): Promise<any>
  setSessionActive(active: boolean): Promise<void>
  reportDiagnostic(input: EditingDiagnostic): Promise<void>
  onFlushRequested(callback: (requestId: string) => void): () => void
  completeFlush(requestId: string, error?: string): Promise<void>
}

export interface EditingDiagnostic {
  event: string
  projectId?: string
  detail?: string
}

export interface EditingBridgeMessage {
  channel: typeof EDITING_BRIDGE_CHANNEL
  session: string
  type: 'ready' | 'request' | 'response' | 'progress' | 'theme' | 'exit' | 'flush' | 'flushed' | 'diagnostic'
  id?: string
  operation?: EditingOperation
  payload?: any
  result?: any
  error?: string
}
