import { FaceLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import visionWasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import visionWasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import faceLandmarkerModelUrl from './assets/beauty/face_landmarker.task?url'
import type { DetectedFaceLandmarks } from './face-reshape'

const MAX_ANALYSIS_EDGE = 512
const MAX_FACES = 2

let landmarkerPromise: Promise<FaceLandmarker> | null = null
let unavailable = false
let warned = false
const analysisCanvas = document.createElement('canvas')
const analysisContext = analysisCanvas.getContext('2d', {
  alpha: false,
  desynchronized: true,
  willReadFrequently: false
})

const fileset = {
  wasmLoaderPath: visionWasmLoaderUrl,
  wasmBinaryPath: visionWasmBinaryUrl
}

async function createLandmarker(): Promise<FaceLandmarker> {
  const common = {
    runningMode: 'IMAGE' as const,
    numFaces: MAX_FACES,
    minFaceDetectionConfidence: 0.45,
    minFacePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  }
  try {
    return await FaceLandmarker.createFromOptions(fileset, {
      ...common,
      canvas: document.createElement('canvas'),
      baseOptions: {
        modelAssetPath: faceLandmarkerModelUrl,
        delegate: 'GPU'
      }
    })
  } catch (gpuError) {
    console.info('GPU 人脸关键点初始化失败，改用 CPU', gpuError)
    return await FaceLandmarker.createFromOptions(fileset, {
      ...common,
      baseOptions: {
        modelAssetPath: faceLandmarkerModelUrl,
        delegate: 'CPU'
      }
    })
  }
}

async function getLandmarker(): Promise<FaceLandmarker | null> {
  if (unavailable || !analysisContext) return null
  landmarkerPromise ??= createLandmarker().catch((error) => {
    unavailable = true
    if (!warned) {
      warned = true
      console.warn('本地人脸关键点模型不可用，已跳过脸型和五官变形', error)
    }
    throw error
  })
  try {
    return await landmarkerPromise
  } catch {
    return null
  }
}

function copyLandmark(value: NormalizedLandmark) {
  return {
    x: Math.max(-0.25, Math.min(1.25, value.x)),
    y: Math.max(-0.25, Math.min(1.25, value.y)),
    z: Number.isFinite(value.z) ? value.z : 0
  }
}

export async function detectFaceLandmarks(
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number
): Promise<DetectedFaceLandmarks[]> {
  const landmarker = await getLandmarker()
  if (!landmarker || !analysisContext || width < 2 || height < 2) return []

  const scale = Math.min(1, MAX_ANALYSIS_EDGE / Math.max(width, height))
  const analysisWidth = Math.max(2, Math.round(width * scale))
  const analysisHeight = Math.max(2, Math.round(height * scale))
  if (analysisCanvas.width !== analysisWidth || analysisCanvas.height !== analysisHeight) {
    analysisCanvas.width = analysisWidth
    analysisCanvas.height = analysisHeight
  }
  analysisContext.save()
  analysisContext.setTransform(1, 0, 0, 1, 0, 0)
  analysisContext.fillStyle = '#000'
  analysisContext.fillRect(0, 0, analysisWidth, analysisHeight)
  analysisContext.drawImage(source, 0, 0, analysisWidth, analysisHeight)
  analysisContext.restore()

  try {
    const result = landmarker.detect(analysisCanvas)
    return result.faceLandmarks.map((landmarks) => ({
      landmarks: landmarks.map(copyLandmark)
    }))
  } catch (error) {
    if (!warned) {
      warned = true
      console.warn('人脸关键点检测失败，当前帧已跳过脸型和五官变形', error)
    }
    return []
  }
}
