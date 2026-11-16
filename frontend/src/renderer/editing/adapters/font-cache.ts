import type { EditingFontMetadata } from '../../../shared/editing'
import { request } from '../bridge'

export async function fetchFontResource(url: string): Promise<Uint8Array> {
  const result = await request<{ bytes: Uint8Array }>('fonts:fetch-url', { url })
  if (!(result?.bytes instanceof Uint8Array) || result.bytes.byteLength === 0)
    throw new Error('在线字体资源为空')
  return result.bytes
}

export async function listDownloadedFonts(): Promise<EditingFontMetadata[]> {
  return request<EditingFontMetadata[]>('fonts:list')
}

export async function readDownloadedFont(
  id: string
): Promise<{ metadata: EditingFontMetadata; bytes: Uint8Array } | null> {
  return request<{ metadata: EditingFontMetadata; bytes: Uint8Array } | null>('fonts:read', {
    id
  })
}

export async function saveDownloadedFont(
  metadata: EditingFontMetadata,
  bytes: Uint8Array
): Promise<void> {
  const storedBytes = bytes.slice()
  await request('fonts:save', { metadata, bytes: storedBytes }, [storedBytes.buffer])
}
