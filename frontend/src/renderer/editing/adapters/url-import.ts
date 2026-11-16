import { request } from '../bridge'

const mimeTypes: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml'
}

export async function fetchWithProxyFallback({ url }: { url: string }): Promise<Blob> {
  const { bytes, mimeType } = await request<{ bytes: Uint8Array; mimeType: string }>(
    'media:fetch-url',
    { url }
  )
  const extension = new URL(url).pathname.split('.').pop()?.toLowerCase() || ''
  return new Blob([new Uint8Array(bytes)], {
    type:
      mimeType && mimeType !== 'application/octet-stream'
        ? mimeType
        : mimeTypes[extension] || 'application/octet-stream'
  })
}

export async function fetchRemoteMediaAsFile({ url }: { url: string }): Promise<File> {
  const blob = await fetchWithProxyFallback({ url })
  const name = decodeURIComponent(
    new URL(url).pathname.split('/').pop() || `链接素材-${Date.now()}`
  )
  return new File([blob], name, { type: blob.type })
}
