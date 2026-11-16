import type { FaceShapeSettings, FacialFeatureSettings } from './beauty'

export interface FaceLandmarkPoint {
  x: number
  y: number
  z?: number
}

export interface DetectedFaceLandmarks {
  landmarks: FaceLandmarkPoint[]
}

export interface FaceWarpPoint {
  centerX: number
  centerY: number
  radiusX: number
  radiusY: number
  deltaX: number
  deltaY: number
}

export interface FaceRegionTransform {
  centerX: number
  centerY: number
  radiusX: number
  radiusY: number
  translateX: number
  translateY: number
  scaleX: number
  scaleY: number
  rotation: number
  brightness: number
}

export interface FaceWarpPlan {
  warps: FaceWarpPoint[]
  regions: FaceRegionTransform[]
}

const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162,
  21, 54, 103, 67, 109
]
const LEFT_CONTOUR = [234, 132, 58, 172, 136, 150]
const RIGHT_CONTOUR = [454, 361, 288, 397, 365, 379]
const LEFT_JAW = [172, 136, 150]
const RIGHT_JAW = [397, 365, 379]
const LEFT_BROW = [70, 63, 105, 66, 107]
const RIGHT_BROW = [336, 296, 334, 293, 300]

interface FaceBounds {
  centerX: number
  centerY: number
  width: number
  height: number
  area: number
}

interface PendingWarp extends FaceWarpPoint {
  weight: number
  limitRatio: number
}

const FACE_CONTOUR_RADIUS_X = 0.3
const FACE_CONTOUR_RADIUS_Y = 0.22
const FACE_CONTOUR_DELTA_LIMIT = 0.24
const FEATURE_DELTA_LIMIT = 0.28

const point = (landmarks: FaceLandmarkPoint[], index: number): FaceLandmarkPoint | null => {
  const value = landmarks[index]
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null
}

const averagePoints = (
  landmarks: FaceLandmarkPoint[],
  indices: readonly number[]
): FaceLandmarkPoint | null => {
  const values = indices.map((index) => point(landmarks, index)).filter(Boolean) as FaceLandmarkPoint[]
  if (!values.length) return null
  return {
    x: values.reduce((sum, value) => sum + value.x, 0) / values.length,
    y: values.reduce((sum, value) => sum + value.y, 0) / values.length
  }
}

const distance = (left: FaceLandmarkPoint, right: FaceLandmarkPoint): number =>
  Math.hypot(left.x - right.x, left.y - right.y)

const boundsOf = (landmarks: FaceLandmarkPoint[]): FaceBounds | null => {
  const oval = FACE_OVAL.map((index) => point(landmarks, index)).filter(Boolean) as FaceLandmarkPoint[]
  if (oval.length < 8) return null
  const minX = Math.min(...oval.map((value) => value.x))
  const maxX = Math.max(...oval.map((value) => value.x))
  const minY = Math.min(...oval.map((value) => value.y))
  const maxY = Math.max(...oval.map((value) => value.y))
  const width = maxX - minX
  const height = maxY - minY
  if (width <= 0.02 || height <= 0.02) return null
  return {
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    width,
    height,
    area: width * height
  }
}

const clampDelta = (value: number, limit: number): number => Math.max(-limit, Math.min(limit, value))

