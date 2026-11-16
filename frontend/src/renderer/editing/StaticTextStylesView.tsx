import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Check, CloudDownload, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@/hooks/use-editor'
import { DEFAULT_TEXT_ELEMENT } from '@/constants/text-constants'
import { buildTextElement } from '@/lib/timeline/element-utils'
import type { TextElement } from '@/types/timeline'
import type {
  EditingStaticTextStyleDefinition,
  EditingTextTemplateMetadata
} from '../../shared/editing'
import {
  fetchTextTemplateResource,
  listDownloadedTextTemplates,
  readDownloadedTextTemplate,
  saveDownloadedTextTemplate
} from './adapters/text-template-cache'

const CATALOG_URL =
  'https://modelscope.cn/models/leisongde/Raccoon_dataset/resolve/master/jianji/huazi/catalog.json?view=false'
const FILE_BASE_URL =
  'https://modelscope.cn/models/leisongde/Raccoon_dataset/resolve/master/jianji/huazi/'

type StaticStyleCatalogItem = {
  id: string
  name: string
  displayNameZh?: string
  category: string
  categoryLabel?: string
  tags: string[]
  file: string
  remotePath?: string
  downloadUrl?: string
  sizeBytes: number
  sha256: string
  license: string
  author: string
  sourceUrl?: string
}

type StaticStyleCatalog = {
  kind?: string
  items?: StaticStyleCatalogItem[]
  distribution?: { fileBaseUrl?: string; query?: string }
}

