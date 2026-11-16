export type ClipFilterCategory = 'basic' | 'daily' | 'cinematic' | 'film' | 'mono'

export interface ClipFilterParameters {
  brightness: number
  contrast: number
  saturation: number
  gamma: number
  hue: number
  temperature: number
  tint: number
  fade: number
  vignette: number
  grain: number
  cinematic: number
  red: number
  green: number
  blue: number
}

export interface ClipFilterPreset {
  id: string
  name: string
  category: ClipFilterCategory
  previewFilter: string
  parameters: ClipFilterParameters
}

export interface DesktopClipFilter {
  id: string
  name: string
  enabled: boolean
  intensity: number
  parameters: ClipFilterParameters
}

export const CLIP_FILTER_CATEGORIES: ReadonlyArray<{
  id: 'all' | ClipFilterCategory
  label: string
}> = [
  { id: 'all', label: '全部' },
  { id: 'daily', label: '日常' },
  { id: 'cinematic', label: '电影' },
  { id: 'film', label: '胶片' },
  { id: 'mono', label: '黑白' }
]

const NEUTRAL_PARAMETERS: ClipFilterParameters = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  hue: 0,
  temperature: 0,
  tint: 0,
  fade: 0,
  vignette: 0,
  grain: 0,
  cinematic: 0,
  red: 1,
  green: 1,
  blue: 1
}

export function getNeutralClipFilterParameters(): ClipFilterParameters {
  return { ...NEUTRAL_PARAMETERS }
}

function parameters(overrides: Partial<ClipFilterParameters>): ClipFilterParameters {
  return { ...NEUTRAL_PARAMETERS, ...overrides }
}

export const CLIP_FILTER_PRESETS: readonly ClipFilterPreset[] = [
  {
    id: 'original',
    name: '原片',
    category: 'basic',
    previewFilter: 'none',
    parameters: parameters({})
  },
  {
    id: 'clear',
    name: '清透',
    category: 'daily',
    previewFilter: 'brightness(1.06) contrast(1.05) saturate(1.08)',
    parameters: parameters({ brightness: 1.05, contrast: 1.04, saturation: 1.08, gamma: 1.02 })
  },
  {
    id: 'warm-sun',
    name: '暖阳',
    category: 'daily',
    previewFilter: 'brightness(1.05) contrast(1.04) saturate(1.15) sepia(0.13)',
    parameters: parameters({
      brightness: 1.04,
      contrast: 1.03,
      saturation: 1.12,
      temperature: 0.28,
      tint: 0.03,
      red: 1.03,
      blue: 0.97
    })
  },
  {
    id: 'cool-white',
    name: '冷白',
    category: 'daily',
    previewFilter: 'brightness(1.09) contrast(1.05) saturate(0.92) hue-rotate(4deg)',
    parameters: parameters({
      brightness: 1.08,
      contrast: 1.04,
      saturation: 0.92,
      temperature: -0.24,
      tint: 0.04,
      red: 0.98,
      blue: 1.04
    })
  },
  {
    id: 'soft-portrait',
    name: '柔和',
    category: 'daily',
    previewFilter: 'brightness(1.08) contrast(0.92) saturate(0.95) sepia(0.05)',
    parameters: parameters({
      brightness: 1.07,
      contrast: 0.92,
      saturation: 0.94,
      gamma: 1.08,
      temperature: 0.08,
      fade: 0.05
    })
  },
  {
    id: 'vivid',
    name: '鲜明',
    category: 'daily',
    previewFilter: 'brightness(1.02) contrast(1.16) saturate(1.3)',
    parameters: parameters({ brightness: 1.01, contrast: 1.16, saturation: 1.28 })
  },
  {
    id: 'teal-orange',
    name: '青橙',
    category: 'cinematic',
    previewFilter: 'contrast(1.16) saturate(1.14) sepia(0.08) hue-rotate(-7deg)',
    parameters: parameters({
      contrast: 1.15,
      saturation: 1.12,
      temperature: 0.05,
      cinematic: 0.78,
      vignette: 0.12
    })
  },
  {
    id: 'cinema-cool',
    name: '冷调电影',
    category: 'cinematic',
    previewFilter: 'brightness(0.96) contrast(1.2) saturate(0.86) hue-rotate(8deg)',
    parameters: parameters({
      brightness: 0.96,
      contrast: 1.2,
      saturation: 0.86,
      gamma: 0.96,
      temperature: -0.2,
      cinematic: 0.35,
      vignette: 0.22,
      blue: 1.04
    })
  },
  {
    id: 'moody',
    name: '暗调',
    category: 'cinematic',
    previewFilter: 'brightness(0.9) contrast(1.24) saturate(0.82)',
    parameters: parameters({
      brightness: 0.91,
      contrast: 1.22,
      saturation: 0.82,
      gamma: 0.95,
      vignette: 0.3
    })
  },
  {
    id: 'night',
    name: '夜景',
    category: 'cinematic',
    previewFilter: 'brightness(1.03) contrast(1.18) saturate(1.12) hue-rotate(7deg)',
    parameters: parameters({
      brightness: 1.04,
      contrast: 1.18,
      saturation: 1.1,
      gamma: 0.93,
      temperature: -0.16,
      vignette: 0.2,
      blue: 1.05
    })
  },
  {
    id: 'hong-kong',
    name: '港风',
    category: 'film',
    previewFilter: 'brightness(0.98) contrast(1.2) saturate(1.25) sepia(0.1)',
    parameters: parameters({
      brightness: 0.98,
      contrast: 1.18,
      saturation: 1.22,
      temperature: 0.2,
      tint: 0.08,
      grain: 0.08,
      vignette: 0.14
    })
  },
  {
    id: 'faded-film',
    name: '褪色胶片',
    category: 'film',
    previewFilter: 'contrast(0.91) saturate(0.82) sepia(0.11) brightness(1.04)',
    parameters: parameters({
      brightness: 1.02,
      contrast: 0.9,
      saturation: 0.82,
      temperature: 0.08,
      fade: 0.42,
      grain: 0.18,
      vignette: 0.12
    })
  },
  {
    id: 'vintage',
    name: '复古',
    category: 'film',
    previewFilter: 'contrast(1.07) saturate(0.78) sepia(0.24)',
    parameters: parameters({
      brightness: 0.98,
      contrast: 1.06,
      saturation: 0.78,
      temperature: 0.25,
      fade: 0.18,
      vignette: 0.22,
      grain: 0.12,
      red: 1.04,
      blue: 0.94
    })
  },
  {
    id: 'polaroid',
    name: '宝丽来',
    category: 'film',
    previewFilter: 'brightness(1.08) contrast(1.05) saturate(1.02) sepia(0.12)',
    parameters: parameters({
      brightness: 1.08,
      contrast: 1.05,
      saturation: 1.02,
      temperature: 0.15,
      tint: 0.04,
      fade: 0.12,
      vignette: 0.08
    })
  },
  {
    id: 'monochrome',
    name: '黑白',
    category: 'mono',
    previewFilter: 'grayscale(1) contrast(1.08)',
    parameters: parameters({ saturation: 0, contrast: 1.08 })
  },
  {
    id: 'noir',
    name: '黑色电影',
    category: 'mono',
    previewFilter: 'grayscale(1) brightness(0.92) contrast(1.38)',
    parameters: parameters({
      brightness: 0.94,
      contrast: 1.35,
      saturation: 0,
      gamma: 0.94,
      vignette: 0.36,
      grain: 0.08
    })
  },
  {
    id: 'silver-screen',
    name: '银幕',
    category: 'mono',
    previewFilter: 'grayscale(0.95) contrast(1.18) brightness(1.02)',
    parameters: parameters({
      brightness: 1.02,
      contrast: 1.18,
      saturation: 0.05,
      gamma: 0.9,
      temperature: -0.05,
      grain: 0.16,
      vignette: 0.16
    })
  }
]