function appendFacePlan(
  plan: FaceWarpPlan,
  landmarks: FaceLandmarkPoint[],
  bounds: FaceBounds,
  faceShape: FaceShapeSettings,
  features: FacialFeatureSettings
) {
  const pending = new Map<number, PendingWarp>()
  const addWarp = (
    index: number,
    deltaX: number,
    deltaY: number,
    radiusX = bounds.width * 0.16,
    radiusY = bounds.height * 0.13,
    weight = 1,
    limitRatio = FEATURE_DELTA_LIMIT
  ) => {
    const anchor = point(landmarks, index)
    if (!anchor || (!deltaX && !deltaY)) return
    const existing = pending.get(index)
    if (existing) {
      existing.deltaX += deltaX
      existing.deltaY += deltaY
      existing.radiusX = Math.max(existing.radiusX, radiusX)
      existing.radiusY = Math.max(existing.radiusY, radiusY)
      existing.weight += weight
      existing.limitRatio = Math.min(existing.limitRatio, limitRatio)
      return
    }
    pending.set(index, {
      centerX: anchor.x,
      centerY: anchor.y,
      radiusX,
      radiusY,
      deltaX,
      deltaY,
      weight,
      limitRatio
    })
  }
  const pullX = (indices: readonly number[], amount: number, strength = 1) => {
    for (const index of indices) {
      const anchor = point(landmarks, index)
      if (anchor)
        addWarp(
          index,
          (bounds.centerX - anchor.x) * amount * strength,
          0,
          bounds.width * FACE_CONTOUR_RADIUS_X,
          bounds.height * FACE_CONTOUR_RADIUS_Y,
          1,
          FACE_CONTOUR_DELTA_LIMIT
        )
    }
  }

  pullX([...LEFT_CONTOUR, ...RIGHT_CONTOUR], faceShape.smoothFace * 0.055)
  pullX([...LEFT_CONTOUR, ...RIGHT_CONTOUR], faceShape.smallFace * 0.11)
  pullX([132, 58, 172, 361, 288, 397], faceShape.slimFace * 0.17)
  pullX([...LEFT_CONTOUR, ...RIGHT_CONTOUR], faceShape.narrowFace * 0.095)
  pullX([172, 136, 397, 365], faceShape.jawline * 0.085)
  pullX([172, 136, 397, 365], faceShape.jawbone * 0.16)
  pullX([234, 132, 454, 361], faceShape.cheekbone * 0.13)
  pullX([...LEFT_JAW, ...RIGHT_JAW], faceShape.vFace * 0.21)

  for (const [index, factor] of [
    [172, 0.35],
    [397, 0.35],
    [136, 0.65],
    [365, 0.65],
    [150, 0.9],
    [379, 0.9],
    [152, 1]
  ] as const) {
    addWarp(
      index,
      0,
      -bounds.height * faceShape.shortFace * 0.055 * factor,
      bounds.width * 0.24,
      bounds.height * 0.22,
      1,
      FACE_CONTOUR_DELTA_LIMIT
    )
  }
  addWarp(
    152,
    0,
    bounds.height * faceShape.chinLength * 0.075,
    bounds.width * 0.24,
    bounds.height * 0.24,
    1,
    FACE_CONTOUR_DELTA_LIMIT
  )

  const noseCenter = point(landmarks, 1) ?? point(landmarks, 4)
  if (noseCenter) {
    const noseSides = [98, 97, 326, 327]
    for (const index of noseSides) {
      const anchor = point(landmarks, index)
      if (!anchor) continue
      const amount = features.noseSlim * 0.24 + features.noseWing * 0.18
      addWarp(
        index,
        (noseCenter.x - anchor.x) * amount,
        0,
        bounds.width * 0.1,
        bounds.height * 0.085
      )
    }
    addWarp(1, 0, bounds.height * features.noseLength * 0.035, bounds.width * 0.1)
    for (const index of [4, 5, 45, 275]) {
      const anchor = point(landmarks, index)
      if (!anchor) continue
      addWarp(
        index,
        (noseCenter.x - anchor.x) * features.noseTip * 0.15,
        (noseCenter.y - anchor.y) * features.noseTip * 0.1,
        bounds.width * 0.085,
        bounds.height * 0.07
      )
    }
    for (const index of [122, 351]) {
      const anchor = point(landmarks, index)
      if (anchor)
        addWarp(
          index,
          (noseCenter.x - anchor.x) * features.noseBridge * 0.13,
          0,
          bounds.width * 0.09,
          bounds.height * 0.12
        )
    }
  }

  const mouthCenter = averagePoints(landmarks, [13, 14, 0, 17])
  const mouthLeft = point(landmarks, 61)
  const mouthRight = point(landmarks, 291)
  if (mouthCenter && mouthLeft && mouthRight) {
    plan.regions.push({
      centerX: mouthCenter.x,
      centerY: mouthCenter.y,
      radiusX: Math.max(distance(mouthLeft, mouthRight) * 0.72, bounds.width * 0.12),
      radiusY: bounds.height * 0.105,
      translateX: 0,
      translateY: bounds.height * features.philtrum * 0.025,
      scaleX: Math.max(0.72, 1 + features.mouthSize * 0.1 + features.mouthWidth * 0.18),
      scaleY: Math.max(0.72, 1 + features.mouthSize * 0.1 + features.lipThickness * 0.2),
      rotation: 0,
      brightness: 0
    })
    addWarp(61, 0, -bounds.height * features.mouthCorner * 0.028, bounds.width * 0.1)
    addWarp(291, 0, -bounds.height * features.mouthCorner * 0.028, bounds.width * 0.1)
  }

  const appendEye = (indices: readonly number[], irisIndex: number) => {
    const inner = point(landmarks, indices[0])
    const outer = point(landmarks, indices[1])
    const center = point(landmarks, irisIndex) ?? averagePoints(landmarks, indices)
    if (!inner || !outer || !center) return
    const eyeWidth = distance(inner, outer)
    const side = center.x < bounds.centerX ? -1 : 1
    plan.regions.push({
      centerX: center.x,
      centerY: center.y,
      radiusX: Math.max(eyeWidth * 0.78, bounds.width * 0.09),
      radiusY: Math.max(eyeWidth * 0.46, bounds.height * 0.055),
      translateX: side * bounds.width * features.eyeDistance * 0.032,
      translateY: bounds.height * features.eyeHeight * 0.025,
      scaleX: 1 + features.bigEyes * 0.15 + features.eyeCorner * 0.11,
      scaleY: 1 + features.bigEyes * 0.19,
      rotation: -side * features.eyeTilt * 0.12,
      brightness: features.brightEyes * 0.18
    })
  }
  appendEye([133, 33, 159, 145], 468)
  appendEye([362, 263, 386, 374], 473)

  const appendBrow = (indices: readonly number[]) => {
    const center = averagePoints(landmarks, indices)
    if (!center) return
    const side = center.x < bounds.centerX ? -1 : 1
    plan.regions.push({
      centerX: center.x,
      centerY: center.y,
      radiusX: bounds.width * 0.18,
      radiusY: bounds.height * 0.07,
      translateX: side * bounds.width * features.browDistance * 0.025,
      translateY: -bounds.height * features.browHeight * 0.03,
      scaleX: 1,
      scaleY: Math.max(0.72, 1 + features.browThickness * 0.18),
      rotation: -side * features.browTilt * 0.11,
      brightness: 0
    })
  }
  appendBrow(LEFT_BROW)
  appendBrow(RIGHT_BROW)

  plan.warps.push(
    ...[...pending.values()]
      .sort((left, right) => right.weight - left.weight)
      .map(({ weight: _weight, limitRatio, ...warp }) => {
        const maxDeltaX = Math.min(bounds.width * 0.075, warp.radiusX * limitRatio)
        const maxDeltaY = Math.min(bounds.height * 0.065, warp.radiusY * limitRatio)
        return {
          ...warp,
          deltaX: clampDelta(warp.deltaX, maxDeltaX),
          deltaY: clampDelta(warp.deltaY, maxDeltaY)
        }
      })
  )
}

