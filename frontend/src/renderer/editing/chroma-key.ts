export interface ChromaKeySettings {
  enabled: boolean
  color: string
  intensity: number
  shadow: number
  edgeSmooth: number
  spill: number
}

export const DEFAULT_CHROMA_KEY: ChromaKeySettings = {
  enabled: false,
  color: '#00ff00',
  intensity: 0.42,
  shadow: 0.35,
  edgeSmooth: 0.3,
  spill: 0.5
}

const clampUnit = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback
}

export function normalizeChromaColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CHROMA_KEY.color
  const color = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(color)) return color
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  return DEFAULT_CHROMA_KEY.color
}

export function chromaColorToRgb(color: string): [number, number, number] {
  const normalized = normalizeChromaColor(color)
  return [
    Number.parseInt(normalized.slice(1, 3), 16) / 255,
    Number.parseInt(normalized.slice(3, 5), 16) / 255,
    Number.parseInt(normalized.slice(5, 7), 16) / 255
  ]
}

export function normalizeChromaKey(value: unknown): ChromaKeySettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CHROMA_KEY }
  const input = value as Partial<ChromaKeySettings>
  return {
    enabled: input.enabled === true,
    color: normalizeChromaColor(input.color),
    intensity: clampUnit(input.intensity, DEFAULT_CHROMA_KEY.intensity),
    shadow: clampUnit(input.shadow, DEFAULT_CHROMA_KEY.shadow),
    edgeSmooth: clampUnit(input.edgeSmooth, DEFAULT_CHROMA_KEY.edgeSmooth),
    spill: clampUnit(input.spill, DEFAULT_CHROMA_KEY.spill)
  }
}

function rgbToYuv([red, green, blue]: [number, number, number]): [number, number, number] {
  return [
    red * 0.299 + green * 0.587 + blue * 0.114,
    red * -0.169 + green * -0.331 + blue * 0.5,
    red * 0.5 + green * -0.419 + blue * -0.081
  ]
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const position = Math.min(1, Math.max(0, (value - edge0) / Math.max(0.000001, edge1 - edge0)))
  return position * position * (3 - 2 * position)
}

/** Mirrors the shader's matte calculation and keeps its behavior unit-testable. */
export function calculateChromaKeyAlpha(
  color: [number, number, number],
  settingsValue: unknown
): number {
  const settings = normalizeChromaKey(settingsValue)
  if (!settings.enabled) return 1
  const source = rgbToYuv(color)
  const key = rgbToYuv(chromaColorToRgb(settings.color))
  const chromaDistance = Math.hypot(source[1] - key[1], source[2] - key[2])
  const lumaDistance = Math.abs(source[0] - key[0])
  const distance = chromaDistance + lumaDistance * (1 - settings.shadow) * 0.35
  const threshold = 0.018 + settings.intensity * 0.362
  const softness = 0.006 + settings.edgeSmooth * 0.154
  return smoothstep(threshold, threshold + softness, distance)
}
