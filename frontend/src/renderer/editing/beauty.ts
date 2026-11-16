export type BeautySkinTone = 'none' | 'rose' | 'ivory' | 'neutral' | 'warm' | 'bronze'

export interface FaceShapeSettings {
  smoothFace: number
  smallFace: number
  slimFace: number
  narrowFace: number
  jawline: number
  jawbone: number
  cheekbone: number
  shortFace: number
  vFace: number
  chinLength: number
}

export interface FacialFeatureSettings {
  bigEyes: number
  brightEyes: number
  eyeDistance: number
  eyeCorner: number
  eyeHeight: number
  eyeTilt: number
  noseSlim: number
  noseWing: number
  noseTip: number
  noseBridge: number
  noseLength: number
  mouthSize: number
  mouthWidth: number
  lipThickness: number
  mouthCorner: number
  philtrum: number
  browHeight: number
  browDistance: number
  browTilt: number
  browThickness: number
}

export interface BeautySettings {
  enabled: boolean
  smooth: number
  whiten: number
  evenSkin: number
  plump: number
  blemish: number
  nasolabial: number
  darkCircles: number
  clarity: number
  skinTone: BeautySkinTone
  faceShape: FaceShapeSettings
  facialFeatures: FacialFeatureSettings
}

export const DEFAULT_FACE_SHAPE_SETTINGS: FaceShapeSettings = {
  smoothFace: 0,
  smallFace: 0,
  slimFace: 0,
  narrowFace: 0,
  jawline: 0,
  jawbone: 0,
  cheekbone: 0,
  shortFace: 0,
  vFace: 0,
  chinLength: 0
}

export const DEFAULT_FACIAL_FEATURE_SETTINGS: FacialFeatureSettings = {
  bigEyes: 0,
  brightEyes: 0,
  eyeDistance: 0,
  eyeCorner: 0,
  eyeHeight: 0,
  eyeTilt: 0,
  noseSlim: 0,
  noseWing: 0,
  noseTip: 0,
  noseBridge: 0,
  noseLength: 0,
  mouthSize: 0,
  mouthWidth: 0,
  lipThickness: 0,
  mouthCorner: 0,
  philtrum: 0,
  browHeight: 0,
  browDistance: 0,
  browTilt: 0,
  browThickness: 0
}

export const DEFAULT_BEAUTY_SETTINGS: BeautySettings = {
  enabled: false,
  smooth: 0,
  whiten: 0,
  evenSkin: 0,
  plump: 0,
  blemish: 0,
  nasolabial: 0,
  darkCircles: 0,
  clarity: 0,
  skinTone: 'none',
  faceShape: { ...DEFAULT_FACE_SHAPE_SETTINGS },
  facialFeatures: { ...DEFAULT_FACIAL_FEATURE_SETTINGS }
}

export const BEAUTY_SKIN_TONES: ReadonlyArray<{
  id: BeautySkinTone
  label: string
  color: string | null
  rgb: readonly [number, number, number]
}> = [
  { id: 'none', label: '无', color: null, rgb: [1, 1, 1] },
  { id: 'rose', label: '粉嫩', color: '#9b6755', rgb: [0.69, 0.43, 0.36] },
  { id: 'ivory', label: '白皙', color: '#c4a59a', rgb: [0.8, 0.68, 0.64] },
  { id: 'neutral', label: '自然', color: '#b7aaa3', rgb: [0.74, 0.69, 0.67] },
  { id: 'warm', label: '暖肤', color: '#ba977c', rgb: [0.75, 0.61, 0.49] },
  { id: 'bronze', label: '小麦', color: '#9d7657', rgb: [0.63, 0.47, 0.34] }
]

export const BEAUTY_SKIN_KEYS = [
  'smooth',
  'whiten',
  'evenSkin',
  'plump',
  'blemish',
  'nasolabial',
  'darkCircles',
  'clarity'
] as const satisfies ReadonlyArray<keyof BeautySettings>

export const FACE_SHAPE_KEYS = Object.keys(DEFAULT_FACE_SHAPE_SETTINGS) as Array<
  keyof FaceShapeSettings
>
export const FACIAL_FEATURE_KEYS = Object.keys(DEFAULT_FACIAL_FEATURE_SETTINGS) as Array<
  keyof FacialFeatureSettings
>

