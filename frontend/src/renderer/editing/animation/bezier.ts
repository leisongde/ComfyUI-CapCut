/**
 * Cubic Bezier helpers adapted from OpenCut Classic.
 * Copyright 2025-2026 OpenCut, licensed under the MIT License.
 */

import type { ScalarAnimationKey } from './types'

const BEZIER_SOLVE_ITERATIONS = 20

export function getBezierPoint({
  progress,
  p0,
  p1,
  p2,
  p3
}: {
  progress: number
  p0: number
  p1: number
  p2: number
  p3: number
}): number {
  const inverse = 1 - progress
  return (
    inverse * inverse * inverse * p0 +
    3 * inverse * inverse * progress * p1 +
    3 * inverse * progress * progress * p2 +
    progress * progress * progress * p3
  )
}

export function getDefaultRightHandle({
  leftKey,
  rightKey
}: {
  leftKey: ScalarAnimationKey
  rightKey: ScalarAnimationKey
}) {
  const span = rightKey.time - leftKey.time
  const valueDelta = rightKey.value - leftKey.value
  return { dt: span / 3, dv: valueDelta / 3 }
}

export function getDefaultLeftHandle({
  leftKey,
  rightKey
}: {
  leftKey: ScalarAnimationKey
  rightKey: ScalarAnimationKey
}) {
  const span = rightKey.time - leftKey.time
  const valueDelta = rightKey.value - leftKey.value
  return { dt: -span / 3, dv: -valueDelta / 3 }
}

export function solveBezierProgressForTime({
  time,
  leftKey,
  rightKey
}: {
  time: number
  leftKey: ScalarAnimationKey
  rightKey: ScalarAnimationKey
}): number {
  let lower = 0
  let upper = 1
  const rightHandle = leftKey.rightHandle ?? getDefaultRightHandle({ leftKey, rightKey })
  const leftHandle = rightKey.leftHandle ?? getDefaultLeftHandle({ leftKey, rightKey })

  for (let iteration = 0; iteration < BEZIER_SOLVE_ITERATIONS; iteration += 1) {
    const middle = (lower + upper) / 2
    const estimate = getBezierPoint({
      progress: middle,
      p0: leftKey.time,
      p1: leftKey.time + rightHandle.dt,
      p2: rightKey.time + leftHandle.dt,
      p3: rightKey.time
    })
    if (estimate < time) lower = middle
    else upper = middle
  }

  return (lower + upper) / 2
}
