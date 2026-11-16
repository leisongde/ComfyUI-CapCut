import {
  getScalarChannelValueAtTime,
  normalizeScalarChannel,
  splitScalarChannelAtTime,
  upsertScalarKeyframe,
  type ScalarAnimationKey
} from './animation'
import type { DesktopClipFilter } from './clip-filters'

export const COLOR_ADJUSTMENT_VERSION = 1 as const

export const BASIC_ADJUSTMENT_PARAMETERS = [
  'temperature',
  'tint',
  'saturation',
  'vibrance',
  'brightness',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'brilliance',
  'sharpen',
  'clarity',
  'grain',
  'fade',
  'vignette'
] as const

export type BasicAdjustmentParameter = (typeof BASIC_ADJUSTMENT_PARAMETERS)[number]
export type BasicAdjustment = Record<BasicAdjustmentParameter, number>

export const HSL_BAND_IDS = [
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'magenta'
] as const
export type HslBandId = (typeof HSL_BAND_IDS)[number]
export type HslComponent = 'hue' | 'saturation' | 'lightness'
export interface HslBandAdjustment {
  hue: number
  saturation: number
  lightness: number
}

export interface CustomHslBand extends HslBandAdjustment {
  id: string
  color: string
}

export interface AdjustmentCurvePoint {
  x: number
  y: number
}

export type RgbCurveId = 'master' | 'red' | 'green' | 'blue'
export type HslCurveId = 'hueHue' | 'hueSaturation' | 'hueLightness' | 'lightnessSaturation' | 'saturationSaturation' | 'saturationLightness'

export interface AdjustmentCurves {
  rgb: Record<RgbCurveId, AdjustmentCurvePoint[]>
  hsl: Record<HslCurveId, AdjustmentCurvePoint[]>
}

export interface ColorWheelValue {
  hue: number
  saturation: number
  luminance: number
}

export interface PrimaryColorWheels {
  enabled: boolean
  lift: ColorWheelValue
  gamma: ColorWheelValue
  gain: ColorWheelValue
  offset: ColorWheelValue
  lumaMix: number
}

export interface LogColorWheels {
  enabled: boolean
  shadow: ColorWheelValue
  midtone: ColorWheelValue
  highlight: ColorWheelValue
  offset: ColorWheelValue
  shadowRange: number
  highlightRange: number
}

export interface ColorAdjustment {
  version: typeof COLOR_ADJUSTMENT_VERSION
  enabled: boolean
  intensity: number
  basic: BasicAdjustment
  hsl: Record<HslBandId, HslBandAdjustment>
  customHsl: CustomHslBand[]
  curves: AdjustmentCurves
  primaryWheels: PrimaryColorWheels
  logWheels: LogColorWheels
  keyframes: Record<string, ScalarAnimationKey[]>
}

