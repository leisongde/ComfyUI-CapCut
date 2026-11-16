import {
  normalizeAudioVolumeKeyframes,
  resolveAudioVolumeAtLocalTime,
  type AudioVolumeKeyframe
} from './audio-keyframes'

export interface AudioEnvelope {
  duration: number
  fadeIn?: number
  fadeOut?: number
  volumeKeyframes?: AudioVolumeKeyframe[]
}

interface GainAutomation {
  cancelScheduledValues(startTime: number): void
  setValueAtTime(value: number, startTime: number): void
  linearRampToValueAtTime(value: number, endTime: number): void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeFade(value: number | undefined, duration: number): number {
  return clamp(Number.isFinite(value) ? (value ?? 0) : 0, 0, Math.max(0, duration))
}

export function getAudioEnvelopeGain({
  position,
  duration,
  fadeIn,
  fadeOut
}: AudioEnvelope & { position: number }): number {
  const safeDuration = Math.max(0, duration)
  const safePosition = clamp(position, 0, safeDuration)
  const safeFadeIn = normalizeFade(fadeIn, safeDuration)
  const safeFadeOut = normalizeFade(fadeOut, safeDuration)
  const fadeInGain = safeFadeIn > 0 ? safePosition / safeFadeIn : 1
  const fadeOutGain = safeFadeOut > 0 ? (safeDuration - safePosition) / safeFadeOut : 1
  return clamp(Math.min(fadeInGain, fadeOutGain), 0, 1)
}

export function scheduleAudioEnvelope({
  param,
  baseVolume,
  duration,
  fadeIn,
  fadeOut,
  volumeKeyframes,
  chunkStart,
  chunkDuration,
  contextStart
}: AudioEnvelope & {
  param: GainAutomation
  baseVolume: number
  chunkStart: number
  chunkDuration: number
  contextStart: number
}): void {
  const safeDuration = Math.max(0, duration)
  const start = clamp(chunkStart, 0, safeDuration)
  const end = clamp(chunkStart + Math.max(0, chunkDuration), start, safeDuration)
  const safeFadeIn = normalizeFade(fadeIn, safeDuration)
  const safeFadeOut = normalizeFade(fadeOut, safeDuration)
  const points = [
    start,
    end,
    safeFadeIn,
    safeDuration - safeFadeOut,
    ...normalizeAudioVolumeKeyframes(volumeKeyframes, safeDuration).map((keyframe) => keyframe.time)
  ]

  if (safeFadeIn > 0 && safeFadeOut > 0 && safeFadeIn + safeFadeOut > safeDuration) {
    points.push((safeDuration * safeFadeIn) / (safeFadeIn + safeFadeOut))
  }

  const breakpoints = [...new Set(points)]
    .filter((point) => point >= start && point <= end)
    .sort((left, right) => left - right)
  const gainAt = (position: number) =>
    resolveAudioVolumeAtLocalTime({
      volume: baseVolume,
      volumeKeyframes,
      localTime: position
    }) * getAudioEnvelopeGain({ position, duration: safeDuration, fadeIn, fadeOut })

  param.cancelScheduledValues(contextStart)
  param.setValueAtTime(gainAt(start), contextStart)
  for (const point of breakpoints) {
    if (point <= start) continue
    param.linearRampToValueAtTime(gainAt(point), contextStart + point - start)
  }
}
