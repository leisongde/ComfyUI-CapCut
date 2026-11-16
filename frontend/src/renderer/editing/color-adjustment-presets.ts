import { normalizeColorAdjustment, type ColorAdjustment } from './color-adjustment'

export const COLOR_ADJUSTMENT_PRESETS_STORAGE_KEY = 'editing-color-adjustment-presets-v1'
export const MAX_COLOR_ADJUSTMENT_PRESETS = 100
export const MAX_COLOR_ADJUSTMENT_PRESET_NAME_LENGTH = 40

export interface ColorAdjustmentPreset {
  version: 1
  id: string
  name: string
  adjustment: ColorAdjustment
  createdAt: number
  updatedAt: number
}

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

export interface ColorAdjustmentTrackLike {
  id: string
  elements: Array<{ id: string; type: string }>
}

export interface ColorAdjustmentVideoUpdate {
  trackId: string
  elementId: string
  updates: { colorAdjustment: ColorAdjustment }
}

function normalizeName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().slice(0, MAX_COLOR_ADJUSTMENT_PRESET_NAME_LENGTH)
    : ''
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function createPresetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `color-preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

export function createColorAdjustmentPresetSnapshot(value: unknown): ColorAdjustment {
  return { ...normalizeColorAdjustment(value), keyframes: {} }
}

export function normalizeColorAdjustmentPresets(value: unknown): ColorAdjustmentPreset[] {
  if (!Array.isArray(value)) return []
  const now = Date.now()
  const ids = new Set<string>()
  const presets: ColorAdjustmentPreset[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const source = item as Partial<ColorAdjustmentPreset>
    const id = typeof source.id === 'string' ? source.id.trim() : ''
    const name = normalizeName(source.name)
    if (!id || !name || ids.has(id)) continue
    ids.add(id)
    const createdAt = normalizeTimestamp(source.createdAt, now)
    presets.push({
      version: 1,
      id,
      name,
      adjustment: createColorAdjustmentPresetSnapshot(source.adjustment),
      createdAt,
      updatedAt: normalizeTimestamp(source.updatedAt, createdAt)
    })
    if (presets.length >= MAX_COLOR_ADJUSTMENT_PRESETS) break
  }
  return presets.sort((left, right) => right.updatedAt - left.updatedAt)
}

export function readColorAdjustmentPresets(
  storage: ReadableStorage = window.localStorage
): ColorAdjustmentPreset[] {
  try {
    const raw = storage.getItem(COLOR_ADJUSTMENT_PRESETS_STORAGE_KEY)
    return raw ? normalizeColorAdjustmentPresets(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function writeColorAdjustmentPresets(
  presets: ColorAdjustmentPreset[],
  storage: WritableStorage = window.localStorage
): ColorAdjustmentPreset[] {
  const normalized = normalizeColorAdjustmentPresets(presets)
  storage.setItem(COLOR_ADJUSTMENT_PRESETS_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function createColorAdjustmentPreset(input: {
  name: string
  adjustment: unknown
  id?: string
  now?: number
}): ColorAdjustmentPreset {
  const name = normalizeName(input.name)
  if (!name) throw new Error('预设名称不能为空')
  const now = input.now ?? Date.now()
  return {
    version: 1,
    id: input.id?.trim() || createPresetId(),
    name,
    adjustment: createColorAdjustmentPresetSnapshot(input.adjustment),
    createdAt: now,
    updatedAt: now
  }
}

export function renameColorAdjustmentPreset(
  preset: ColorAdjustmentPreset,
  name: string,
  now = Date.now()
): ColorAdjustmentPreset {
  const normalizedName = normalizeName(name)
  if (!normalizedName) throw new Error('预设名称不能为空')
  return { ...preset, name: normalizedName, updatedAt: now }
}

export function updateColorAdjustmentPreset(
  preset: ColorAdjustmentPreset,
  adjustment: unknown,
  now = Date.now()
): ColorAdjustmentPreset {
  return {
    ...preset,
    adjustment: createColorAdjustmentPresetSnapshot(adjustment),
    updatedAt: now
  }
}

export function buildColorAdjustmentVideoUpdates(
  tracks: readonly ColorAdjustmentTrackLike[],
  adjustment: unknown
): ColorAdjustmentVideoUpdate[] {
  const snapshot = createColorAdjustmentPresetSnapshot(adjustment)
  return tracks.flatMap((track) =>
    track.elements
      .filter((element) => element.type === 'video')
      .map((element) => ({
        trackId: track.id,
        elementId: element.id,
        updates: { colorAdjustment: createColorAdjustmentPresetSnapshot(snapshot) }
      }))
  )
}
