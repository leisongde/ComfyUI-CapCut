/**
 * Scalar animation interpolation adapted from OpenCut Classic.
 * Copyright 2025-2026 OpenCut, licensed under the MIT License.
 */

import {
  getBezierPoint,
  getDefaultLeftHandle,
  getDefaultRightHandle,
  solveBezierProgressForTime
} from './bezier'
import type {
  CurveHandle,
  ScalarAnimationChannel,
  ScalarAnimationKey,
  ScalarSegmentType
} from './types'

const DEFAULT_EXTRAPOLATION = { before: 'hold', after: 'hold' } as const

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizeHandle(
  handle: CurveHandle | undefined,
  minimumTimeDelta: number,
  maximumTimeDelta: number
): CurveHandle | undefined {
  if (!handle || !Number.isFinite(handle.dt) || !Number.isFinite(handle.dv)) return undefined
  return {
    dt: clamp(handle.dt, minimumTimeDelta, maximumTimeDelta),
    dv: handle.dv
  }
}

export function normalizeScalarChannel({
  channel,
  duration = Number.POSITIVE_INFINITY
}: {
  channel: ScalarAnimationChannel
  duration?: number
}): ScalarAnimationChannel {
  const maximumTime = Number.isFinite(duration) ? Math.max(0, duration) : Number.POSITIVE_INFINITY
  const sorted = channel.keys
    .filter((key) => Number.isFinite(key.time) && Number.isFinite(key.value))
    .map((key) => ({ ...key, time: clamp(key.time, 0, maximumTime) }))
    .sort((left, right) => left.time - right.time)

  const keys: ScalarAnimationKey[] = []
  for (const key of sorted) {
    const previous = keys.at(-1)
    if (previous?.time === key.time) keys[keys.length - 1] = key
    else keys.push(key)
  }

  const normalizedKeys = keys.map((key, index) => {
    const previous = keys[index - 1]
    const next = keys[index + 1]
    return {
      ...key,
      leftHandle: previous
        ? normalizeHandle(key.leftHandle, previous.time - key.time, 0)
        : undefined,
      rightHandle: next ? normalizeHandle(key.rightHandle, 0, next.time - key.time) : undefined
    }
  })

  return {
    keys: normalizedKeys,
    extrapolation: channel.extrapolation ?? DEFAULT_EXTRAPOLATION
  }
}

function extrapolateScalarEdge({
  mode,
  edgeKey,
  neighborKey,
  time
}: {
  mode: 'hold' | 'linear'
  edgeKey: ScalarAnimationKey
  neighborKey: ScalarAnimationKey | undefined
  time: number
}): number {
  if (mode === 'hold' || !neighborKey) return edgeKey.value
  const span = neighborKey.time - edgeKey.time
  if (span === 0) return edgeKey.value
  return edgeKey.value + ((time - edgeKey.time) / span) * (neighborKey.value - edgeKey.value)
}

export function getScalarSegmentType(key: ScalarAnimationKey): ScalarSegmentType {
  return key.segmentToNext ?? 'linear'
}

export function getScalarChannelValueAtTime({
  channel,
  time,
  fallbackValue
}: {
  channel: ScalarAnimationChannel | undefined
  time: number
  fallbackValue: number
}): number {
  if (!channel?.keys.length) return fallbackValue

  const normalized = normalizeScalarChannel({ channel })
  const first = normalized.keys[0]
  const last = normalized.keys.at(-1)
  if (!first || !last) return fallbackValue

  if (time <= first.time) {
    return time < first.time
      ? extrapolateScalarEdge({
          mode: normalized.extrapolation?.before ?? 'hold',
          edgeKey: first,
          neighborKey: normalized.keys[1],
          time
        })
      : first.value
  }
  if (time >= last.time) {
    return time > last.time
      ? extrapolateScalarEdge({
          mode: normalized.extrapolation?.after ?? 'hold',
          edgeKey: last,
          neighborKey: normalized.keys.at(-2),
          time
        })
      : last.value
  }

  for (let index = 0; index < normalized.keys.length - 1; index += 1) {
    const leftKey = normalized.keys[index]
    const rightKey = normalized.keys[index + 1]
    if (time === rightKey.time) return rightKey.value
    if (time <= leftKey.time || time >= rightKey.time) continue

    const segment = getScalarSegmentType(leftKey)
    if (segment === 'step') return leftKey.value

    const span = rightKey.time - leftKey.time
    if (span <= 0) return rightKey.value
    const progress = clamp((time - leftKey.time) / span, 0, 1)
    if (segment === 'linear') {
      return leftKey.value + (rightKey.value - leftKey.value) * progress
    }

    const curveProgress = solveBezierProgressForTime({ time, leftKey, rightKey })
    const rightHandle = leftKey.rightHandle ?? getDefaultRightHandle({ leftKey, rightKey })
    const leftHandle = rightKey.leftHandle ?? getDefaultLeftHandle({ leftKey, rightKey })
    return getBezierPoint({
      progress: curveProgress,
      p0: leftKey.value,
      p1: leftKey.value + rightHandle.dv,
      p2: rightKey.value + leftHandle.dv,
      p3: rightKey.value
    })
  }

  return last.value
}
