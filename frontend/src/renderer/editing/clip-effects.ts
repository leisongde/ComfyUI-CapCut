export interface DesktopClipEffect {
  id: string
  name: string
  category: string
  engine: string
  enabled: boolean
  intensity: number
  appliedAt: string
}

const EFFECT_IDS = [
  'pixi-filters-advanced-bloom',
  'pixi-filters-ascii',
  'pixi-filters-bevel',
  'pixi-filters-bloom',
  'pixi-filters-bulge-pinch',
  'pixi-filters-cross-hatch',
  'pixi-filters-crt',
  'pixi-filters-dot',
  'pixi-filters-emboss',
  'pixi-filters-glitch',
  'pixi-filters-glow',
  'pixi-filters-godray',
  'pixi-filters-kawase-blur',
  'pixi-filters-motion-blur',
  'pixi-filters-old-film',
  'pixi-filters-outline',
  'pixi-filters-pixelate',
  'pixi-filters-radial-blur',
  'pixi-filters-reflection',
  'pixi-filters-rgb-split',
  'pixi-filters-shockwave',
  'pixi-filters-simplex-noise',
  'pixi-filters-tilt-shift',
  'pixi-filters-twist',
  'pixi-filters-zoom-blur',
  'kampos-deformation',
  'kampos-kaleidoscope',
  'kampos-slit-scan',
  'kampos-turbulence',
  'seriously-js-accumulator',
  'seriously-js-dither',
  'seriously-js-edge',
  'seriously-js-hex',
  'seriously-js-mirror',
  'seriously-js-nightvision',
  'seriously-js-noise',
  'seriously-js-polar',
  'seriously-js-repeat',
  'seriously-js-ripple',
  'seriously-js-scanlines',
  'seriously-js-sketch',
  'seriously-js-tvglitch'
] as const

export const CLIP_EFFECT_MODES = Object.fromEntries(
  EFFECT_IDS.map((id, index) => [id, index + 1])
) as Record<(typeof EFFECT_IDS)[number], number>

export function clipEffectMode(id: string): number {
  return CLIP_EFFECT_MODES[id as keyof typeof CLIP_EFFECT_MODES] ?? 0
}

export function createClipEffect(input: {
  id: string
  name: string
  category: string
  engine: string
}): DesktopClipEffect {
  return {
    ...input,
    enabled: true,
    intensity: 1,
    appliedAt: new Date().toISOString()
  }
}

export function normalizeClipEffects(value: unknown): DesktopClipEffect[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (effect): effect is DesktopClipEffect =>
      Boolean(effect) &&
      typeof effect === 'object' &&
      typeof effect.id === 'string' &&
      clipEffectMode(effect.id) > 0 &&
      typeof effect.name === 'string' &&
      typeof effect.category === 'string' &&
      typeof effect.engine === 'string' &&
      typeof effect.enabled === 'boolean' &&
      typeof effect.intensity === 'number' &&
      Number.isFinite(effect.intensity)
  )
}

export function upsertClipEffect(value: unknown, effect: DesktopClipEffect): DesktopClipEffect[] {
  return [...normalizeClipEffects(value).filter((item) => item.id !== effect.id), effect]
}
