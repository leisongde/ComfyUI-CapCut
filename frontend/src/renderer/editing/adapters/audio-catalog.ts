export const AUDIO_CATALOG_URL =
  'https://modelscope.cn/models/leisongde/audio/resolve/master/audio/catalog.json?view=false'
export const AUDIO_INVENTORY_URL =
  'https://modelscope.cn/api/v1/models/leisongde/audio/repo/files?Revision=master&Root=audio/sounds&Recursive=true&PageNumber=1&PageSize=1000'
const AUDIO_FILE_BASE_URL = 'https://modelscope.cn/models/leisongde/audio/resolve/master/audio/'

export type AudioCatalogItem = {
  id: string
  name: string
  nameZh?: string
  kind: 'audio'
  category: string
  categoryLabel: string
  tags?: string[]
  file: string
  remotePath: string
  downloadUrl?: string
  mimeType: string
  sizeBytes: number
  sha256: string
  license: string
  author: string
  sourceUrl: string
}

export type AudioCatalog = {
  items?: AudioCatalogItem[]
  categories?: Array<{ id: string; label: string; count: number }>
  distribution?: { fileBaseUrl?: string; query?: string }
}

type ModelScopeInventory = {
  Code?: number
  Data?: {
    Files?: Array<{ Path?: string; Type?: string }>
  }
}

export type ReconciledAudioCatalog = {
  catalog: AudioCatalog
  items: AudioCatalogItem[]
  availableCount: number
  totalCount: number
}

export function parseAudioCatalog(bytes: Uint8Array): AudioCatalog {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as AudioCatalog
  if (!Array.isArray(parsed.items) || !Array.isArray(parsed.categories))
    throw new Error('在线音频目录格式无效')
  return parsed
}

export function reconcileAudioCatalog(
  catalog: AudioCatalog,
  inventoryBytes: Uint8Array,
  cachedIds: ReadonlySet<string> = new Set()
): ReconciledAudioCatalog {
  const inventory = JSON.parse(new TextDecoder().decode(inventoryBytes)) as ModelScopeInventory
  if (inventory.Code !== 200 || !Array.isArray(inventory.Data?.Files))
    throw new Error('在线音频文件清单格式无效')

  const onlinePaths = new Set(
    inventory.Data.Files.filter((file) => file.Type === 'blob' && file.Path?.endsWith('.ogg')).map(
      (file) => file.Path!.replace(/^audio\//, '')
    )
  )
  const sourceItems = catalog.items || []
  const items = sourceItems.filter((item) => onlinePaths.has(item.file) || cachedIds.has(item.id))
  const countByCategory = new Map<string, number>()
  for (const item of items)
    countByCategory.set(item.category, (countByCategory.get(item.category) || 0) + 1)
  const categories = (catalog.categories || [])
    .map((category) => ({ ...category, count: countByCategory.get(category.id) || 0 }))
    .filter((category) => category.count > 0)

  return {
    catalog: { ...catalog, categories },
    items,
    availableCount: sourceItems.filter((item) => onlinePaths.has(item.file)).length,
    totalCount: sourceItems.length
  }
}

export function buildAudioDownloadUrl(item: AudioCatalogItem): string {
  return `${AUDIO_FILE_BASE_URL}${item.file}?view=false`
}