export interface ColorAdjustmentSource {
  duration: number
  startTime?: number
  timeOffset?: number
  colorAdjustment?: unknown
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const BASIC_RANGES: Record<BasicAdjustmentParameter, readonly [number, number]> = {
  temperature: [-1, 1],
  tint: [-1, 1],
  saturation: [-1, 1],
  vibrance: [-1, 1],
  brightness: [-1, 1],
  contrast: [-1, 1],
  highlights: [-1, 1],
  shadows: [-1, 1],
  whites: [-1, 1],
  blacks: [-1, 1],
  brilliance: [-1, 1],
  sharpen: [0, 1],
  clarity: [0, 1],
  grain: [0, 1],
  fade: [0, 1],
  vignette: [0, 1]
}

const createNeutralWheel = (): ColorWheelValue => ({ hue: 0, saturation: 0, luminance: 0 })
const createNeutralHslBand = (): HslBandAdjustment => ({ hue: 0, saturation: 0, lightness: 0 })
const createRgbCurve = (): AdjustmentCurvePoint[] => [
  { x: 0, y: 0 },
  { x: 1, y: 1 }
]
const createHslCurve = (): AdjustmentCurvePoint[] => [
  { x: 0, y: 0.5 },
  { x: 1, y: 0.5 }
]

export function createNeutralColorAdjustment(): ColorAdjustment {
  return {
    version: COLOR_ADJUSTMENT_VERSION,
    enabled: true,
    intensity: 1,
    basic: Object.fromEntries(
      BASIC_ADJUSTMENT_PARAMETERS.map((parameter) => [parameter, 0])
    ) as unknown as BasicAdjustment,
    hsl: Object.fromEntries(
      HSL_BAND_IDS.map((band) => [band, createNeutralHslBand()])
    ) as unknown as Record<HslBandId, HslBandAdjustment>,
    customHsl: [],
    curves: {
      rgb: {
        master: createRgbCurve(),
        red: createRgbCurve(),
        green: createRgbCurve(),
        blue: createRgbCurve()
      },
      hsl: {
        hueHue: createHslCurve(),
        hueSaturation: createHslCurve(),
        hueLightness: createHslCurve(),
        lightnessSaturation: createHslCurve(),
        saturationSaturation: createHslCurve(),
        saturationLightness: createHslCurve()
      }
    },
    primaryWheels: {
      enabled: false,
      lift: createNeutralWheel(),
      gamma: createNeutralWheel(),
      gain: createNeutralWheel(),
      offset: createNeutralWheel(),
      lumaMix: 1
    },
    logWheels: {
      enabled: false,
      shadow: createNeutralWheel(),
      midtone: createNeutralWheel(),
      highlight: createNeutralWheel(),
      offset: createNeutralWheel(),
      shadowRange: 0.33,
      highlightRange: 0.55
    },
    keyframes: {}
  }
}

function normalizeCurve(
  value: unknown,
  fallback: AdjustmentCurvePoint[],
  neutralY: 'diagonal' | 'middle'
): AdjustmentCurvePoint[] {
  if (!Array.isArray(value)) return fallback.map((point) => ({ ...point }))
  const points = value
    .filter((point): point is { x: number; y: number } =>
      Boolean(point && typeof point.x === 'number' && typeof point.y === 'number')
    )
    .map((point) => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) }))
    .sort((left, right) => left.x - right.x)
  if (points.length < 2) return fallback.map((point) => ({ ...point }))
  const deduplicated: AdjustmentCurvePoint[] = []
  for (const point of points) {
    const previous = deduplicated.at(-1)
    if (previous && Math.abs(previous.x - point.x) < 0.0001) previous.y = point.y
    else deduplicated.push(point)
  }
  if (deduplicated[0].x > 0) {
    deduplicated.unshift({ x: 0, y: neutralY === 'diagonal' ? 0 : 0.5 })
  }
  if (deduplicated.at(-1)!.x < 1) {
    deduplicated.push({ x: 1, y: neutralY === 'diagonal' ? 1 : 0.5 })
  }
  return deduplicated.slice(0, 16)
}

function normalizeWheel(value: unknown): ColorWheelValue {
  const source = value && typeof value === 'object' ? (value as Partial<ColorWheelValue>) : {}
  return {
    hue: clamp(finite(source.hue), -180, 180),
    saturation: clamp(finite(source.saturation), 0, 1),
    luminance: clamp(finite(source.luminance), -1, 1)
  }
}

function normalizeHslBand(value: unknown): HslBandAdjustment {
  const source = value && typeof value === 'object' ? (value as Partial<HslBandAdjustment>) : {}
  return {
    hue: clamp(finite(source.hue), -1, 1),
    saturation: clamp(finite(source.saturation), -1, 1),
    lightness: clamp(finite(source.lightness), -1, 1)
  }
}

function normalizeHexColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#ff0000'
}

function legacyBasic(filter: DesktopClipFilter | null | undefined): Partial<BasicAdjustment> {
  if (!filter) return {}
  return {
    brightness: clamp(filter.parameters.brightness - 1, -1, 1),
    contrast: clamp(filter.parameters.contrast - 1, -1, 1),
    saturation: clamp(filter.parameters.saturation - 1, -1, 1),
    temperature: clamp(filter.parameters.temperature, -1, 1),
    tint: clamp(filter.parameters.tint, -1, 1),
    fade: clamp(filter.parameters.fade, 0, 1),
    vignette: clamp(filter.parameters.vignette, 0, 1),
    grain: clamp(filter.parameters.grain, 0, 1)
  }
}

