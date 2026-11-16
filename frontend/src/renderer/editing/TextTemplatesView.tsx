import { useEffect, useMemo, useState } from 'react'
import { Check, CloudDownload, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@/hooks/use-editor'
import { DEFAULT_TEXT_ELEMENT } from '@/constants/text-constants'
import { buildTextElement } from '@/lib/timeline/element-utils'
import type {
  EditingTextTemplateDefinition,
  EditingTextTemplateMetadata
} from '../../shared/editing'
import {
  fetchTextTemplateResource,
  listDownloadedTextTemplates,
  readDownloadedTextTemplate,
  saveDownloadedTextTemplate
} from './adapters/text-template-cache'
import {
  DEFAULT_TEXT_TEMPLATE_BY_ID,
  DEFAULT_TEXT_TEMPLATE_CATALOG
} from './text-template-defaults'
import { StaticTextStylesView } from './StaticTextStylesView'
import { SmartTextView } from './SmartTextView'

const CATALOG_URL =
  'https://modelscope.cn/models/leisongde/Raccoon_dataset/resolve/master/jianji/weizimoban/catalog.json?view=false'
const FILE_BASE_URL =
  'https://modelscope.cn/models/leisongde/Raccoon_dataset/resolve/master/jianji/weizimoban/'

type CatalogItem = Omit<
  EditingTextTemplateMetadata,
  'downloadedAt' | 'sourceUrl' | 'sizeBytes' | 'sha256'
> & {
  file: string
  downloadUrl?: string
  sizeBytes: number
  sha256: string
  licenseFile?: string
  sourceUrl?: string
  bundled?: boolean
}

type TextTemplateCatalog = {
  items?: CatalogItem[]
  distribution?: { fileBaseUrl?: string; query?: string }
}

type TextTemplateTab = 'basic' | 'online' | 'static-styles' | 'smart-text'

function buildDownloadUrl(item: CatalogItem, catalog: TextTemplateCatalog): string {
  // The uploaded catalog may retain URLs from the staging repository. The
  // desktop integration owns the published collection base, so prefer the
  // catalog's relative path and keep old absolute URLs as a last resort.
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

function fallbackCatalog(): TextTemplateCatalog {
  return {
    ...DEFAULT_TEXT_TEMPLATE_CATALOG,
    items: DEFAULT_TEXT_TEMPLATE_CATALOG.items.map((item) => ({ ...item, bundled: true }))
  }
}

function bundledBytes(id: string): Uint8Array | null {
  const definition = DEFAULT_TEXT_TEMPLATE_BY_ID.get(id)
  return definition ? new TextEncoder().encode(JSON.stringify(definition)) : null
}

function displayName(item: CatalogItem): string {
  return item.displayNameZh || item.name
}

function categoryItems(items: CatalogItem[]): Array<{ id: string; label: string }> {
  const categories = new Map<string, string>()
  for (const item of items) categories.set(item.category, item.categoryLabel || item.category)
  return [{ id: 'all', label: '全部' }, ...Array.from(categories, ([id, label]) => ({ id, label }))]
}

function TemplatePreview({ item }: { item: CatalogItem }) {
  const animationClass =
    item.id === 'rise-fade'
      ? 'text-template-preview-rise'
      : item.id === 'elastic-pop' || item.id === 'zoom-focus'
        ? 'text-template-preview-pop'
        : item.id === 'slide-in-right'
          ? 'text-template-preview-slide'
          : item.id === 'bounce-in'
            ? 'text-template-preview-bounce'
            : 'text-template-preview-fade'
  return (
    <div className="relative flex aspect-[1.65] items-center justify-center overflow-hidden rounded bg-slate-950">
      <style>{`
        @keyframes text-template-preview-rise { 0%, 100% { opacity: .25; transform: translateY(16px); } 45%, 72% { opacity: 1; transform: translateY(0); } }
        @keyframes text-template-preview-pop { 0%, 100% { opacity: .35; transform: scale(.65); } 45%, 72% { opacity: 1; transform: scale(1); } }
        @keyframes text-template-preview-slide { 0%, 100% { opacity: .2; transform: translateX(36px); } 45%, 72% { opacity: 1; transform: translateX(0); } }
        @keyframes text-template-preview-bounce { 0%, 100% { opacity: .25; transform: translateY(-30px); } 45% { opacity: 1; transform: translateY(0); } 58% { transform: translateY(-7px); } 72% { transform: translateY(0); } }
        @keyframes text-template-preview-fade { 0%, 100% { opacity: .12; } 45%, 72% { opacity: 1; } }
        .${animationClass} { animation: ${animationClass.replace('text-template-preview-', 'text-template-preview-')} 2.1s ease-in-out infinite; }
      `}</style>
      <span
        className={`${animationClass} px-2 text-center text-lg font-bold text-white drop-shadow-[0_2px_5px_rgba(0,0,0,.8)]`}
      >
        文字模板
      </span>
    </div>
  )
}

export function TextTemplatesView() {
  const [tab, setTab] = useState<TextTemplateTab>('online')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b bg-background px-3 py-2">
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'basic' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
          onClick={() => setTab('basic')}
        >
          基础文字
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'online' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
          onClick={() => setTab('online')}
        >
          文字模板
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'static-styles' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
          onClick={() => setTab('static-styles')}
        >
          花字
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'smart-text' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
          onClick={() => setTab('smart-text')}
        >
          智能文本
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'basic' ? (
          <BasicTextView />
        ) : tab === 'static-styles' ? (
          <StaticTextStylesView />
        ) : tab === 'smart-text' ? (
          <SmartTextView />
        ) : (
          <OnlineTextTemplatesView />
        )}
      </div>
    </div>
  )
}

