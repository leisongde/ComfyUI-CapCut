import type { EditingAudioMetadata } from '../../../shared/editing'
import { request } from '../bridge'

export async function fetchAudioResource(
  url: string
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const result = await request<{ bytes: Uint8Array; mimeType?: string }>('media:fetch-url', { url })
  if (!(result?.bytes instanceof Uint8Array) || result.bytes.byteLength === 0)
    throw new Error('在线音频资源为空')
  return { bytes: result.bytes, mimeType: result.mimeType || 'audio/ogg' }
}

export async function listDownloadedAudio(): Promise<EditingAudioMetadata[]> {
  return request<EditingAudioMetadata[]>('audio:list')
}

export async function readDownloadedAudio(
  id: string
): Promise<{ metadata: EditingAudioMetadata; bytes: Uint8Array } | null> {
  return request<{ metadata: EditingAudioMetadata; bytes: Uint8Array } | null>('audio:read', {
    id
  })
}

export async function saveDownloadedAudio(
  metadata: EditingAudioMetadata,
  bytes: Uint8Array
): Promise<void> {
  await request('audio:save', { metadata, bytes }, [bytes.buffer])
}