export function buildFaceWarpPlan(
  faces: readonly DetectedFaceLandmarks[],
  faceShape: FaceShapeSettings,
  features: FacialFeatureSettings,
  maxFaces = 2
): FaceWarpPlan {
  const plan: FaceWarpPlan = { warps: [], regions: [] }
  faces
    .map((face) => ({ face, bounds: boundsOf(face.landmarks) }))
    .filter((item): item is { face: DetectedFaceLandmarks; bounds: FaceBounds } => Boolean(item.bounds))
    .sort((left, right) => right.bounds.area - left.bounds.area)
    .slice(0, Math.max(1, maxFaces))
    .forEach(({ face, bounds }) =>
      appendFacePlan(plan, face.landmarks, bounds, faceShape, features)
    )
  return plan
}

export function stabilizeFaceLandmarks(
  previous: readonly DetectedFaceLandmarks[],
  current: readonly DetectedFaceLandmarks[],
  alpha = 0.58
): DetectedFaceLandmarks[] {
  if (!previous.length || !current.length) return current.map((face) => ({ landmarks: face.landmarks }))
  const unused = new Set(previous.map((_, index) => index))
  return current.map((face) => {
    const currentBounds = boundsOf(face.landmarks)
    if (!currentBounds) return { landmarks: face.landmarks }
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (const index of unused) {
      const candidateBounds = boundsOf(previous[index].landmarks)
      if (!candidateBounds) continue
      const value = Math.hypot(
        candidateBounds.centerX - currentBounds.centerX,
        candidateBounds.centerY - currentBounds.centerY
      )
      if (value < bestDistance) {
        bestDistance = value
        bestIndex = index
      }
    }
    if (bestIndex < 0 || bestDistance > Math.max(currentBounds.width, currentBounds.height) * 0.45)
      return { landmarks: face.landmarks }
    unused.delete(bestIndex)
    const old = previous[bestIndex].landmarks
    return {
      landmarks: face.landmarks.map((value, index) => {
        const before = old[index]
        if (!before) return value
        return {
          x: before.x + (value.x - before.x) * alpha,
          y: before.y + (value.y - before.y) * alpha,
          z:
            before.z === undefined || value.z === undefined
              ? value.z
              : before.z + (value.z - before.z) * alpha
        }
      })
    }
  })
}
