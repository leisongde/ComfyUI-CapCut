export const EXPORT_QUALITY_VALUES = ['low', 'medium', 'high', 'very_high'] as const

export const EXPORT_FORMAT_VALUES = ['mp4', 'webm'] as const

export type ExportFormat = (typeof EXPORT_FORMAT_VALUES)[number]
export type ExportQuality = (typeof EXPORT_QUALITY_VALUES)[number]

export interface ExportOptions {
  format: ExportFormat
  quality: ExportQuality
  /** Optional output size. The scene is rendered at the project size and scaled to this size. */
  canvasSize?: { width: number; height: number }
  fps?: number
  includeAudio?: boolean
  onProgress?: ({ progress }: { progress: number }) => void
  onCancel?: () => boolean
}

export interface ExportResult {
  success: boolean
  buffer?: ArrayBuffer
  error?: string
  cancelled?: boolean
}
