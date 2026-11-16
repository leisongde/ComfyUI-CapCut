import type { EditingEffectMetadata } from '../../../shared/editing'
import { request } from '../bridge'

export async function fetchEffectResource(url: string): Promise<Uint8Array> {
  const result = await request<{ bytes: Uint8Array }>('media:fetch-url', { url })
  if (!(result?.bytes instanceof Uint8Array) || result.bytes.byteLength === 0)
    throw new Error('在线特效资源为空')
  return result.bytes
}

export async function listDownloadedEffects(): Promise<EditingEffectMetadata[]> {
  return request<EditingEffectMetadata[]>('effects:list')
}

export async function readDownloadedEffect(
  id: string
): Promise<{ metadata: EditingEffectMetadata; bytes: Uint8Array } | null> {
  return request<{ metadata: EditingEffectMetadata; bytes: Uint8Array } | null>('effects:read', {
    id
  })
}

export async function saveDownloadedEffect(
  metadata: EditingEffectMetadata,
  bytes: Uint8Array
): Promise<void> {
  await request('effects:save', { metadata, bytes }, [bytes.buffer])
}

export async function removeDownloadedEffect(id: string): Promise<void> {
  await request('effects:remove', { id })
}
