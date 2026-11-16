/**
 * Easing presets adapted from OpenCut Classic.
 * Copyright 2025-2026 OpenCut, licensed under the MIT License.
 */

import type { CurveHandle, NormalizedCubicBezier } from './types'

export interface EasingPreset {
  id: string
  label: string
  value: NormalizedCubicBezier
}

export const BUILTIN_EASING_PRESETS: EasingPreset[] = [
  { id: 'smooth', label: '平滑', value: [0.25, 0.1, 0.25, 1] },
  { id: 'ease-out', label: '缓出', value: [0, 0, 0.2, 1] },
  { id: 'ease-in', label: '缓入', value: [0.8, 0, 1, 1] },
  { id: 'ease-in-out', label: '缓入缓出', value: [0.4, 0, 0.2, 1] },
  { id: 'pop', label: '弹出', value: [0.175, 0.885, 0.32, 1.275] },
  { id: 'linear', label: '线性', value: [0, 0, 1, 1] }
]

export function getBezierHandlesForSegment({
  easing,
  timeSpan,
  valueDelta
}: {
  easing: NormalizedCubicBezier
  timeSpan: number
  valueDelta: number
}): { rightHandle: CurveHandle; leftHandle: CurveHandle } {
  const [x1, y1, x2, y2] = easing
  return {
    rightHandle: {
      dt: timeSpan * x1,
      dv: valueDelta * y1
    },
    leftHandle: {
      dt: timeSpan * (x2 - 1),
      dv: valueDelta * (y2 - 1)
    }
  }
}