function buildDownloadUrl(item: StaticStyleCatalogItem, catalog: StaticStyleCatalog): string {
  const relativePath = item.remotePath || item.file
  const query = catalog.distribution?.query || '?view=false'
  if (relativePath) return `${FILE_BASE_URL}${relativePath}${query}`
  if (item.downloadUrl) return item.downloadUrl
  return `${FILE_BASE_URL}${item.file}${query}`
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function displayName(item: StaticStyleCatalogItem): string {
  return item.displayNameZh || item.name
}

function categoryItems(items: StaticStyleCatalogItem[]): Array<{ id: string; label: string }> {
  const categories = new Map<string, string>()
  for (const item of items) categories.set(item.category, item.categoryLabel || item.category)
  return [{ id: 'all', label: '全部' }, ...Array.from(categories, ([id, label]) => ({ id, label }))]
}

function StaticStylePreview({ item }: { item: StaticStyleCatalogItem }): ReactElement {
  const previewClass =
    item.category === 'neon-gaming'
      ? 'text-yellow-300 [text-shadow:0_2px_0_#111827,0_0_8px_#f97316]'
      : item.category === 'short-video'
        ? 'text-sky-200 [text-shadow:2px_2px_0_#0f172a,0_0_6px_rgba(0,0,0,.8)]'
        : 'text-white [text-shadow:2px_2px_0_#111827,0_0_5px_rgba(0,0,0,.9)]'

  return (
    <div className="relative flex aspect-[1.65] items-center justify-center overflow-hidden rounded bg-slate-950">
      <span className={`px-2 text-center text-lg font-bold ${previewClass}`}>花字</span>
    </div>
  )
}

export function StaticTextStylesView(): ReactElement {
  const [catalog, setCatalog] = useState<StaticStyleCatalog | null>(null)
  const [items, setItems] = useState<StaticStyleCatalogItem[]>([])
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const editor = useEditor()

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const timeout = new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error('在线花字目录加载超时')), 5000)
    )

    void Promise.all([
      Promise.race([
        fetchTextTemplateResource(CATALOG_URL).then(
          (bytes) => JSON.parse(new TextDecoder().decode(bytes)) as StaticStyleCatalog
        ),
        timeout
      ]),
      listDownloadedTextTemplates()
    ])
      .then(([remoteCatalog, cached]) => {
        if (controller.signal.aborted) return
        if (
          remoteCatalog.kind !== 'static-text-style-collection' ||
          !Array.isArray(remoteCatalog.items)
        )
          throw new Error('花字目录格式不受支持')
        setCatalog(remoteCatalog)
        setItems(remoteCatalog.items)
        setDownloaded(
          new Set(
            cached
              .filter((item) =>
                remoteCatalog.items?.some(
                  (remote) => remote.id === item.id && remote.sha256 === item.sha256
                )
              )
              .map((item) => item.id)
          )
        )
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setCatalog(null)
        setItems([])
        setDownloaded(new Set())
        setError(reason instanceof Error ? reason.message : '在线花字目录加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [reloadToken])

  const categories = useMemo(() => categoryItems(items), [items])
  const visibleItems = useMemo(
    () => items.filter((item) => selectedCategory === 'all' || item.category === selectedCategory),
    [items, selectedCategory]
  )

  async function download(item: StaticStyleCatalogItem): Promise<void> {
    if (!catalog || downloadingId) return
    setDownloadingId(item.id)
    try {
      const bytes = await fetchTextTemplateResource(buildDownloadUrl(item, catalog))
      const actualHash = await sha256(bytes)
      if (item.sha256 && actualHash !== item.sha256)
        throw new Error('花字文件校验失败，请刷新目录后重试')

      const metadata: EditingTextTemplateMetadata = {
        id: item.id,
        name: item.name,
        displayNameZh: displayName(item),
        category: item.category,
        categoryLabel: item.categoryLabel || item.category,
        tags: item.tags,
        sourceUrl: item.sourceUrl || buildDownloadUrl(item, catalog),
        remotePath: item.remotePath || item.file,
        sha256: actualHash,
        sizeBytes: bytes.byteLength,
        license: item.license,
        author: item.author,
        downloadedAt: new Date().toISOString()
      }
      await saveDownloadedTextTemplate(metadata, bytes)
      setDownloaded((current) => new Set(current).add(item.id))
      toast.success(`${displayName(item)} 已下载`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '花字下载失败')
    } finally {
      setDownloadingId(null)
    }
  }

  async function addToTimeline(item: StaticStyleCatalogItem): Promise<void> {
    if (!downloaded.has(item.id)) {
      toast.info('请先下载这个花字')
      return
    }
    try {
      const cached = await readDownloadedTextTemplate(item.id)
      if (!cached) throw new Error('已下载花字不存在，请重新下载')
      const definition = JSON.parse(
        new TextDecoder().decode(cached.bytes)
      ) as EditingStaticTextStyleDefinition
      if (definition.schemaVersion !== 1 || definition.kind !== 'static-text-style')
        throw new Error('花字格式暂不支持')

      const raw: Partial<Omit<TextElement, 'type' | 'id'>> = {
        ...DEFAULT_TEXT_ELEMENT,
        name: displayName(item),
        content: '输入文字',
        ...definition.style,
        // 花字只保留字体、颜色、描边和阴影；字幕底框属于文字模板效果。
        backgroundColor: 'transparent',
        backgroundOpacity: 0,
        backgroundBorderRadius: 0,
        backgroundPaddingX: 0,
        backgroundPaddingY: 0
      }
      const base = buildTextElement({
        raw,
        startTime: editor.playback.getCurrentTime()
      })
      editor.timeline.insertElement({
        element: base,
        placement: { mode: 'auto', trackType: 'text' }
      })
      toast.success(`${displayName(item)} 已添加到时间线`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '花字应用失败')
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">花字</h3>
            <span className="text-[10px] text-muted-foreground">静态颜色与描边</span>
            {!loading && (
              <span className="text-[10px] text-muted-foreground">{items.length} 个</span>
            )}
          </div>
          <button
            type="button"
            aria-label="刷新花字"
            title="刷新花字"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setReloadToken((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground">
          花字需要先下载，下载后才能添加到文字轨道。
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-[108px] shrink-0 overflow-y-auto border-r bg-muted/20 px-2 py-3">
          <div className="mb-2 px-2 text-[10px] font-semibold text-muted-foreground">花字分类</div>
          <nav className="space-y-0.5" aria-label="花字分类">
            {categories.map((category) => {
              const active = selectedCategory === category.id
              const count =
                category.id === 'all'
                  ? items.length
                  : items.filter((item) => item.category === category.id).length
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-[11px] transition-colors ${active ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
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
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              正在加载花字…
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <span>{error || '暂无花字'}</span>
              {error && (
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-[10px] hover:bg-accent"
                  onClick={() => setReloadToken((value) => value + 1)}
                >
                  重试
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {visibleItems.map((item) => {
                const isDownloaded = downloaded.has(item.id)
                const isDownloading = downloadingId === item.id
                return (
                  <div
                    key={item.id}
                    className="min-w-0 rounded-lg border bg-muted/30 p-2 transition-colors hover:bg-accent"
                  >
                    <StaticStylePreview item={item} />
                    <div
                      className="mt-1 truncate text-[11px] font-medium"
                      title={displayName(item)}
                    >
                      {displayName(item)}
                    </div>
                    <div
                      className="mt-0.5 truncate text-[10px] text-muted-foreground"
                      title={item.tags.join('、')}
                    >
                      {item.tags.join(' · ')}
                    </div>
                    <div className="mt-1.5 flex gap-1">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded border px-2 py-1 text-[10px] hover:bg-background disabled:cursor-default"
                        disabled={isDownloaded || Boolean(downloadingId)}
                        onClick={() => void download(item)}
                      >
                        {isDownloaded ? (
                          <Check className="size-3" />
                        ) : (
                          <CloudDownload className="size-3" />
                        )}
                        {isDownloading ? '下载中…' : isDownloaded ? '已下载' : '下载'}
                      </button>
                      <button
                        type="button"
                        className="flex items-center justify-center gap-1 rounded border border-primary/50 px-2 py-1 text-[10px] text-primary hover:bg-primary/10 disabled:cursor-default"
                        disabled={!isDownloaded || Boolean(downloadingId)}
                        onClick={() => void addToTimeline(item)}
                        title="添加到文字轨道"
                      >
                        <Plus className="size-3" /> 添加
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