export const SIGNED_FACE_SHAPE_KEYS = new Set<keyof FaceShapeSettings>([
  'narrowFace',
  'chinLength'
])
export const SIGNED_FACIAL_FEATURE_KEYS = new Set<keyof FacialFeatureSettings>([
  'eyeDistance',
  'eyeHeight',
  'eyeTilt',
  'noseWing',
  'noseBridge',
  'noseLength',
  'mouthSize',
  'mouthWidth',
  'lipThickness',
  'mouthCorner',
  'philtrum',
  'browHeight',
  'browDistance',
  'browTilt',
  'browThickness'
])

const clampUnit = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback
}

const clampSignedUnit = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(1, Math.max(-1, parsed)) : fallback
}

export function normalizeBeautySettings(value: unknown): BeautySettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_BEAUTY_SETTINGS }
  const input = value as Partial<Record<keyof BeautySettings, unknown>>
  const settings: BeautySettings = {
    ...DEFAULT_BEAUTY_SETTINGS,
    faceShape: { ...DEFAULT_FACE_SHAPE_SETTINGS },
    facialFeatures: { ...DEFAULT_FACIAL_FEATURE_SETTINGS }
  }
  settings.enabled = input.enabled === true
  for (const key of BEAUTY_SKIN_KEYS) settings[key] = clampUnit(input[key])
  if (
    typeof input.skinTone === 'string' &&
    BEAUTY_SKIN_TONES.some((tone) => tone.id === input.skinTone)
  ) {
    settings.skinTone = input.skinTone as BeautySkinTone
  }
  if (input.faceShape && typeof input.faceShape === 'object') {
    const shape = input.faceShape as Partial<Record<keyof FaceShapeSettings, unknown>>
    for (const key of FACE_SHAPE_KEYS) {
      settings.faceShape[key] = SIGNED_FACE_SHAPE_KEYS.has(key)
        ? clampSignedUnit(shape[key])
        : clampUnit(shape[key])
    }
  }
  if (input.facialFeatures && typeof input.facialFeatures === 'object') {
    const features = input.facialFeatures as Partial<
      Record<keyof FacialFeatureSettings, unknown>
    >
    for (const key of FACIAL_FEATURE_KEYS) {
      settings.facialFeatures[key] = SIGNED_FACIAL_FEATURE_KEYS.has(key)
        ? clampSignedUnit(features[key])
        : clampUnit(features[key])
    }
  }
  return settings
}

export function hasFaceReshapeEffect(settingsValue: unknown): boolean {
  const settings = normalizeBeautySettings(settingsValue)
  return (
    settings.enabled &&
    (FACE_SHAPE_KEYS.some((key) => settings.faceShape[key] !== 0) ||
      FACIAL_FEATURE_KEYS.some((key) => settings.facialFeatures[key] !== 0))
  )
}

export function hasBeautyEffect(settingsValue: unknown): boolean {
  const settings = normalizeBeautySettings(settingsValue)
  return (
    settings.enabled &&
    (settings.skinTone !== 'none' ||
      BEAUTY_SKIN_KEYS.some((key) => settings[key] > 0) ||
      FACE_SHAPE_KEYS.some((key) => settings.faceShape[key] !== 0) ||
      FACIAL_FEATURE_KEYS.some((key) => settings.facialFeatures[key] !== 0))
  )
}

export function beautySkinToneToRgb(tone: BeautySkinTone): readonly [number, number, number] {
  return BEAUTY_SKIN_TONES.find((item) => item.id === tone)?.rgb ?? [1, 1, 1]
}

/** Mirrors the shader's YCbCr skin gate so its selectivity remains testable. */
export function calculateBeautySkinWeight([red, green, blue]: readonly [
  number,
  number,
  number
]): number {
  const luma = red * 0.299 + green * 0.587 + blue * 0.114
  const cb = -0.168736 * red - 0.331264 * green + 0.5 * blue + 0.5
  const cr = 0.5 * red - 0.418688 * green - 0.081312 * blue + 0.5
  const ellipse = ((cb - 0.43) / 0.115) ** 2 + ((cr - 0.57) / 0.16) ** 2
  const ellipseGate = 1 - smoothstep(0.7, 1.45, ellipse)
  const lumaGate = smoothstep(0.055, 0.18, luma) * (1 - smoothstep(0.94, 1, luma))
  const channelGate = smoothstep(-0.08, 0.04, red - blue)
  return Math.min(1, Math.max(0, ellipseGate * lumaGate * channelGate))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const position = Math.min(1, Math.max(0, (value - edge0) / Math.max(0.000001, edge1 - edge0)))
  return position * position * (3 - 2 * position)
}