export function normalizeColorAdjustment(
  value: unknown,
  legacyFilter?: DesktopClipFilter | null
): ColorAdjustment {
  const fallback = createNeutralColorAdjustment()
  const source = value && typeof value === 'object' ? (value as Partial<ColorAdjustment>) : {}
  const basicSource =
    source.basic && typeof source.basic === 'object'
      ? (source.basic as Partial<BasicAdjustment>)
      : legacyBasic(legacyFilter)
  const basic = { ...fallback.basic }
  for (const parameter of BASIC_ADJUSTMENT_PARAMETERS) {
    const [minimum, maximum] = BASIC_RANGES[parameter]
    basic[parameter] = clamp(finite(basicSource[parameter], fallback.basic[parameter]), minimum, maximum)
  }

  const hslSource = source.hsl && typeof source.hsl === 'object' ? source.hsl : {}
  const hsl = Object.fromEntries(
    HSL_BAND_IDS.map((band) => [band, normalizeHslBand(hslSource[band])])
  ) as Record<HslBandId, HslBandAdjustment>

  const customHsl = Array.isArray(source.customHsl)
    ? source.customHsl.slice(0, 10).map((band, index) => ({
        id:
          typeof band?.id === 'string' && band.id
            ? band.id
            : `custom-hsl-${index + 1}`,
        color: normalizeHexColor(band?.color),
        ...normalizeHslBand(band)
      }))
    : []

  const curvesSource = source.curves && typeof source.curves === 'object' ? source.curves : fallback.curves
  const rgbSource = curvesSource.rgb && typeof curvesSource.rgb === 'object' ? curvesSource.rgb : fallback.curves.rgb
  const hslCurvesSource = curvesSource.hsl && typeof curvesSource.hsl === 'object' ? curvesSource.hsl : fallback.curves.hsl
  const curves: AdjustmentCurves = {
    rgb: {
      master: normalizeCurve(rgbSource.master, fallback.curves.rgb.master, 'diagonal'),
      red: normalizeCurve(rgbSource.red, fallback.curves.rgb.red, 'diagonal'),
      green: normalizeCurve(rgbSource.green, fallback.curves.rgb.green, 'diagonal'),
      blue: normalizeCurve(rgbSource.blue, fallback.curves.rgb.blue, 'diagonal')
    },
    hsl: {
      hueHue: normalizeCurve(hslCurvesSource.hueHue, fallback.curves.hsl.hueHue, 'middle'),
      hueSaturation: normalizeCurve(
        hslCurvesSource.hueSaturation,
        fallback.curves.hsl.hueSaturation,
        'middle'
      ),
      hueLightness: normalizeCurve(
        hslCurvesSource.hueLightness,
        fallback.curves.hsl.hueLightness,
        'middle'
      ),
      lightnessSaturation: normalizeCurve(
        hslCurvesSource.lightnessSaturation,
        fallback.curves.hsl.lightnessSaturation,
        'middle'
      ),
      saturationSaturation: normalizeCurve(
        hslCurvesSource.saturationSaturation,
        fallback.curves.hsl.saturationSaturation,
        'middle'
      ),
      saturationLightness: normalizeCurve(
        hslCurvesSource.saturationLightness,
        fallback.curves.hsl.saturationLightness,
        'middle'
      )
    }
  }

  const primarySource =
    source.primaryWheels && typeof source.primaryWheels === 'object'
      ? source.primaryWheels
      : fallback.primaryWheels
  const logSource =
    source.logWheels && typeof source.logWheels === 'object'
      ? source.logWheels
      : fallback.logWheels

  const keyframes: Record<string, ScalarAnimationKey[]> = {}
  if (source.keyframes && typeof source.keyframes === 'object') {
    for (const [path, frames] of Object.entries(source.keyframes)) {
      if (!Array.isArray(frames)) continue
      const normalized = normalizeScalarChannel({ channel: { keys: frames } }).keys
      if (normalized.length) keyframes[path] = normalized
    }
  }

  return {
    version: COLOR_ADJUSTMENT_VERSION,
    enabled: source.enabled !== false,
    intensity: clamp(finite(source.intensity, 1), 0, 1),
    basic,
    hsl,
    customHsl,
    curves,
    primaryWheels: {
      enabled: primarySource.enabled === true,
      lift: normalizeWheel(primarySource.lift),
      gamma: normalizeWheel(primarySource.gamma),
      gain: normalizeWheel(primarySource.gain),
      offset: normalizeWheel(primarySource.offset),
      lumaMix: clamp(finite(primarySource.lumaMix, 1), 0, 1)
    },
    logWheels: {
      enabled: logSource.enabled === true,
      shadow: normalizeWheel(logSource.shadow),
      midtone: normalizeWheel(logSource.midtone),
      highlight: normalizeWheel(logSource.highlight),
      offset: normalizeWheel(logSource.offset),
      shadowRange: clamp(finite(logSource.shadowRange, 0.33), 0.05, 0.9),
      highlightRange: clamp(finite(logSource.highlightRange, 0.55), 0.1, 0.95)
    },
    keyframes
  }
}

function getLocalTime(source: ColorAdjustmentSource, timelineTime: number): number {
  const startTime = source.startTime ?? source.timeOffset ?? 0
  return Math.max(0, Math.min(source.duration, timelineTime - startTime))
}

