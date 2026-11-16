import type {
  EditingCaptionRuntimeStatus,
  EditingCaptionTranscriptionResult
} from '../../../shared/editing'
import { request } from '../bridge'

const TRANSCRIPTION_TIMEOUT_MS = 12 * 60 * 60 * 1000

export const getCaptionRuntimeStatus = (): Promise<EditingCaptionRuntimeStatus> =>
  request<EditingCaptionRuntimeStatus>('captions:status')

export const transcribeTimelineAudio = (
  bytes: Uint8Array
): Promise<EditingCaptionTranscriptionResult> =>
  request<EditingCaptionTranscriptionResult>(
    'captions:transcribe',
    { bytes },
    [bytes.buffer],
    TRANSCRIPTION_TIMEOUT_MS
  )
