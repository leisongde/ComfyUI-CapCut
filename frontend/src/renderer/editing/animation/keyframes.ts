/**
 * Scalar keyframe editing and split handling adapted from OpenCut Classic.
 * Copyright 2025-2026 OpenCut, licensed under the MIT License.
 */

import { getDefaultLeftHandle, getDefaultRightHandle, solveBezierProgressForTime } from './bezier'
import {
  getScalarChannelValueAtTime,
  getScalarSegmentType,
  normalizeScalarChannel
} from './interpolation'
import type {
  ScalarAnimationChannel,
  ScalarAnimationKey,
  ScalarCurveKeyframePatch,
  ScalarSegmentType
} from './types'

let fallbackId = 0

export function createAnimationKeyframeId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  fallbackId += 1
  return `animation-keyframe-${Date.now()}-${fallbackId}`
}

function roundTime(time: number): number {
  return Math.round(time * 1_000_000) / 1_000_000
}

function createScalarKey({
  id,
  time,
  value,
  segmentToNext = 'linear',
  previousKey
}: {
  id?: string
  time: number
  value: number
  segmentToNext?: ScalarSegmentType
  previousKey?: ScalarAnimationKey
}): ScalarAnimationKey {
  return {
    ...previousKey,
    id: id ?? previousKey?.id ?? createAnimationKeyframeId(),
    time: roundTime(time),
    value,
    segmentToNext: previousKey?.segmentToNext ?? segmentToNext,
    tangentMode: previousKey?.tangentMode ?? 'flat'
  }
}

export function upsertScalarKeyframe({
  channel,
  time,
  value,
  segmentToNext,
  keyframeId,
  duration = Number.POSITIVE_INFINITY
}: {
  channel: ScalarAnimationChannel | undefined
  time: number
  value: number
  segmentToNext?: ScalarSegmentType
  keyframeId?: string
  duration?: number
}): ScalarAnimationChannel {
  const normalized = normalizeScalarChannel({ channel: channel ?? { keys: [] }, duration })
  const keys = [...normalized.keys]
  const indexById = keyframeId ? keys.findIndex((key) => key.id === keyframeId) : -1
  const indexAtTime = keys.findIndex((key) => key.time === roundTime(time))
  const index = indexById >= 0 ? indexById : indexAtTime

  if (index >= 0) {
    keys[index] = createScalarKey({
      id: keys[index].id,
      time,
      value,
      segmentToNext,
      previousKey: keys[index]
    })
  } else {
    keys.push(createScalarKey({ id: keyframeId, time, value, segmentToNext }))
  }

  return normalizeScalarChannel({
    channel: { keys, extrapolation: normalized.extrapolation },
    duration
  })
}

export function removeScalarKeyframe({
  channel,
  keyframeId,
  time
}: {
  channel: ScalarAnimationChannel | undefined
  keyframeId?: string
  time?: number
}): ScalarAnimationChannel | undefined {
  if (!channel) return undefined
  const keys = channel.keys.filter((key) => {
    if (keyframeId) return key.id !== keyframeId
    return time === undefined || key.time !== roundTime(time)
  })
  return keys.length ? normalizeScalarChannel({ channel: { ...channel, keys } }) : undefined
}

export function retimeScalarKeyframe({
  channel,
  keyframeId,
  time,
  duration = Number.POSITIVE_INFINITY
}: {
  channel: ScalarAnimationChannel
  keyframeId: string
  time: number
  duration?: number
}): ScalarAnimationChannel {
  return normalizeScalarChannel({
    channel: {
      ...channel,
      keys: channel.keys.map((key) =>
        key.id === keyframeId ? { ...key, time: roundTime(time) } : key
      )
    },
    duration
  })
}

export function updateScalarKeyframeCurve({
  channel,
  keyframeId,
  patch
}: {
  channel: ScalarAnimationChannel
  keyframeId: string
  patch: ScalarCurveKeyframePatch
}): ScalarAnimationChannel {
  const keys = channel.keys.map((key) => {
    if (key.id !== keyframeId) return key
    const next = { ...key, ...patch }
    if (patch.leftHandle === null) delete next.leftHandle
    if (patch.rightHandle === null) delete next.rightHandle
    return next
  })
  return normalizeScalarChannel({ channel: { ...channel, keys } })
}

export function cloneScalarChannel({
  channel,
  regenerateIds = false
}: {
  channel: ScalarAnimationChannel | undefined
  regenerateIds?: boolean
}): ScalarAnimationChannel | undefined {
  if (!channel) return undefined
  return {
    ...channel,
    keys: channel.keys.map((key) => ({
      ...key,
      id: regenerateIds ? createAnimationKeyframeId() : key.id,
      leftHandle: key.leftHandle ? { ...key.leftHandle } : undefined,
      rightHandle: key.rightHandle ? { ...key.rightHandle } : undefined
    }))
  }
}

function lerpPoint(
  left: { x: number; y: number },
  right: { x: number; y: number },
  progress: number
) {
  return {
    x: left.x + (right.x - left.x) * progress,
    y: left.y + (right.y - left.y) * progress
  }
}

