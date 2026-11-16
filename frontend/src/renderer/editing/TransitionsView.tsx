import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CloudDownload, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { TransitionsView as BuiltinTransitionsView } from '@cutia/components/editor/panels/assets/views/transitions'
import { useEditor } from '@/hooks/use-editor'
import { findAdjacentPairs } from '@/lib/timeline/transition-utils'
import type { EditingLibraryAsset, EditingTransitionMetadata } from '../../shared/editing'
import {
  fetchTransitionResource,
  listDownloadedTransitions,
  readDownloadedTransition,
  saveDownloadedTransition
} from './adapters/transition-cache'
import { TransitionAssetPicker } from './TransitionAssetPicker'
import { DEFAULT_TRANSITION_PREVIEW, transitionPreviewMode, TransitionPreview } from './TransitionPreview'
import { transitionNameZh } from './transition-i18n'

const CATALOG_URL =
  'https://modelscope.cn/models/leisongde/Raccoon_dataset/resolve/master/zhuanchang/catalog.json?view=false'
const FILE_BASE_URL =
  'https://modelscope.cn/models/leisongde/Raccoon_dataset/resolve/master/zhuanchang/'

type CatalogItem = Omit<EditingTransitionMetadata, 'downloadedAt' | 'sourceUrl' | 'sizeBytes'> & {
  file: string
  downloadUrl?: string
  sizeBytes: number
  nameZh?: string
  preview?: { mode?: string; path?: string | null }
}

type TransitionCatalog = {
  items?: CatalogItem[]
  distribution?: { fileBaseUrl?: string; query?: string }
}

function buildDownloadUrl(item: CatalogItem, catalog: TransitionCatalog): string {
  if (item.downloadUrl) return item.downloadUrl
  const base = catalog.distribution?.fileBaseUrl || FILE_BASE_URL
  const query = catalog.distribution?.query || '?view=false'
  return `${base}${item.file}${query}`
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function categoryLabel(category: string): string {
  return (
    {
      basic: '基础',
      wipe: '擦除',
      zoom: '缩放',
      distortion: '扭曲',
      glitch: '故障',
      light: '光效',
      '3d': '三维',
      artistic: '艺术'
    }[category] ?? category
  )
}

type OnlineCategoryId =
  | 'all'
  | 'hot'
  | 'fade'
  | 'slide'
  | 'motion'
  | 'blur'
  | 'latest'
  | 'light'
  | 'shoot'
  | 'distortion'
  | 'artistic'

const ONLINE_CATEGORIES: Array<{ id: OnlineCategoryId; label: string }> = [
  { id: 'hot', label: '热门' },
  { id: 'all', label: '全部' },
  { id: 'fade', label: '叠化' },
  { id: 'slide', label: '幻灯片' },
  { id: 'motion', label: '运镜' },
  { id: 'blur', label: '模糊' },
  { id: 'latest', label: '最新' },
  { id: 'light', label: '光效' },
  { id: 'shoot', label: '拍摄' },
  { id: 'distortion', label: '扭曲' },
  { id: 'artistic', label: '艺术' }
]

function matchesOnlineCategory(item: CatalogItem, selected: OnlineCategoryId, index: number, total: number): boolean {
  if (selected === 'all') return true
  if (selected === 'hot') return index < Math.min(12, total)
  if (selected === 'latest') return index >= Math.max(0, total - 12)

  const key = `${item.id} ${item.name}`.toLowerCase().replace(/[\s_-]+/g, '')
  switch (selected) {
    case 'fade':
      return item.category === 'basic' || /(fade|dissolve|luma|melt|overexposure)/.test(key)
    case 'slide':
      return item.category === 'wipe' || /(slide|wipe|curtain|doorway|windowblind)/.test(key)
    case 'motion':
      return item.category === 'zoom' || /(zoom|rotate|roll|revolve|swap|cross|wind|squeeze)/.test(key)
    case 'blur':
      return /(blur|defocus|ripple|perlin|motionblur)/.test(key)
    case 'light':
      return item.category === 'light' || /(burn|overexposure|colorphase|colour|film|exposure)/.test(key)
    case 'shoot':
      return item.category === '3d' || /(film|tv|stereo|camera|oldtv|viewer)/.test(key)
    case 'distortion':
      return item.category === 'distortion' || item.category === 'glitch' || /(glitch|datamosh|mosaic|displace|warp)/.test(key)
    case 'artistic':
      return item.category === 'artistic'
    default:
      return false
  }
}

function loadPreviewAsset(slot: 'from' | 'to'): EditingLibraryAsset | null {
  try {
    const raw = localStorage.getItem(`editing-transition-preview-${slot}`)
    return raw ? (JSON.parse(raw) as EditingLibraryAsset) : null
  } catch {
    return null
  }
}

export function TransitionsView() {
  const [view, setView] = useState<'builtin' | 'online'>('builtin')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b bg-background px-3 py-2">
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            view === 'builtin'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
          onClick={() => setView('builtin')}
        >
          内置转场
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            view === 'online'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
          onClick={() => setView('online')}
        >
          在线转场
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'builtin' ? <BuiltinTransitionsView /> : <OnlineTransitionsView />}
      </div>
    </div>
  )
}

