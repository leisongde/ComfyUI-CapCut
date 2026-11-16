import type { EditingTransitionMetadata } from '../../../shared/editing'
import { request } from '../bridge'

export async function fetchTransitionResource(url: string): Promise<Uint8Array> {
  const result = await request<{ bytes: Uint8Array }>('media:fetch-url', { url })
  if (!(result?.bytes instanceof Uint8Array) || result.bytes.byteLength === 0)
    throw new Error('在线转场资源为空')
  return result.bytes
}

export async function listDownloadedTransitions(): Promise<EditingTransitionMetadata[]> {
  return request<EditingTransitionMetadata[]>('transitions:list')
}

export async function readDownloadedTransition(
  id: string
): Promise<{ metadata: EditingTransitionMetadata; bytes: Uint8Array } | null> {
  return request<{ metadata: EditingTransitionMetadata; bytes: Uint8Array } | null>(
    'transitions:read',
    { id }
  )
}

export async function saveDownloadedTransition(
  metadata: EditingTransitionMetadata,
  bytes: Uint8Array
): Promise<void> {
  await request('transitions:save', { metadata, bytes }, [bytes.buffer])
}