export function getColorAdjustmentParameter(
  adjustment: ColorAdjustment,
  path: string
): number | undefined {
  const parts = path.split('.')
  if (parts[0] === 'basic' && BASIC_ADJUSTMENT_PARAMETERS.includes(parts[1] as BasicAdjustmentParameter)) {
    return adjustment.basic[parts[1] as BasicAdjustmentParameter]
  }
  if (parts[0] === 'hsl' && HSL_BAND_IDS.includes(parts[1] as HslBandId)) {
    const component = parts[2] as HslComponent
    if (component === 'hue' || component === 'saturation' || component === 'lightness') {
      return adjustment.hsl[parts[1] as HslBandId][component]
    }
  }
  if (parts[0] === 'primaryWheels') {
    if (parts[1] === 'lumaMix') return adjustment.primaryWheels.lumaMix
    const wheel = adjustment.primaryWheels[parts[1] as keyof PrimaryColorWheels]
    if (wheel && typeof wheel === 'object' && parts[2] in wheel) {
      return wheel[parts[2] as keyof ColorWheelValue]
    }
  }
  if (parts[0] === 'logWheels') {
    if (parts[1] === 'shadowRange' || parts[1] === 'highlightRange') return adjustment.logWheels[parts[1]]
    const wheel = adjustment.logWheels[parts[1] as keyof LogColorWheels]
    if (wheel && typeof wheel === 'object' && parts[2] in wheel) {
      return wheel[parts[2] as keyof ColorWheelValue]
    }
  }
  return undefined
}

export function setColorAdjustmentParameter(
  adjustment: ColorAdjustment,
  path: string,
  value: number
): ColorAdjustment {
  const next = normalizeColorAdjustment(adjustment)
  const parts = path.split('.')
  if (parts[0] === 'basic' && BASIC_ADJUSTMENT_PARAMETERS.includes(parts[1] as BasicAdjustmentParameter)) {
    const parameter = parts[1] as BasicAdjustmentParameter
    const [minimum, maximum] = BASIC_RANGES[parameter]
    next.basic[parameter] = clamp(value, minimum, maximum)
  } else if (parts[0] === 'hsl' && HSL_BAND_IDS.includes(parts[1] as HslBandId)) {
    const component = parts[2] as HslComponent
    if (component === 'hue' || component === 'saturation' || component === 'lightness') {
      next.hsl[parts[1] as HslBandId][component] = clamp(value, -1, 1)
    }
  } else if (parts[0] === 'primaryWheels') {
    if (parts[1] === 'lumaMix') next.primaryWheels.lumaMix = clamp(value, 0, 1)
    else {
      const wheel = next.primaryWheels[parts[1] as 'lift' | 'gamma' | 'gain' | 'offset']
      if (wheel && parts[2] === 'hue') wheel.hue = clamp(value, -180, 180)
      if (wheel && parts[2] === 'saturation') wheel.saturation = clamp(value, 0, 1)
      if (wheel && parts[2] === 'luminance') wheel.luminance = clamp(value, -1, 1)
    }
  } else if (parts[0] === 'logWheels') {
    if (parts[1] === 'shadowRange') next.logWheels.shadowRange = clamp(value, 0.05, 0.9)
    else if (parts[1] === 'highlightRange') next.logWheels.highlightRange = clamp(value, 0.1, 0.95)
    else {
      const wheel = next.logWheels[parts[1] as 'shadow' | 'midtone' | 'highlight' | 'offset']
      if (wheel && parts[2] === 'hue') wheel.hue = clamp(value, -180, 180)
      if (wheel && parts[2] === 'saturation') wheel.saturation = clamp(value, 0, 1)
      if (wheel && parts[2] === 'luminance') wheel.luminance = clamp(value, -1, 1)
    }
  }
  return next
}

export function resolveColorAdjustment({
  source,
  timelineTime,
  legacyFilter
}: {
  source: ColorAdjustmentSource
  timelineTime: number
  legacyFilter?: DesktopClipFilter | null
}): ColorAdjustment {
  let adjustment = normalizeColorAdjustment(source.colorAdjustment, legacyFilter)
  const localTime = getLocalTime(source, timelineTime)
  for (const [path, frames] of Object.entries(adjustment.keyframes)) {
    const fallbackValue = getColorAdjustmentParameter(adjustment, path)
    if (fallbackValue === undefined) continue
    const value = getScalarChannelValueAtTime({
      channel: { keys: frames },
      time: localTime,
      fallbackValue
    })
    adjustment = setColorAdjustmentParameter(adjustment, path, value)
  }
  return adjustment
}