function OnlineTransitionsView() {
  const editor = useEditor()
  const [catalog, setCatalog] = useState<TransitionCatalog | null>(null)
  const [items, setItems] = useState<CatalogItem[]>([])
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [previewFrom, setPreviewFrom] = useState<EditingLibraryAsset | null>(() => loadPreviewAsset('from'))
  const [previewTo, setPreviewTo] = useState<EditingLibraryAsset | null>(() => loadPreviewAsset('to'))
  const [pickerSlot, setPickerSlot] = useState<'from' | 'to' | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<OnlineCategoryId>('hot')
  const sourceCache = useRef(new Map<string, string>())

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void Promise.all([
      fetchTransitionResource(CATALOG_URL).then((bytes) => {
        try {
          return JSON.parse(new TextDecoder().decode(bytes)) as TransitionCatalog
        } catch {
          throw new Error('在线目录格式无效')
        }
      }),
      listDownloadedTransitions()
    ])
      .then(([remoteCatalog, localTransitions]) => {
        const nextItems = Array.isArray(remoteCatalog.items) ? remoteCatalog.items : []
        setCatalog(remoteCatalog)
        setItems(nextItems)
        setDownloaded(new Set(localTransitions.map((item) => item.id)))
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : '在线转场加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [reloadToken])

  useEffect(() => {
    if (previewFrom) localStorage.setItem('editing-transition-preview-from', JSON.stringify(previewFrom))
    else localStorage.removeItem('editing-transition-preview-from')
  }, [previewFrom])

  useEffect(() => {
    if (previewTo) localStorage.setItem('editing-transition-preview-to', JSON.stringify(previewTo))
    else localStorage.removeItem('editing-transition-preview-to')
  }, [previewTo])

  const visibleItems = useMemo(
    () => items.filter((item, index) => matchesOnlineCategory(item, selectedCategory, index, items.length)),
    [items, selectedCategory]
  )

  const selectedCategoryLabel =
    ONLINE_CATEGORIES.find((category) => category.id === selectedCategory)?.label || '全部'

  const getShaderSource = async (item: CatalogItem): Promise<string> => {
    const cached = sourceCache.current.get(item.id)
    if (cached) return cached
    const downloaded = await readDownloadedTransition(item.id)
    if (!downloaded) throw new Error('请先下载这个在线转场')
    const source = new TextDecoder().decode(downloaded.bytes)
    sourceCache.current.set(item.id, source)
    return source
  }

  async function download(item: CatalogItem): Promise<void> {
    if (!catalog || downloadingId) return
    setDownloadingId(item.id)
    try {
      const bytes = await fetchTransitionResource(buildDownloadUrl(item, catalog))
      if (!bytes.byteLength) throw new Error('转场文件为空')
      const actualHash = await sha256(bytes)
      const legacyCatalog = !catalog.distribution?.fileBaseUrl
      if (item.sha256 && actualHash !== item.sha256 && !legacyCatalog)
        throw new Error('转场文件校验失败，请更新魔搭目录清单后重试')
      const metadata: EditingTransitionMetadata = {
        id: item.id,
        name: item.name,
        displayNameZh: transitionNameZh(item.id, item.nameZh || item.name),
        sourceName: item.sourceName,
        kind: 'shader',
        category: item.category,
        sourceUrl: buildDownloadUrl(item, catalog),
        remotePath: item.file,
        sha256: actualHash,
        sizeBytes: bytes.byteLength,
        license: item.license,
        author: item.author,
        params: item.params,
        downloadedAt: new Date().toISOString()
      }
      await saveDownloadedTransition(metadata, bytes)
      sourceCache.current.set(item.id, new TextDecoder().decode(bytes))
      setDownloaded((current) => new Set(current).add(item.id))
      toast.success(`${transitionNameZh(item.id, item.nameZh || item.name)} 已下载到软件数据目录`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '转场下载失败')
    } finally {
      setDownloadingId(null)
    }
  }

  async function applyToAdjacentClips(item: CatalogItem): Promise<void> {
    if (!downloaded.has(item.id)) {
      toast.info('请先下载这个在线转场')
      return
    }
    try {
      const shaderSource = await getShaderSource(item)
      const type = `shader:${item.id}` as any
      const displayName = transitionNameZh(item.id, item.nameZh || item.name)
      let applied = 0
      for (const track of editor.timeline.getTracks()) {
        if (track.type !== 'video') continue
        for (const pair of findAdjacentPairs({ track })) {
          const transition = editor.timeline.addTransition({
            trackId: track.id,
            fromElementId: pair.from.id,
            toElementId: pair.to.id,
            type,
            duration: 0.5
          })
          if (!transition) continue
          editor.timeline.updateTransition({
            trackId: track.id,
            transitionId: transition.id,
            updates: {
              type,
              shaderSource,
              shaderId: item.id,
              shaderName: displayName,
              shaderParams: item.params?.defaults ?? {}
            } as any
          })
          applied += 1
        }
      }
      if (applied === 0) {
        toast.info('没有找到相邻的图片或视频片段，请先把素材放到同一条视频轨道上')
      } else {
        toast.success(`已将“${displayName}”应用到 ${applied} 个片段衔接处`)
      }
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '在线转场应用失败')
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">在线转场</h3>
            <span className="text-[10px] text-muted-foreground">gl-transitions</span>
            {!loading && !error ? (
              <span className="text-[10px] text-muted-foreground">{items.length} 个</span>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="刷新在线转场"
            title="刷新在线转场"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setReloadToken((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="mr-1">预览素材</span>
          <button type="button" className="rounded border px-2 py-1 hover:bg-accent" onClick={() => setPickerSlot('from')}>
            第一张：{previewFrom?.name || '内置示例图'}
          </button>
          <button type="button" className="rounded border px-2 py-1 hover:bg-accent" onClick={() => setPickerSlot('to')}>
            第二张：{previewTo?.name || '内置示例图'}
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-muted-foreground hover:bg-accent disabled:cursor-default disabled:opacity-40"
            onClick={() => {
              setPreviewFrom(null)
              setPreviewTo(null)
            }}
            disabled={!previewFrom && !previewTo}
            title="恢复内置示例图片"
          >
            恢复初始
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-[108px] shrink-0 overflow-y-auto border-r bg-muted/20 px-2 py-3">
          <div className="mb-2 px-2 text-[10px] font-semibold text-muted-foreground">转场效果</div>
          <nav className="space-y-0.5" aria-label="在线转场分类">
            {ONLINE_CATEGORIES.map((category) => {
              const active = selectedCategory === category.id
              const count = items.filter((item, index) => matchesOnlineCategory(item, category.id, index, items.length)).length
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-[11px] transition-colors ${
                    active
                      ? 'bg-primary/15 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  <span>{category.label}</span>
                  <span className="text-[9px] opacity-60">{count}</span>
                </button>
              )
            })}
          </nav>
        </aside>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="mb-2 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
            <span className="font-medium text-foreground">{selectedCategoryLabel}</span>
            {!loading && !error ? <span>{visibleItems.length} 个转场</span> : null}
          </div>
          {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            正在加载在线转场…
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>{error}</span>
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-foreground hover:bg-accent"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              重试
            </button>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            在线目录暂时没有转场
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {visibleItems.map((item, index) => {
              const isDownloaded = downloaded.has(item.id)
              const isDownloading = downloadingId === item.id
              const displayName = transitionNameZh(item.id, item.nameZh || item.name)
              return (
                <div
                  key={item.id}
                  className="min-w-0 rounded-lg border bg-muted/30 p-2 transition-colors hover:bg-accent"
                >
                  <div className="relative mb-1.5 overflow-hidden rounded bg-muted">
                    <TransitionPreview
                      from={previewFrom?.previewUrl || DEFAULT_TRANSITION_PREVIEW.from}
                      to={previewTo?.previewUrl || DEFAULT_TRANSITION_PREVIEW.to}
                      variant={index}
                      mode={transitionPreviewMode(item)}
                    />
                    <span className="absolute bottom-0.5 left-1 rounded bg-black/50 px-1 text-[8px] text-white">
                      {categoryLabel(item.category)}
                    </span>
                  </div>
                  <div className="truncate text-[10px] font-medium" title={displayName}>
                    {displayName}
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded border px-2 py-1 text-[10px] hover:bg-background disabled:cursor-default"
                      disabled={isDownloaded || Boolean(downloadingId)}
                      onClick={() => void download(item)}
                    >
                      {isDownloaded ? <Check className="size-3" /> : <CloudDownload className="size-3" />}
                      {isDownloading ? '下载中…' : isDownloaded ? '已下载' : '下载'}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10 disabled:cursor-default"
                      disabled={!isDownloaded || Boolean(downloadingId)}
                      onClick={() => void applyToAdjacentClips(item)}
                      title="应用到所有相邻片段"
                    >
                      应用
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          )}
        </div>
      </div>
      {pickerSlot && (
        <TransitionAssetPicker
          open
          slot={pickerSlot}
          onOpenChange={(open) => {
            if (!open) setPickerSlot(null)
          }}
          onSelect={(asset) => {
            if (pickerSlot === 'from') setPreviewFrom(asset)
            else setPreviewTo(asset)
            setPickerSlot(null)
          }}
        />
      )}
    </section>
  )
}
