import catalogData from './catalog-data.json'
import { request } from '../bridge'

export type StickerCategory = 'all' | 'three-d' | 'color' | 'flat' | 'illustration'

type CatalogTuple = [path: string, name: string, search: string]

interface CatalogCollection {
  id: string
  category: Exclude<StickerCategory, 'all'>
  label: string
  items: CatalogTuple[]
}

interface StickerCatalogData {
  version: number
  count: number
  collections: CatalogCollection[]
}

export interface StickerAsset {
  id: string
  name: string
  category: Exclude<StickerCategory, 'all'>
  collection: string
  collectionLabel: string
  remotePath: string
  search: string
}

export const STICKER_REPOSITORY = 'leisongde/Raccoon_dataset'
export const STICKER_BASE_URL = `https://modelscope.cn/models/${STICKER_REPOSITORY}/resolve/master/stickers`

const source = catalogData as StickerCatalogData

export const STICKER_COLLECTIONS = source.collections.map((collection) => ({
  id: collection.id,
  category: collection.category,
  label: collection.label,
  count: collection.items.length
}))

const collections = source.collections.map((collection) => ({
  ...collection,
  items: collection.items.map(([remotePath, name, search]) => ({
    id: `${collection.id}:${remotePath}`,
    name,
    category: collection.category,
    collection: collection.id,
    collectionLabel: collection.label,
    remotePath,
    search: search.toLocaleLowerCase()
  }))
}))

function interleave(groups: StickerAsset[][]): StickerAsset[] {
  const result: StickerAsset[] = []
  const size = Math.max(0, ...groups.map((group) => group.length))
  for (let index = 0; index < size; index++) {
    for (const group of groups) {
      const item = group[index]
      if (item) result.push(item)
    }
  }
  return result
}

const itemsByCategory = new Map<StickerCategory, StickerAsset[]>([
  ['all', interleave(collections.map((collection) => collection.items))]
])

for (const category of ['three-d', 'color', 'flat', 'illustration'] as const) {
  itemsByCategory.set(
    category,
    interleave(
      collections
        .filter((collection) => collection.category === category)
        .map((collection) => collection.items)
    )
  )
}

export const STICKER_COUNT = source.count

export function getStickerItems(category: StickerCategory): StickerAsset[] {
  return itemsByCategory.get(category) || []
}

export function searchStickerItems(items: StickerAsset[], query: string): StickerAsset[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return items
  return items.filter((item) => terms.every((term) => item.search.includes(term)))
}

export function buildStickerUrl(remotePath: string): string {
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/')
  return `${STICKER_BASE_URL}/${encodedPath}?download=true`
}

function dataUrlFromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('读取贴纸文件失败'))
    reader.readAsDataURL(blob)
  })
}

export async function downloadSticker(item: StickerAsset): Promise<{
  dataUrl: string
  sourceUrl: string
  mimeType: string
}> {
  const sourceUrl = buildStickerUrl(item.remotePath)
  const cached = await request<{ bytes: Uint8Array; metadata: { mimeType: string } } | null>('stickers:read' as never, { id: item.id })
  const result = cached || await request<{ bytes: Uint8Array; mimeType: string }>('media:fetch-url', { url: sourceUrl })
  const mimeType = cached?.metadata.mimeType || ('mimeType' in result ? result.mimeType : '') || (item.remotePath.endsWith('.png') ? 'image/png' : 'image/svg+xml')
  const blob = new Blob([result.bytes as unknown as BlobPart], { type: mimeType })
  if (!blob.size) throw new Error('下载的贴纸文件为空')
  if (blob.size > 10 * 1024 * 1024) throw new Error('贴纸文件超过 10 MB')
  if (!cached) await request('stickers:save' as never, { metadata: { id: item.id, mimeType, name: item.name }, bytes: result.bytes })
  return {
    dataUrl: await dataUrlFromBlob(blob),
    sourceUrl,
    mimeType: blob.type || (item.remotePath.endsWith('.png') ? 'image/png' : 'image/svg+xml')
  }
}
