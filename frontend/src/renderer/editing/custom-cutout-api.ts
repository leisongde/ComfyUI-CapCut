import type {
  EditingCustomCutoutRuntimeStatus,
  EditingCustomCutoutSegmentResult,
  EditingCustomCutoutTrackingResult,
  EditingCustomCutoutTrackingSession
} from '../../shared/editing'
import { projectId, request } from './bridge'
import type { CustomCutoutStroke } from './custom-cutout'
import { strokesToModelPoints } from './custom-cutout'

export async function getCustomCutoutStatus(): Promise<EditingCustomCutoutRuntimeStatus> {
  return request('custom-cutout:status')
}

export async function prewarmCustomCutout(
  includeTracking: boolean
): Promise<EditingCustomCutoutRuntimeStatus> {
  return request('custom-cutout:prewarm', { includeTracking }, undefined, 20 * 60 * 1000)
}

export async function segmentCustomCutout(input: {
  rgba: Uint8Array
  width: number
  height: number
  strokes: CustomCutoutStroke[]
}): Promise<EditingCustomCutoutSegmentResult> {
  const points = strokesToModelPoints(input.strokes, input.width, input.height)
  return request(
    'custom-cutout:segment',
    { bytes: input.rgba, width: input.width, height: input.height, points },
    [input.rgba.buffer],
    10 * 60 * 1000
  )
}

export async function startCustomCutoutTracking(input: {
  rgba: Uint8Array
  mask: Uint8Array
  width: number
  height: number
}): Promise<EditingCustomCutoutTrackingSession> {
  return request(
    'custom-cutout:track:start',
    {
      bytes: input.rgba,
      mask: input.mask,
      width: input.width,
      height: input.height
    },
    [input.rgba.buffer, input.mask.buffer],
    20 * 60 * 1000
  )
}

export async function trackCustomCutoutFrame(input: {
  sessionId: string
  rgba: Uint8Array
  width: number
  height: number
}): Promise<EditingCustomCutoutTrackingResult> {
  return request(
    'custom-cutout:track:step',
    {
      sessionId: input.sessionId,
      bytes: input.rgba,
      width: input.width,
      height: input.height
    },
    [input.rgba.buffer],
    10 * 60 * 1000
  )
}

export async function endCustomCutoutTracking(sessionId: string): Promise<void> {
  return request('custom-cutout:track:end', { sessionId })
}

export async function saveCustomCutoutMask(input: {
  elementId: string
  revision: number
  sourceFrame: number
  width: number
  height: number
  bytes: Uint8Array
}): Promise<{ maskRef: string }> {
  return request('custom-cutout:mask:save', { projectId, ...input }, [input.bytes.buffer])
}

export async function saveCustomCutoutMasks(
  inputs: Array<{
    elementId: string
    revision: number
    sourceFrame: number
    width: number
    height: number
    bytes: Uint8Array
  }>
): Promise<Array<{ maskRef: string }>> {
  return request(
    'custom-cutout:mask:save-batch',
    { projectId, entries: inputs },
    inputs.map((input) => input.bytes.buffer)
  )
}

export async function readCustomCutoutMask(maskRef: string): Promise<Uint8Array | null> {
  const result = await request<{ bytes: Uint8Array } | null>('custom-cutout:mask:read', {
    projectId,
    maskRef
  })
  return result?.bytes ?? null
}

export async function removeCustomCutoutRevision(
  elementId: string,
  revision: number
): Promise<void> {
  return request('custom-cutout:mask:remove', { projectId, elementId, revision })
}