export function splitScalarChannelAtTime({
  channel,
  splitTime,
  includeBoundary = true
}: {
  channel: ScalarAnimationChannel | undefined
  splitTime: number
  includeBoundary?: boolean
}): {
  leftChannel: ScalarAnimationChannel | undefined
  rightChannel: ScalarAnimationChannel | undefined
} {
  if (!channel?.keys.length) return { leftChannel: undefined, rightChannel: undefined }

  const normalized = normalizeScalarChannel({ channel })
  const boundaryTime = roundTime(splitTime)
  let leftKeys = normalized.keys.filter((key) => key.time <= boundaryTime)
  let rightKeys = normalized.keys
    .filter((key) => key.time >= boundaryTime)
    .map((key) => ({ ...key, time: roundTime(key.time - boundaryTime) }))

  const hasLeftBoundary = leftKeys.some((key) => key.time === boundaryTime)
  const hasRightBoundary = rightKeys.some((key) => key.time === 0)
  if (!includeBoundary || (hasLeftBoundary && hasRightBoundary)) {
    return {
      leftChannel: leftKeys.length
        ? normalizeScalarChannel({ channel: { ...normalized, keys: leftKeys } })
        : undefined,
      rightChannel: rightKeys.length
        ? normalizeScalarChannel({ channel: { ...normalized, keys: rightKeys } })
        : undefined
    }
  }

  for (let index = 0; index < normalized.keys.length - 1; index += 1) {
    const leftKey = normalized.keys[index]
    const rightKey = normalized.keys[index + 1]
    if (boundaryTime <= leftKey.time || boundaryTime >= rightKey.time) continue

    const boundaryValue = getScalarChannelValueAtTime({
      channel: normalized,
      time: boundaryTime,
      fallbackValue: leftKey.value
    })

    if (getScalarSegmentType(leftKey) === 'bezier') {
      const rightHandle = leftKey.rightHandle ?? getDefaultRightHandle({ leftKey, rightKey })
      const leftHandle = rightKey.leftHandle ?? getDefaultLeftHandle({ leftKey, rightKey })
      const progress = solveBezierProgressForTime({ time: boundaryTime, leftKey, rightKey })
      const p0 = { x: leftKey.time, y: leftKey.value }
      const p1 = { x: leftKey.time + rightHandle.dt, y: leftKey.value + rightHandle.dv }
      const p2 = { x: rightKey.time + leftHandle.dt, y: rightKey.value + leftHandle.dv }
      const p3 = { x: rightKey.time, y: rightKey.value }
      const q0 = lerpPoint(p0, p1, progress)
      const q1 = lerpPoint(p1, p2, progress)
      const q2 = lerpPoint(p2, p3, progress)
      const r0 = lerpPoint(q0, q1, progress)
      const r1 = lerpPoint(q1, q2, progress)
      const splitPoint = lerpPoint(r0, r1, progress)

      leftKeys = [
        ...normalized.keys.filter((key) => key.time < leftKey.time),
        {
          ...leftKey,
          rightHandle: { dt: roundTime(q0.x - p0.x), dv: q0.y - p0.y }
        },
        {
          id: createAnimationKeyframeId(),
          time: boundaryTime,
          value: boundaryValue,
          leftHandle: {
            dt: roundTime(r0.x - splitPoint.x),
            dv: r0.y - splitPoint.y
          },
          segmentToNext: getScalarSegmentType(leftKey),
          tangentMode: leftKey.tangentMode ?? 'flat'
        }
      ]
      rightKeys = [
        {
          id: createAnimationKeyframeId(),
          time: 0,
          value: boundaryValue,
          rightHandle: {
            dt: roundTime(r1.x - splitPoint.x),
            dv: r1.y - splitPoint.y
          },
          segmentToNext: 'bezier' as const,
          tangentMode: leftKey.tangentMode ?? 'flat'
        },
        {
          ...rightKey,
          time: roundTime(rightKey.time - boundaryTime),
          leftHandle: { dt: roundTime(q2.x - p3.x), dv: q2.y - p3.y }
        },
        ...normalized.keys
          .filter((key) => key.time > rightKey.time)
          .map((key) => ({ ...key, time: roundTime(key.time - boundaryTime) }))
      ]
    } else {
      const segmentToNext = getScalarSegmentType(leftKey)
      leftKeys = [
        ...leftKeys,
        createScalarKey({ time: boundaryTime, value: boundaryValue, segmentToNext: 'linear' })
      ]
      rightKeys = [createScalarKey({ time: 0, value: boundaryValue, segmentToNext }), ...rightKeys]
    }

    return {
      leftChannel: normalizeScalarChannel({ channel: { ...normalized, keys: leftKeys } }),
      rightChannel: normalizeScalarChannel({ channel: { ...normalized, keys: rightKeys } })
    }
  }

  return {
    leftChannel: leftKeys.length
      ? normalizeScalarChannel({ channel: { ...normalized, keys: leftKeys } })
      : undefined,
    rightChannel: rightKeys.length
      ? normalizeScalarChannel({ channel: { ...normalized, keys: rightKeys } })
      : undefined
  }
}
