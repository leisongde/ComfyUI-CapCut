import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CloudDownload,
  Headphones,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Star
} from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@/hooks/use-editor'
import { processMediaAssets } from '@/lib/media/processing'
import { clearDragData, setDragData } from '@/lib/drag-data'
import type { MediaAsset } from '@/types/assets'
import type { EditingAudioMetadata } from '../../shared/editing'
import {
  AUDIO_CATALOG_URL,
  AUDIO_INVENTORY_URL,
  buildAudioDownloadUrl,
  parseAudioCatalog,
  reconcileAudioCatalog
} from './adapters/audio-catalog'
import type { AudioCatalog, AudioCatalogItem } from './adapters/audio-catalog'
import { displayAudioName } from './adapters/audio-name-zh'
import {
  fetchAudioResource,
  listDownloadedAudio,
  readDownloadedAudio,
  saveDownloadedAudio
} from './adapters/audio-cache'

const FAVORITES_KEY = 'editing-audio-favorites-v1'

type AudioTab = 'favorites' | 'effects' | 'music'

function readFavorites(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')
    return new Set(Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function readProjectAssetMap(projectId: string): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(`editing-audio-assets-${projectId}`) || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function formatDuration(duration?: number): string {
  if (!duration || !Number.isFinite(duration)) return '--:--'
  const seconds = Math.max(0, Math.round(duration))
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function AudioView() {
  const editor = useEditor()
  const projectId = editor.project.getActive().metadata.id
  const [tab, setTab] = useState<AudioTab>('effects')
  const [catalog, setCatalog] = useState<AudioCatalog | null>(null)
  const [items, setItems] = useState<AudioCatalogItem[]>([])
  const [availability, setAvailability] = useState<{ available: number; total: number } | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [category, setCategory] = useState('casino-audio')
  const [search, setSearch] = useState('')
  const [visibleLimit, setVisibleLimit] = useState(80)
  const [favorites, setFavorites] = useState<Set<string>>(readFavorites)
  const [downloaded, setDownloaded] = useState<Map<string, EditingAudioMetadata>>(new Map())
  const [assetIds, setAssetIds] = useState<Map<string, string>>(new Map())
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [preparing, setPreparing] = useState<Set<string>>(new Set())
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null)
  const [durations, setDurations] = useState<Map<string, number>>(new Map())
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const previewTokenRef = useRef(0)
  const assetMapRef = useRef(readProjectAssetMap(projectId))
  const prepareTasks = useRef(new Map<string, Promise<string>>())

  const rememberAsset = useCallback(
    (audioId: string, mediaId: string) => {
      assetMapRef.current = { ...assetMapRef.current, [audioId]: mediaId }
      localStorage.setItem(`editing-audio-assets-${projectId}`, JSON.stringify(assetMapRef.current))
      setAssetIds((current) => new Map(current).set(audioId, mediaId))
    },
    [projectId]
  )

  const addProcessedAsset = useCallback(
    async (item: AudioCatalogItem, asset: Omit<MediaAsset, 'id'>): Promise<string> => {
      const existingId = assetMapRef.current[item.id]
      if (existingId && editor.media.getAssets().some((media) => media.id === existingId)) {
        setAssetIds((current) => new Map(current).set(item.id, existingId))
        return existingId
      }
      const mediaId = await editor.media.addMediaAsset({
        projectId,
        asset: { ...asset, name: displayAudioName(item) }
      })
      if (!editor.media.getAssets().some((media) => media.id === mediaId))
        throw new Error('音频未能写入当前剪辑工程')
      rememberAsset(item.id, mediaId)
      return mediaId
    },
    [editor.media, projectId, rememberAsset]
  )

  const prepareProjectAsset = useCallback(
    (item: AudioCatalogItem): Promise<string> => {
      const existingTask = prepareTasks.current.get(item.id)
      if (existingTask) return existingTask
      const task = (async () => {
        const existingId = assetMapRef.current[item.id]
        if (existingId && editor.media.getAssets().some((media) => media.id === existingId)) {
          setAssetIds((current) => new Map(current).set(item.id, existingId))
          return existingId
        }
        setPreparing((current) => new Set(current).add(item.id))
        const cached = await readDownloadedAudio(item.id)
        if (!cached) throw new Error('已下载音频不存在，请重新下载')
        const file = new File([new Uint8Array(cached.bytes)], `${item.id}.ogg`, {
          type: cached.metadata.mimeType || item.mimeType || 'audio/ogg'
        })
        const [processed] = await processMediaAssets({ files: [file] })
        if (!processed) throw new Error('音频格式暂时无法识别')
        if (processed.duration)
          setDurations((current) => new Map(current).set(item.id, processed.duration!))
        return addProcessedAsset(item, processed)
      })().finally(() => {
        prepareTasks.current.delete(item.id)
        setPreparing((current) => {
          const next = new Set(current)
          next.delete(item.id)
          return next
        })
      })
      prepareTasks.current.set(item.id, task)
      return task
    },
    [addProcessedAsset, editor.media]
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void Promise.all([
      fetchAudioResource(AUDIO_CATALOG_URL).then(({ bytes }) => parseAudioCatalog(bytes)),
      listDownloadedAudio(),
      fetchAudioResource(AUDIO_INVENTORY_URL)
        .then(({ bytes }) => bytes)
        .catch((failure) => {
          console.warn('Failed to read the online audio inventory', failure)
          return null
        })
    ])
      .then(([sourceCatalog, cached, inventoryBytes]) => {
        if (controller.signal.aborted) return
        const cachedIds = new Set(cached.map((item) => item.id))
        const reconciled = inventoryBytes
          ? reconcileAudioCatalog(sourceCatalog, inventoryBytes, cachedIds)
          : {
              catalog: sourceCatalog,
              items: sourceCatalog.items || [],
              availableCount: sourceCatalog.items?.length || 0,
              totalCount: sourceCatalog.items?.length || 0
            }
        const nextCatalog = reconciled.catalog
        setCatalog(nextCatalog)
        setItems(reconciled.items)
        setAvailability(
          inventoryBytes
            ? { available: reconciled.availableCount, total: reconciled.totalCount }
            : null
        )
        setDownloaded(new Map(cached.map((item) => [item.id, item])))
        setDurations(
          new Map(
            cached
              .filter((item) => Number.isFinite(item.duration))
              .map((item) => [item.id, item.duration!] as const)
          )
        )
        const catalogById = new Map((sourceCatalog.items || []).map((item) => [item.id, item]))
        for (const metadata of cached) {
          const item = catalogById.get(metadata.id)
          if (item)
            void prepareProjectAsset(item).catch((failure) =>
              console.warn('Failed to prepare cached audio', item.id, failure)
            )
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError((failure as Error).message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [prepareProjectAsset, reloadToken])

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]))
  }, [favorites])

  useEffect(
    () => () => {
      previewTokenRef.current += 1
      audioRef.current?.pause()
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    []
  )

  const toggleFavorite = (id: string) => {
    setFavorites((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const play = async (item: AudioCatalogItem) => {
    if (playingId === item.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    const previewToken = ++previewTokenRef.current
    setPreviewLoadingId(item.id)
    audioRef.current?.pause()
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    try {
      let audioBytes: Uint8Array
      let mimeType = item.mimeType || 'audio/ogg'
      if (downloaded.has(item.id)) {
        const cached = await readDownloadedAudio(item.id)
        if (cached) {
          audioBytes = new Uint8Array(cached.bytes)
          mimeType = cached.metadata.mimeType
        } else {
          const result = await fetchAudioResource(
            catalog ? buildAudioDownloadUrl(item) : item.downloadUrl || ''
          )
          audioBytes = result.bytes
          mimeType = result.mimeType || mimeType
        }
      } else {
        const result = await fetchAudioResource(
          catalog ? buildAudioDownloadUrl(item) : item.downloadUrl || ''
        )
        audioBytes = result.bytes
        mimeType = result.mimeType || mimeType
      }
      if (previewToken !== previewTokenRef.current) return
      const blobBytes = new Uint8Array(audioBytes.byteLength)
      blobBytes.set(audioBytes)
      const source = URL.createObjectURL(new Blob([blobBytes.buffer], { type: mimeType }))
      previewUrlRef.current = source
      const audio = new Audio(source)
      audio.preload = 'metadata'
      audio.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(audio.duration))
          setDurations((current) => new Map(current).set(item.id, audio.duration))
      })
      audio.addEventListener('ended', () => setPlayingId(null))
      audio.addEventListener('error', () => {
        setPlayingId(null)
        toast.error('音频试听失败，请检查网络后重试')
      })
      audioRef.current = audio
      setPlayingId(item.id)
      await audio.play()
    } catch (failure) {
      setPlayingId(null)
      toast.error('音频试听失败', { description: (failure as Error).message })
    } finally {
      if (previewToken === previewTokenRef.current) setPreviewLoadingId(null)
    }
  }

  const download = async (item: AudioCatalogItem) => {
    if (downloaded.has(item.id)) {
      try {
        await prepareProjectAsset(item)
      } catch (failure) {
        toast.error('音频未能加入当前工程', { description: (failure as Error).message })
      }
      return
    }
    if (!catalog || downloadingId) return
    setDownloadingId(item.id)
    try {
      const { bytes, mimeType } = await fetchAudioResource(buildAudioDownloadUrl(item))
      if (bytes.byteLength !== item.sizeBytes) throw new Error('下载的音频大小与目录不一致')
      if ((await sha256(bytes)) !== item.sha256) throw new Error('音频校验失败，请重新下载')
      const file = new File([new Uint8Array(bytes)], `${item.id}.ogg`, {
        type: item.mimeType || mimeType || 'audio/ogg'
      })
      const [processed] = await processMediaAssets({ files: [file] })
      if (!processed) throw new Error('音频格式暂时无法识别')
      const metadata: EditingAudioMetadata = {
        id: item.id,
        name: displayAudioName(item),
        category: item.category,
        categoryLabel: item.categoryLabel,
        sourceUrl: item.sourceUrl,
        remotePath: item.remotePath,
        sha256: item.sha256,
        sizeBytes: item.sizeBytes,
        mimeType: item.mimeType || mimeType || 'audio/ogg',
        license: item.license,
        author: item.author,
        duration: processed.duration,
        downloadedAt: new Date().toISOString()
      }
      await saveDownloadedAudio(metadata, bytes)
      setDownloaded((current) => new Map(current).set(item.id, metadata))
      if (processed.duration)
        setDurations((current) => new Map(current).set(item.id, processed.duration!))
      await addProcessedAsset(item, processed)
      toast.success('音频已下载，可以拖入音频轨道')
    } catch (failure) {
      toast.error('音频下载失败', { description: (failure as Error).message })
    } finally {
      setDownloadingId(null)
    }
  }

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredItems = useMemo(() => {
    const source = tab === 'favorites' ? items.filter((item) => favorites.has(item.id)) : items
    return source.filter(
      (item) =>
        (tab !== 'effects' || category === 'all' || item.category === category) &&
        (!normalizedSearch ||
          `${item.name} ${displayAudioName(item)} ${(item.tags || []).join(' ')}`
            .toLocaleLowerCase()
            .includes(normalizedSearch))
    )
  }, [category, favorites, items, normalizedSearch, tab])

  useEffect(() => setVisibleLimit(80), [category, normalizedSearch, tab])

  const renderItems = (visibleItems: AudioCatalogItem[]) => (
    <div className="audio-item-grid">
      {visibleItems.map((item) => {
        const isDownloaded = downloaded.has(item.id)
        const mediaId = assetIds.get(item.id)
        const isPreparing = preparing.has(item.id)
        const isDownloading = downloadingId === item.id
        const ready = Boolean(isDownloaded && mediaId && !isPreparing)
        const name = displayAudioName(item)
        return (
          <div
            className={`audio-item ${ready ? 'is-ready' : ''}`}
            key={item.id}
            draggable={ready}
            title={ready ? '已下载，可拖入音频轨道' : undefined}
            onDragStart={(event) => {
              if (!ready || !mediaId) {
                event.preventDefault()
                return
              }
              setDragData({
                dataTransfer: event.dataTransfer,
                dragData: { id: mediaId, name, type: 'media', mediaType: 'audio' }
              })
              event.dataTransfer.effectAllowed = 'copy'
            }}
            onDragEnd={() => clearDragData()}
          >
            <button
              type="button"
              className="audio-preview-button"
              aria-label={playingId === item.id ? `暂停 ${name}` : `试听 ${name}`}
              title={playingId === item.id ? '暂停' : '试听'}
              draggable={false}
              onClick={() => void play(item)}
              disabled={previewLoadingId === item.id}
            >
              {previewLoadingId === item.id ? (
                <LoaderCircle className="spin" size={16} />
              ) : playingId === item.id ? (
                <Pause size={16} />
              ) : (
                <Play size={16} />
              )}
              <span className="audio-wave" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
            </button>
            <div className="audio-item-copy">
              <strong title={name}>{name}</strong>
              <span>
                {item.author} · {formatDuration(durations.get(item.id))} ·{' '}
                {formatSize(item.sizeBytes)}
              </span>
            </div>
            <button
              type="button"
              className={`audio-icon-button ${favorites.has(item.id) ? 'is-favorite' : ''}`}
              aria-label={favorites.has(item.id) ? `取消收藏 ${name}` : `收藏 ${name}`}
              title={favorites.has(item.id) ? '取消收藏' : '收藏'}
              draggable={false}
              onClick={() => toggleFavorite(item.id)}
            >
              <Star size={15} fill={favorites.has(item.id) ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              className={`audio-icon-button ${ready ? 'is-downloaded' : ''}`}
              aria-label={isDownloaded ? `准备 ${name}` : `下载 ${name}`}
              title={ready ? '已下载，可拖入时间线' : isDownloaded ? '点击重试准备' : '下载'}
              draggable={false}
              disabled={isDownloading || isPreparing}
              onClick={() => void download(item)}
            >
              {isDownloading || isPreparing ? (
                <LoaderCircle className="spin" size={15} />
              ) : ready ? (
                <Check size={15} />
              ) : (
                <CloudDownload size={15} />
              )}
            </button>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="audio-library">
      <div className="audio-library-tabs" role="tablist" aria-label="音频库">
        <button className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}>
          <Star size={14} /> 收藏
          {favorites.size > 0 && <span>{favorites.size}</span>}
        </button>
        <button className={tab === 'effects' ? 'active' : ''} onClick={() => setTab('effects')}>
          <Headphones size={14} /> 效果音
        </button>
        <button className={tab === 'music' ? 'active' : ''} onClick={() => setTab('music')}>
          <Music2 size={14} /> 音乐库
        </button>
      </div>

      {tab === 'music' ? (
        <div className="audio-empty-state">
          <Music2 size={30} />
          <strong>音乐库</strong>
          <p>AI 无版权音乐将在这里接入</p>
        </div>
      ) : (
        <div className="audio-content">
          {tab === 'effects' && (
            <aside className="audio-categories" aria-label="效果音分类">
              <button
                className={category === 'all' ? 'active' : ''}
                onClick={() => setCategory('all')}
              >
                <span>全部</span>
                <small>{items.length}</small>
              </button>
              {(catalog?.categories || []).map((item) => (
                <button
                  key={item.id}
                  className={category === item.id ? 'active' : ''}
                  onClick={() => setCategory(item.id)}
                  title={item.label}
                >
                  <span>{item.label}</span>
                  <small>{item.count}</small>
                </button>
              ))}
            </aside>
          )}
          <section className="audio-results">
            {availability && availability.available < availability.total && (
              <div className="audio-sync-notice" role="status">
                <CloudDownload size={13} />
                <span>
                  在线素材正在同步，当前可用 <strong>{availability.available}</strong> /{' '}
                  {availability.total}
                </span>
              </div>
            )}
            <div className="audio-search-row">
              <label className="audio-search">
                <Search size={14} />
                <input
                  aria-label="搜索音频"
                  placeholder="搜索音效"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <span>{filteredItems.length} 个</span>
            </div>
            <div className="audio-results-scroll">
              {loading ? (
                <div className="audio-status">正在读取在线音频库…</div>
              ) : error ? (
                <div className="audio-status error" role="alert">
                  <p>{error}</p>
                  <button onClick={() => setReloadToken((value) => value + 1)}>
                    <RefreshCw size={14} /> 重试
                  </button>
                </div>
              ) : filteredItems.length ? (
                <>
                  {renderItems(filteredItems.slice(0, visibleLimit))}
                  {filteredItems.length > visibleLimit && (
                    <button
                      type="button"
                      className="audio-load-more"
                      onClick={() => setVisibleLimit((value) => value + 80)}
                    >
                      显示更多（剩余 {filteredItems.length - visibleLimit} 个）
                    </button>
                  )}
                </>
              ) : (
                <div className="audio-status">
                  <Star size={24} />
                  <p>{tab === 'favorites' ? '还没有收藏音效' : '没有找到匹配的音效'}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
