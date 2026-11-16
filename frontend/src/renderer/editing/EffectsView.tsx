import { useEffect, useMemo, useState } from 'react'
import { CloudDownload, LoaderCircle, RefreshCw, Search, Trash2, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@/hooks/use-editor'
import { clearDragData, setDragData } from '@/lib/drag-data'
import type { EditingEffectMetadata } from '../../shared/editing'
import {
  fetchEffectResource,
  listDownloadedEffects,
  removeDownloadedEffect,
  saveDownloadedEffect
} from './adapters/effect-cache'
import { buildEffectDownloadUrl, EFFECT_CATALOG_URL, parseEffectCatalog } from './effect-catalog'
import type { EffectCatalog, EffectCatalogItem } from './effect-catalog'
import { createClipEffect, upsertClipEffect } from './clip-effects'
import previewImage from './assets/transition-preview-1.jpg'

type LibraryMode = 'all' | 'downloaded'

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function engineLabel(engine: string): string {
  return (
    {
      'pixi-filter': 'PixiJS',
      kampos: 'Kampos',
      'seriously-js': 'Seriously.js'
    }[engine] || engine
  )
}

function EffectPreview({ item, index }: { item: EffectCatalogItem; index: number }) {
  return (
    <div
      className="effect-preview"
      data-category={item.category}
      style={{ '--effect-delay': `${(index % 7) * -0.37}s` } as React.CSSProperties}
      aria-hidden="true"
    >
      <img
        className="effect-preview-base"
        src={previewImage}
        alt=""
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
      />
      <img
        className="effect-preview-ghost"
        src={previewImage}
        alt=""
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
      />
      <span className="effect-preview-lines" />
      <span className="effect-preview-category">{item.categoryLabel}</span>
    </div>
  )
}

export function EffectsView() {
  const editor = useEditor()
  const [catalog, setCatalog] = useState<EffectCatalog | null>(null)
  const [downloaded, setDownloaded] = useState<Map<string, EditingEffectMetadata>>(new Map())
  const [mode, setMode] = useState<LibraryMode>('all')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void Promise.all([fetchEffectResource(EFFECT_CATALOG_URL), listDownloadedEffects()])
      .then(([bytes, localItems]) => {
        if (!active) return
        let value: unknown
        try {
          value = JSON.parse(new TextDecoder().decode(bytes))
        } catch {
          throw new Error('在线特效目录不是有效的 JSON 文件')
        }
        const nextCatalog = parseEffectCatalog(value)
        setCatalog(nextCatalog)
        setDownloaded(new Map(localItems.map((item) => [item.id, item])))
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : '在线特效目录加载失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [reloadToken])

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const exactDownloaded = useMemo(() => {
    const result = new Set<string>()
    for (const item of catalog?.items || []) {
      if (downloaded.get(item.id)?.sha256 === item.sha256) result.add(item.id)
    }
    return result
  }, [catalog, downloaded])

  const modeItems = useMemo(
    () =>
      (catalog?.items || []).filter((item) => {
        if (mode === 'downloaded' && !exactDownloaded.has(item.id)) return false
        if (!normalizedSearch) return true
        return `${item.displayNameZh} ${item.name} ${item.categoryLabel} ${item.tags.join(' ')} ${item.runtime.engine} ${item.source.provider}`
          .toLocaleLowerCase()
          .includes(normalizedSearch)
      }),
    [catalog, exactDownloaded, mode, normalizedSearch]
  )

  const visibleItems = useMemo(
    () => modeItems.filter((item) => category === 'all' || item.category === category),
    [category, modeItems]
  )

  async function download(item: EffectCatalogItem): Promise<void> {
    if (!catalog || downloadingId || removingId) return
    setDownloadingId(item.id)
    try {
      const sourceUrl = buildEffectDownloadUrl(item, catalog)
      const bytes = await fetchEffectResource(sourceUrl)
      if (bytes.byteLength !== item.sizeBytes) throw new Error('特效包大小与目录清单不一致')
      const actualHash = await sha256(bytes)
      if (actualHash !== item.sha256) throw new Error('特效包校验失败，请刷新目录后重试')
      const metadata: EditingEffectMetadata = {
        id: item.id,
        name: item.name,
        displayNameZh: item.displayNameZh,
        category: item.category,
        categoryLabel: item.categoryLabel,
        tags: item.tags,
        classification: 'effect',
        runtime: item.runtime,
        source: item.source,
        sourceUrl,
        remotePath: item.file,
        sha256: item.sha256,
        sizeBytes: item.sizeBytes,
        downloadedAt: new Date().toISOString()
      }
      await saveDownloadedEffect(metadata, bytes)
      setDownloaded((current) => new Map(current).set(item.id, metadata))
      toast.success(`${item.displayNameZh} 已下载`)
    } catch (reason) {
      toast.error('特效下载失败', {
        description: reason instanceof Error ? reason.message : String(reason)
      })
    } finally {
      setDownloadingId(null)
    }
  }

  async function remove(item: EffectCatalogItem): Promise<void> {
    if (downloadingId || removingId) return
    setRemovingId(item.id)
    try {
      await removeDownloadedEffect(item.id)
      setDownloaded((current) => {
        const next = new Map(current)
        next.delete(item.id)
        return next
      })
      toast.success(`${item.displayNameZh} 的本地缓存已删除`)
    } catch (reason) {
      toast.error('删除特效缓存失败', {
        description: reason instanceof Error ? reason.message : String(reason)
      })
    } finally {
      setRemovingId(null)
    }
  }

  function clipEffectFromCatalog(item: EffectCatalogItem) {
    return createClipEffect({
      id: item.id,
      name: item.displayNameZh,
      category: item.category,
      engine: item.runtime.engine
    })
  }

  function applyToSelected(item: EffectCatalogItem): void {
    const selected = editor.timeline
      .getElementsWithTracks({ elements: editor.selection.getSelectedElements() })
      .filter(({ element }) => element.type === 'video' || element.type === 'image')

    if (!selected.length) {
      toast.info('请先在时间线选择视频、图片或调节层')
      return
    }

    const effect = clipEffectFromCatalog(item)
    editor.timeline.updateElements({
      updates: selected.map(({ track, element }) => ({
        trackId: track.id,
        elementId: element.id,
        updates: {
          effects: upsertClipEffect(
            (element as typeof element & { effects?: unknown }).effects,
            effect
          )
        }
      }))
    })
    toast.success(
      selected.length === 1
        ? `${item.displayNameZh} 已应用到所选内容`
        : `${item.displayNameZh} 已应用到 ${selected.length} 个所选内容`
    )
  }

  function startEffectDrag(event: React.DragEvent<HTMLElement>, item: EffectCatalogItem): void {
    if (!exactDownloaded.has(item.id) || (event.target as HTMLElement).closest('button')) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'copy'
    setDragData({
      dataTransfer: event.dataTransfer,
      dragData: {
        type: 'effect',
        id: item.id,
        name: item.displayNameZh,
        effect: clipEffectFromCatalog(item)
      } as never
    })
  }

  return (
    <div className="effects-library">
      <header className="effects-toolbar">
        <div className="effects-heading-row">
          <div className="effects-heading">
            <WandSparkles size={15} />
            <strong>在线特效</strong>
            {!loading && !error && <span>{catalog?.items.length || 0}</span>}
          </div>
          <button
            type="button"
            className="effects-icon-button"
            aria-label="刷新特效目录"
            title="刷新特效目录"
            onClick={() => setReloadToken((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'spin' : ''} size={15} />
          </button>
        </div>
        <div className="effects-controls-row">
          <div className="effects-mode-tabs" role="tablist" aria-label="特效资源范围">
            <button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>
              全部
            </button>
            <button
              className={mode === 'downloaded' ? 'active' : ''}
              onClick={() => setMode('downloaded')}
            >
              已下载 <span>{exactDownloaded.size}</span>
            </button>
          </div>
          <label className="effects-search">
            <Search size={13} />
            <input
              aria-label="搜索特效"
              placeholder="搜索特效"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
      </header>

      <div className="effects-content">
        <aside className="effects-categories" aria-label="特效分类">
          <button
            type="button"
            className={category === 'all' ? 'active' : ''}
            onClick={() => setCategory('all')}
          >
            <span>全部</span>
            <small>{modeItems.length}</small>
          </button>
          {(catalog?.categories || []).map((item) => {
            const count = modeItems.filter((effect) => effect.category === item.id).length
            return (
              <button
                type="button"
                key={item.id}
                className={category === item.id ? 'active' : ''}
                onClick={() => setCategory(item.id)}
                title={item.label}
              >
                <span>{item.label}</span>
                <small>{count}</small>
              </button>
            )
          })}
        </aside>

        <section className="effects-results">
          <div className="effects-results-summary">
            <strong>
              {category === 'all'
                ? mode === 'downloaded'
                  ? '已下载'
                  : '全部特效'
                : catalog?.categories.find((item) => item.id === category)?.label || '特效'}
            </strong>
            <span>{visibleItems.length} 个</span>
          </div>
          <div className="effects-results-scroll">
            {loading ? (
              <div className="effects-status">
                <LoaderCircle className="spin" size={22} />
                <span>正在读取特效目录…</span>
              </div>
            ) : error ? (
              <div className="effects-status error" role="alert">
                <p>{error}</p>
                <button type="button" onClick={() => setReloadToken((value) => value + 1)}>
                  <RefreshCw size={14} /> 重试
                </button>
              </div>
            ) : visibleItems.length ? (
              <div className="effects-grid">
                {visibleItems.map((item, index) => {
                  const local = downloaded.get(item.id)
                  const isDownloaded = exactDownloaded.has(item.id)
                  const isDownloading = downloadingId === item.id
                  const isRemoving = removingId === item.id
                  return (
                    <article
                      className={`effect-card ${isDownloaded ? 'is-draggable' : ''}`}
                      key={item.id}
                      draggable={isDownloaded}
                      onDragStart={(event) => startEffectDrag(event, item)}
                      onDragEnd={() => clearDragData()}
                      title={isDownloaded ? '拖到时间线片段或调节层上应用特效' : undefined}
                    >
                      <EffectPreview item={item} index={index} />
                      <div className="effect-card-copy">
                        <strong title={item.displayNameZh}>{item.displayNameZh}</strong>
                        <span title={`${item.source.provider} · ${item.runtime.engine}`}>
                          {engineLabel(item.runtime.engine)} · {formatSize(item.sizeBytes)}
                        </span>
                      </div>
                      <div className="effect-card-actions">
                        <button
                          type="button"
                          className={isDownloaded ? 'is-downloaded' : ''}
                          disabled={Boolean(downloadingId) || Boolean(removingId)}
                          onClick={() =>
                            isDownloaded ? applyToSelected(item) : void download(item)
                          }
                          title={
                            isDownloaded
                              ? '应用到时间线中选中的片段或调节层'
                              : local
                                ? '更新特效包'
                                : '下载特效包'
                          }
                        >
                          {isDownloading ? (
                            <LoaderCircle className="spin" size={13} />
                          ) : isDownloaded ? (
                            <WandSparkles size={13} />
                          ) : (
                            <CloudDownload size={13} />
                          )}
                          <span>
                            {isDownloading
                              ? '下载中'
                              : isDownloaded
                                ? '应用'
                                : local
                                  ? '更新'
                                  : '下载'}
                          </span>
                        </button>
                        {local && (
                          <button
                            type="button"
                            className="effect-remove-button"
                            aria-label={`删除 ${item.displayNameZh} 的本地缓存`}
                            title="删除本地缓存"
                            disabled={Boolean(downloadingId) || Boolean(removingId)}
                            onClick={() => void remove(item)}
                          >
                            {isRemoving ? (
                              <LoaderCircle className="spin" size={13} />
                            ) : (
                              <Trash2 size={13} />
                            )}
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="effects-status">
                <WandSparkles size={24} />
                <span>{mode === 'downloaded' ? '还没有下载特效' : '没有找到匹配的特效'}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