function BasicTextView() {
  const editor = useEditor()
  const add = () => {
    const element = buildTextElement({
      raw: DEFAULT_TEXT_ELEMENT,
      startTime: editor.playback.getCurrentTime()
    })
    editor.timeline.insertElement({ element, placement: { mode: 'auto', trackType: 'text' } })
  }
  return (
    <div className="flex h-full items-start justify-center p-4">
      <button
        type="button"
        className="group w-32 rounded-lg border bg-muted/30 p-2 text-left hover:bg-accent"
        onClick={add}
      >
        <div className="flex aspect-square items-center justify-center rounded bg-muted text-xs text-muted-foreground">
          默认文字
        </div>
        <span className="mt-1 block truncate text-[11px]">默认文字</span>
        <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Plus className="size-3" /> 添加到时间线
        </span>
      </button>
    </div>
  )
}

function OnlineTextTemplatesView() {
  const [catalog, setCatalog] = useState<TextTemplateCatalog | null>(null)
  const [items, setItems] = useState<CatalogItem[]>([])
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [usingBundledCatalog, setUsingBundledCatalog] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const editor = useEditor()

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const timeout = new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error('在线目录加载超时')), 3500)
    )
    void Promise.all([
      Promise.race([
        fetchTextTemplateResource(CATALOG_URL).then(
          (bytes) => JSON.parse(new TextDecoder().decode(bytes)) as TextTemplateCatalog
        ),
        timeout
      ]),
      listDownloadedTextTemplates()
    ])
      .then(([remoteCatalog, cached]) => {
        if (controller.signal.aborted) return
        const validCatalog = Array.isArray(remoteCatalog.items) && remoteCatalog.items.length > 0
        const nextCatalog = validCatalog ? remoteCatalog : fallbackCatalog()
        setCatalog(nextCatalog)
        setItems(nextCatalog.items || [])
        setUsingBundledCatalog(!validCatalog)
        setDownloaded(new Set(cached.map((item) => item.id)))
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setCatalog(fallbackCatalog())
        setItems(fallbackCatalog().items || [])
        setUsingBundledCatalog(true)
        setDownloaded(new Set())
        setError(reason instanceof Error ? reason.message : '在线文字模板加载失败')
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

  async function download(item: CatalogItem): Promise<void> {
    if (!catalog || downloadingId) return
    setDownloadingId(item.id)
    try {
      let bytes: Uint8Array
      if (item.bundled) {
        const bundled = bundledBytes(item.id)
        if (!bundled) throw new Error('内置文字模板不存在')
        bytes = bundled
      } else {
        bytes = await fetchTextTemplateResource(buildDownloadUrl(item, catalog))
      }
      const actualHash = await sha256(bytes)
      if (item.sha256 && actualHash !== item.sha256)
        throw new Error('文字模板文件校验失败，请更新魔搭目录清单后重试')
      const metadata: EditingTextTemplateMetadata = {
        id: item.id,
        name: item.name,
        displayNameZh: displayName(item),
        category: item.category,
        categoryLabel: item.categoryLabel,
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
      toast.error(reason instanceof Error ? reason.message : '文字模板下载失败')
    } finally {
      setDownloadingId(null)
    }
  }

  async function addToTimeline(item: CatalogItem): Promise<void> {
    if (!downloaded.has(item.id)) {
      toast.info('请先下载这个文字模板')
      return
    }
    try {
      const cached = await readDownloadedTextTemplate(item.id)
      if (!cached) throw new Error('已下载模板不存在，请重新下载')
      const definition = JSON.parse(
        new TextDecoder().decode(cached.bytes)
      ) as EditingTextTemplateDefinition
      if (definition.schemaVersion !== 1 || !definition.animation)
        throw new Error('文字模板格式暂不支持')
      const style = definition.style || {}
      const base = buildTextElement({
        raw: {
          ...DEFAULT_TEXT_ELEMENT,
          name: displayName(item),
          content: '输入文字',
          ...style
        } as any,
        startTime: editor.playback.getCurrentTime()
      }) as any
      const element = {
        ...base,
        textTemplate: {
          id: definition.id,
          name: definition.displayNameZh,
          schemaVersion: definition.schemaVersion,
          animation: definition.animation
        }
      }
      editor.timeline.insertElement({
        element,
        placement: { mode: 'auto', trackType: 'text' }
      })
      toast.success(`${displayName(item)} 已添加到时间线`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '文字模板应用失败')
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">文字模板</h3>
            <span className="text-[10px] text-muted-foreground">Motion Canvas reference</span>
            {!loading && (
              <span className="text-[10px] text-muted-foreground">{items.length} 个</span>
            )}
          </div>
          <button
            type="button"
            aria-label="刷新文字模板"
            title="刷新文字模板"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setReloadToken((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          </button>
        </div>
        {usingBundledCatalog && (
          <div className="text-[10px] text-muted-foreground">
            在线目录暂不可用，当前显示开发内置目录；上传 ModelScope 后会自动切换。
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-[108px] shrink-0 overflow-y-auto border-r bg-muted/20 px-2 py-3">
          <div className="mb-2 px-2 text-[10px] font-semibold text-muted-foreground">模板分类</div>
          <nav className="space-y-0.5" aria-label="文字模板分类">
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
              正在加载文字模板…
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              暂无文字模板
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
                    <TemplatePreview item={item} />
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
          {error && !usingBundledCatalog && (
            <div className="mt-2 text-[10px] text-destructive">{error}</div>
          )}
        </div>
      </div>
    </section>
  )
}
