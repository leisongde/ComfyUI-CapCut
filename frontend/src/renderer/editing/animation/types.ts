/**
 * Animation channel types adapted from OpenCut Classic.
 * Copyright 2025-2026 OpenCut, licensed under the MIT License.
 */

export type ScalarSegmentType = 'step' | 'linear' | 'bezier'
export type TangentMode = 'auto' | 'aligned' | 'broken' | 'flat'
export type ChannelExtrapolationMode = 'hold' | 'linear'
export type NormalizedCubicBezier = [number, number, number, number]

export interface CurveHandle {
  dt: number
  dv: number
}

export interface ScalarAnimationKey {
  id?: string
  time: number
  value: number
  leftHandle?: CurveHandle
  rightHandle?: CurveHandle
  segmentToNext?: ScalarSegmentType
  tangentMode?: TangentMode
}

export interface ScalarAnimationChannel {
  keys: ScalarAnimationKey[]
  extrapolation?: {
    before: ChannelExtrapolationMode
    after: ChannelExtrapolationMode
  }
}

export interface ScalarCurveKeyframePatch {
  leftHandle?: CurveHandle | null
  rightHandle?: CurveHandle | null
  segmentToNext?: ScalarSegmentType
  tangentMode?: TangentMode
}
