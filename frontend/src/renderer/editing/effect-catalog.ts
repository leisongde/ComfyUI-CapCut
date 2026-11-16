import type { EditingEffectMetadata } from '../../shared/editing'

export const EFFECT_CATALOG_URL =
  'https://modelscope.cn/models/leisongde/Raccoon_dataset/resolve/master/jianji/texiao/catalog.json?view=false'

const EFFECT_FILE_BASE_URL =
  'https://modelscope.cn/models/leisongde/Raccoon_dataset/resolve/master/jianji/texiao/'

export interface EffectCatalogCategory {
  id: string
  label: string
  count: number
}

export interface EffectCatalogItem extends Omit<
  EditingEffectMetadata,
  'sourceUrl' | 'remotePath' | 'downloadedAt'
> {
  schemaVersion: 1
  kind: 'downloadable-video-effect'
  file: string
  downloadUrl?: string
  preview?: { mode?: string; path?: string | null }
}

export interface EffectCatalog {
  schemaVersion: 1
  kind: 'video-effect-collection'
  categories: EffectCatalogCategory[]
  items: EffectCatalogItem[]
  distribution?: { fileBaseUrl?: string; query?: string }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isEffectItem(value: unknown): value is EffectCatalogItem {
  if (!isRecord(value) || !isRecord(value.runtime) || !isRecord(value.source)) return false
  return (
    value.schemaVersion === 1 &&
    value.kind === 'downloadable-video-effect' &&
    value.classification === 'effect' &&
    typeof value.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(value.id) &&
    typeof value.name === 'string' &&
    typeof value.displayNameZh === 'string' &&
    typeof value.category === 'string' &&
    typeof value.categoryLabel === 'string' &&
    isStringArray(value.tags) &&
    typeof value.runtime.engine === 'string' &&
    typeof value.runtime.version === 'string' &&
    typeof value.runtime.entry === 'string' &&
    typeof value.source.provider === 'string' &&
    typeof value.source.repository === 'string' &&
    typeof value.source.commit === 'string' &&
    isStringArray(value.source.paths) &&
    typeof value.source.license === 'string' &&
    typeof value.source.licenseFile === 'string' &&
    typeof value.file === 'string' &&
    /^(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.zip$/.test(value.file) &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    Number.isInteger(value.sizeBytes) &&
    value.sizeBytes > 0
  )
}

export function parseEffectCatalog(value: unknown): EffectCatalog {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== 'video-effect-collection')
    throw new Error('在线特效目录格式无效')

  const items = Array.isArray(value.items) ? value.items.filter(isEffectItem) : []
  const itemIds = new Set<string>()
  const uniqueItems = items.filter((item) => {
    if (itemIds.has(item.id)) return false
    itemIds.add(item.id)
    return true
  })
  const categories = Array.isArray(value.categories)
    ? value.categories
        .filter(
          (item): item is EffectCatalogCategory =>
            isRecord(item) &&
            typeof item.id === 'string' &&
            typeof item.label === 'string' &&
            Number.isInteger(item.count)
        )
        .map((item) => ({
          id: item.id,
          label: item.label,
          count: uniqueItems.filter((effect) => effect.category === item.id).length
        }))
        .filter((item) => item.count > 0)
    : []

  if (!uniqueItems.length) throw new Error('在线目录中没有可用的特效资源')
  return {
    schemaVersion: 1,
    kind: 'video-effect-collection',
    categories,
    items: uniqueItems,
    distribution: isRecord(value.distribution) ? value.distribution : undefined
  }
}

export function buildEffectDownloadUrl(item: EffectCatalogItem, catalog: EffectCatalog): string {
  const base = catalog.distribution?.fileBaseUrl || EFFECT_FILE_BASE_URL
  const query = catalog.distribution?.query || '?view=false'
  const url = new URL(item.file, base)
  if (url.protocol !== 'https:' || url.hostname !== 'modelscope.cn')
    throw new Error('特效下载地址不受支持')
  if (query && !url.search) url.search = query.startsWith('?') ? query.slice(1) : query
  return url.href
}