const PARAMETER_RANGES: Record<keyof ClipFilterParameters, readonly [number, number]> = {
  brightness: [0, 2],
  contrast: [0, 2],
  saturation: [0, 2],
  gamma: [0.25, 4],
  hue: [-180, 180],
  temperature: [-1, 1],
  tint: [-1, 1],
  fade: [0, 1],
  vignette: [0, 1],
  grain: [0, 1],
  cinematic: [0, 1],
  red: [0, 2],
  green: [0, 2],
  blue: [0, 2]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeParameters(value: unknown): ClipFilterParameters | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<Record<keyof ClipFilterParameters, unknown>>
  const normalized = { ...NEUTRAL_PARAMETERS }
  for (const key of Object.keys(PARAMETER_RANGES) as Array<keyof ClipFilterParameters>) {
    const parameter = candidate[key]
    if (parameter === undefined) continue
    if (typeof parameter !== 'number' || !Number.isFinite(parameter)) return null
    const [min, max] = PARAMETER_RANGES[key]
    normalized[key] = clamp(parameter, min, max)
  }
  return normalized
}

export function createClipFilter(preset: ClipFilterPreset): DesktopClipFilter {
  return {
    id: preset.id,
    name: preset.name,
    enabled: true,
    intensity: 1,
    parameters: { ...preset.parameters }
  }
}

export function createNeutralClipFilter(
  id = 'adjustment',
  name = '基础调节'
): DesktopClipFilter {
  return {
    id,
    name,
    enabled: true,
    intensity: 1,
    parameters: getNeutralClipFilterParameters()
  }
}

export function normalizeClipFilter(value: unknown): DesktopClipFilter | null {
  if (!value || typeof value !== 'object') return null
  const filter = value as Partial<DesktopClipFilter>
  const parameters = normalizeParameters(filter.parameters)
  if (
    typeof filter.id !== 'string' ||
    typeof filter.name !== 'string' ||
    typeof filter.enabled !== 'boolean' ||
    typeof filter.intensity !== 'number' ||
    !Number.isFinite(filter.intensity) ||
    !parameters
  ) {
    return null
  }
  return {
    id: filter.id,
    name: filter.name,
    enabled: filter.enabled,
    intensity: clamp(filter.intensity, 0, 1),
    parameters
  }
}
