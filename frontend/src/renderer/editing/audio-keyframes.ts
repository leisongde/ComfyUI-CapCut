import {
  getScalarChannelValueAtTime,
  normalizeScalarChannel,
  splitScalarChannelAtTime,
  upsertScalarKeyframe,
  type ScalarAnimationKey
} from './animation'

export type AudioVolumeKeyframe = ScalarAnimationKey

export interface AudioKeyframes {
  volume?: AudioVolumeKeyframe[]
}

export interface AudioVolumeKeyframeSource {
  duration: number
  startTime?: number
  timeOffset?: number
  volume?: number
  audioKeyframes?: AudioKeyframes
}

const MAX_AUDIO_GAIN = 10 ** (6 / 20)
const TIME_PRECISION = 1_000_000
const DEFAULT_TIME_EPSILON = 1 / 120

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function roundTime(time: number): number {
  return Math.round(time * TIME_PRECISION) / TIME_PRECISION
}

function clampGain(value: number): number {
  return clamp(Number.isFinite(value) ? value : 1, 0, MAX_AUDIO_GAIN)
}

function getStartTime(source: AudioVolumeKeyframeSource): number {
  return source.startTime ?? source.timeOffset ?? 0
}

export function getAudioLocalTime({
  source,
  timelineTime
}: {
  source: AudioVolumeKeyframeSource
  timelineTime: number
}): number {
  return roundTime(clamp(timelineTime - getStartTime(source), 0, Math.max(0, source.duration)))
}

export function normalizeAudioVolumeKeyframes(
  keyframes: AudioVolumeKeyframe[] | undefined,
  duration = Number.POSITIVE_INFINITY
): AudioVolumeKeyframe[] {
  const normalized = normalizeScalarChannel({ channel: { keys: keyframes ?? [] }, duration })
  return normalized.keys.map((keyframe) => ({
    ...keyframe,
    value: clampGain(keyframe.value)
  }))
}

export function resolveAudioVolumeAtLocalTime({
  volume,
  volumeKeyframes,
  localTime
}: {
  volume: number | undefined
  volumeKeyframes: AudioVolumeKeyframe[] | undefined
  localTime: number
}): number {
  return clampGain(
    getScalarChannelValueAtTime({
      channel: volumeKeyframes
        ? { keys: normalizeAudioVolumeKeyframes(volumeKeyframes) }
        : undefined,
      time: localTime,
      fallbackValue: clampGain(volume ?? 1)
    })
  )
}

export function resolveAudioVolume({
  source,
  timelineTime
}: {
  source: AudioVolumeKeyframeSource
  timelineTime: number
}): number {
  return resolveAudioVolumeAtLocalTime({
    volume: source.volume,
    volumeKeyframes: source.audioKeyframes?.volume,
    localTime: getAudioLocalTime({ source, timelineTime })
  })
}

export function findAudioVolumeKeyframeAtTime({
  keyframes,
  time,
  epsilon = DEFAULT_TIME_EPSILON
}: {
  keyframes: AudioVolumeKeyframe[] | undefined
  time: number
  epsilon?: number
}): number {
  return normalizeAudioVolumeKeyframes(keyframes).findIndex(
    (keyframe) => Math.abs(keyframe.time - time) <= epsilon
  )
}

export function createAudioVolumeUpdate({
  source,
  timelineTime,
  value,
  forceKeyframe = false
}: {
  source: AudioVolumeKeyframeSource
  timelineTime: number
  value: number
  forceKeyframe?: boolean
}): Partial<AudioVolumeKeyframeSource> {
  const gain = clampGain(value)
  const frames = source.audioKeyframes?.volume
  if (!forceKeyframe && !frames?.length) return { volume: gain }

  const channel = upsertScalarKeyframe({
    channel: { keys: frames ?? [] },
    time: getAudioLocalTime({ source, timelineTime }),
    value: gain,
    duration: source.duration
  })
  return {
    audioKeyframes: {
      ...source.audioKeyframes,
      volume: normalizeAudioVolumeKeyframes(channel.keys, source.duration)
    }
  }
}

export function toggleAudioVolumeKeyframe({
  source,
  timelineTime
}: {
  source: AudioVolumeKeyframeSource
  timelineTime: number
}): Partial<AudioVolumeKeyframeSource> {
  const localTime = getAudioLocalTime({ source, timelineTime })
  const volume = resolveAudioVolume({ source, timelineTime })
  const frames = normalizeAudioVolumeKeyframes(source.audioKeyframes?.volume, source.duration)
  const index = findAudioVolumeKeyframeAtTime({ keyframes: frames, time: localTime })

  if (index < 0) {
    return createAudioVolumeUpdate({
      source,
      timelineTime,
      value: volume,
      forceKeyframe: true
    })
  }

  frames.splice(index, 1)
  const audioKeyframes: AudioKeyframes = { ...source.audioKeyframes }
  if (frames.length > 0) audioKeyframes.volume = frames
  else delete audioKeyframes.volume
  return { volume, audioKeyframes }
}

export function getNeighborAudioVolumeKeyframe({
  source,
  timelineTime,
  direction
}: {
  source: AudioVolumeKeyframeSource
  timelineTime: number
  direction: 'previous' | 'next'
}): AudioVolumeKeyframe | undefined {
  const localTime = getAudioLocalTime({ source, timelineTime })
  const frames = normalizeAudioVolumeKeyframes(source.audioKeyframes?.volume, source.duration)
  if (direction === 'previous') {
    return [...frames]
      .reverse()
      .find((keyframe) => keyframe.time < localTime - DEFAULT_TIME_EPSILON)
  }
  return frames.find((keyframe) => keyframe.time > localTime + DEFAULT_TIME_EPSILON)
}

export function getAudioVolumeKeyframeTimes(source: AudioVolumeKeyframeSource): number[] {
  return normalizeAudioVolumeKeyframes(source.audioKeyframes?.volume, source.duration).map(
    (keyframe) => keyframe.time
  )
}

export function splitAudioKeyframesAtTime({
  audioKeyframes,
  splitTime
}: {
  audioKeyframes: AudioKeyframes | undefined
  splitTime: number
}): {
  leftAudioKeyframes: AudioKeyframes | undefined
  rightAudioKeyframes: AudioKeyframes | undefined
} {
  const split = splitScalarChannelAtTime({
    channel: audioKeyframes?.volume ? { keys: audioKeyframes.volume } : undefined,
    splitTime
  })
  return {
    leftAudioKeyframes: split.leftChannel?.keys.length
      ? { volume: normalizeAudioVolumeKeyframes(split.leftChannel.keys, splitTime) }
      : undefined,
    rightAudioKeyframes: split.rightChannel?.keys.length
      ? { volume: normalizeAudioVolumeKeyframes(split.rightChannel.keys) }
      : undefined
  }
}
