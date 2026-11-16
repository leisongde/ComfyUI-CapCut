import { downloadSticker, getStickerItems } from './library'
import type { StickerAsset } from './library'

export interface DownloadedStickerAsset {
  dataUrl: string
  sourceUrl: string
  mimeType: string
}

const itemsById = new Map(getStickerItems('all').map((item) => [item.id, item]))
const pendingDownloads = new Map<string, Promise<DownloadedStickerAsset>>()

export function prepareStickerAsset(item: StickerAsset): Promise<DownloadedStickerAsset> {
  const existing = pendingDownloads.get(item.id)
  if (existing) return existing

  const pending = downloadSticker(item).catch((error) => {
    pendingDownloads.delete(item.id)
    throw error
  })
  pendingDownloads.set(item.id, pending)
  return pending
}

export function resolveStickerAsset(id: string): Promise<DownloadedStickerAsset> {
  const item = itemsById.get(id)
  if (!item) return Promise.reject(new Error('找不到对应的贴纸素材'))
  return prepareStickerAsset(item)
}