export function updateColorAdjustmentParameter({
  source,
  adjustment,
  path,
  timelineTime,
  value,
  forceKeyframe = false
}: {
  source: ColorAdjustmentSource
  adjustment: ColorAdjustment
  path: string
  timelineTime: number
  value: number
  forceKeyframe?: boolean
}): ColorAdjustment {
  const frames = adjustment.keyframes[path] ?? []
  if (!forceKeyframe && frames.length === 0) return setColorAdjustmentParameter(adjustment, path, value)
  const channel = upsertScalarKeyframe({
    channel: { keys: frames },
    time: getLocalTime(source, timelineTime),
    value,
    duration: source.duration
  })
  return {
    ...adjustment,
    keyframes: { ...adjustment.keyframes, [path]: channel.keys }
  }
}

const KEYFRAME_EPSILON = 1 / 120

export function findColorAdjustmentKeyframeAtTime({
  source,
  adjustment,
  path,
  timelineTime
}: {
  source: ColorAdjustmentSource
  adjustment: ColorAdjustment
  path: string
  timelineTime: number
}): number {
  const localTime = getLocalTime(source, timelineTime)
  return (adjustment.keyframes[path] ?? []).findIndex(
    (keyframe) => Math.abs(keyframe.time - localTime) <= KEYFRAME_EPSILON
  )
}

export function toggleColorAdjustmentKeyframe({
  source,
  adjustment,
  path,
  timelineTime
}: {
  source: ColorAdjustmentSource
  adjustment: ColorAdjustment
  path: string
  timelineTime: number
}): ColorAdjustment {
  const resolved = resolveColorAdjustment({
    source: { ...source, colorAdjustment: adjustment },
    timelineTime
  })
  const value = getColorAdjustmentParameter(resolved, path)
  if (value === undefined) return adjustment
  const frames = [...(adjustment.keyframes[path] ?? [])]
  const index = findColorAdjustmentKeyframeAtTime({ source, adjustment, path, timelineTime })
  if (index < 0) {
    return updateColorAdjustmentParameter({
      source,
      adjustment,
      path,
      timelineTime,
      value,
      forceKeyframe: true
    })
  }
  frames.splice(index, 1)
  const keyframes = { ...adjustment.keyframes }
  if (frames.length) keyframes[path] = frames
  else delete keyframes[path]
  return {
    ...setColorAdjustmentParameter(adjustment, path, value),
    keyframes
  }
}

export function getNeighborColorAdjustmentKeyframe({
  source,
  adjustment,
  path,
  timelineTime,
  direction
}: {
  source: ColorAdjustmentSource
  adjustment: ColorAdjustment
  path: string
  timelineTime: number
  direction: 'previous' | 'next'
}): ScalarAnimationKey | undefined {
  const localTime = getLocalTime(source, timelineTime)
  const frames = normalizeScalarChannel({ channel: { keys: adjustment.keyframes[path] ?? [] } }).keys
  return direction === 'previous'
    ? [...frames].reverse().find((frame) => frame.time < localTime - KEYFRAME_EPSILON)
    : frames.find((frame) => frame.time > localTime + KEYFRAME_EPSILON)
}

export function getColorAdjustmentKeyframeTimes(value: unknown): number[] {
  const adjustment = normalizeColorAdjustment(value)
  return Array.from(
    new Set(Object.values(adjustment.keyframes).flatMap((frames) => frames.map((frame) => frame.time)))
  ).sort((left, right) => left - right)
}

export function splitColorAdjustmentAtTime({
  value,
  splitTime
}: {
  value: unknown
  splitTime: number
}): { left: ColorAdjustment; right: ColorAdjustment } {
  const adjustment = normalizeColorAdjustment(value)
  const leftKeyframes: Record<string, ScalarAnimationKey[]> = {}
  const rightKeyframes: Record<string, ScalarAnimationKey[]> = {}
  for (const [path, frames] of Object.entries(adjustment.keyframes)) {
    const split = splitScalarChannelAtTime({ channel: { keys: frames }, splitTime })
    if (split.leftChannel?.keys.length) leftKeyframes[path] = split.leftChannel.keys
    if (split.rightChannel?.keys.length) rightKeyframes[path] = split.rightChannel.keys
  }
  return {
    left: { ...adjustment, keyframes: leftKeyframes },
    right: { ...adjustment, keyframes: rightKeyframes }
  }
}

export function isNeutralColorAdjustment(value: unknown): boolean {
  const adjustment = normalizeColorAdjustment(value)
  const neutral = createNeutralColorAdjustment()
  return JSON.stringify({ ...adjustment, enabled: true }) === JSON.stringify(neutral)
}
