import { useMemo, useRef, useState } from 'react'
import { Box, Grid2X2, Image, Layers3, LoaderCircle, Palette, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@/hooks/use-editor'
import { clearDragData, setDragData } from '@/lib/drag-data'
import { buildStickerElement } from '@/lib/timeline/element-utils'
import type { CreateStickerElement } from '@/types/timeline'
import { getDefaultStickerTrackIndex } from '../adapters/sticker-track-drop'
import { buildStickerUrl, getStickerItems, searchStickerItems } from './library'
import type { StickerAsset, StickerCategory } from './library'
import { prepareStickerAsset } from './runtime'

const PAGE_SIZE = 60
const RECENT_KEY = 'editing-recent-stickers-v2'

const CATEGORIES: Array<{
  id: StickerCategory
  label: string
  icon: typeof Grid2X2
}> = [
  { id: 'all', label: '全部', icon: Grid2X2 },
  { id: 'three-d', label: '3D', icon: Box },
  { id: 'color', label: '彩色', icon: Palette },
  { id: 'flat', label: '扁平', icon: Layers3 },
  { id: 'illustration', label: '插画', icon: Image }
]

function readRecentIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 12) : []
  } catch {
    return []
  }
}

type DownloadedStickerElement = CreateStickerElement & {
  sourceUrl: string
  sourceRemoteUrl: string
  sourceMimeType: string
}

export function StickersView() {
  const editor = useEditor()
  const [category, setCategory] = useState<StickerCategory>('all')
  const [search, setSearch] = useState('')
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [recentIds, setRecentIds] = useState(readRecentIds)

  const categoryItems = useMemo(() => getStickerItems(category), [category])
  const filteredItems = useMemo(
    () => searchStickerItems(categoryItems, search),
    [categoryItems, search]
  )
  const visibleItems = filteredItems.slice(0, visibleLimit)
  const allItems = useMemo(() => getStickerItems('all'), [])
  const itemsById = useMemo(() => new Map(allItems.map((item) => [item.id, item])), [allItems])
  const recentItems = recentIds
    .map((id) => itemsById.get(id))
    .filter((item): item is StickerAsset => Boolean(item))

  const changeCategory = (next: StickerCategory) => {
    setCategory(next)
    setVisibleLimit(PAGE_SIZE)
  }

  const addSticker = async (item: StickerAsset) => {
    if (downloadingId) return
    setDownloadingId(item.id)
    try {
      const downloaded = await prepareStickerAsset(item)
      const tracks = editor.timeline.getTracks()
      const stickerTrack = tracks.find((track) => track.type === 'sticker')
      const trackId =
        stickerTrack?.id ||
        editor.timeline.addTrack({
          type: 'sticker',
          index: getDefaultStickerTrackIndex(tracks)
        })
      const element = buildStickerElement({
        iconName: item.id,
        startTime: editor.playback.getCurrentTime()
      }) as DownloadedStickerElement
      element.name = item.name
      element.sourceUrl = downloaded.dataUrl
      element.sourceRemoteUrl = downloaded.sourceUrl
      element.sourceMimeType = downloaded.mimeType
      editor.timeline.insertElement({
        placement: { mode: 'explicit', trackId },
        element
      })
      const nextRecent = [item.id, ...recentIds.filter((id) => id !== item.id)].slice(0, 12)
      setRecentIds(nextRecent)
      localStorage.setItem(RECENT_KEY, JSON.stringify(nextRecent))
      toast.success('贴纸已下载并添加到时间线')
    } catch (error) {
      console.error('Failed to download sticker', error)
      toast.error(error instanceof Error ? error.message : '贴纸下载失败')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="sticker-library">
      <div className="sticker-categories" role="tablist" aria-label="贴纸分类">
        {CATEGORIES.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={category === entry.id}
              className={category === entry.id ? 'active' : ''}
              onClick={() => changeCategory(entry.id)}
            >
              <Icon size={13} />
              <span>{entry.label}</span>
            </button>
          )
        })}
      </div>

      <div className="sticker-toolbar">
        <label className="sticker-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setVisibleLimit(PAGE_SIZE)
            }}
            placeholder="搜索贴纸"
            aria-label="搜索贴纸"
          />
        </label>
        <span>
          {search
            ? `${filteredItems.length.toLocaleString()} 个结果`
            : `${categoryItems.length.toLocaleString()} 个`}
        </span>
      </div>

      <div className="sticker-scroll">
        {!search && category === 'all' && recentItems.length > 0 && (
          <StickerSection
            title="最近使用"
            items={recentItems}
            downloadingId={downloadingId}
            onAdd={addSticker}
          />
        )}
        {visibleItems.length > 0 ? (
          <StickerSection
            title={
              search ? '搜索结果' : CATEGORIES.find((item) => item.id === category)?.label || '全部'
            }
            items={visibleItems}
            downloadingId={downloadingId}
            onAdd={addSticker}
          />
        ) : (
          <div className="sticker-empty">
            <Search size={24} />
            <strong>没有找到贴纸</strong>
            <span>换个关键词试试</span>
          </div>
        )}
        {visibleItems.length < filteredItems.length && (
          <button
            type="button"
            className="sticker-load-more"
            onClick={() => setVisibleLimit((current) => current + PAGE_SIZE)}
          >
            加载更多
          </button>
        )}
      </div>
    </div>
  )
}

function StickerSection({
  title,
  items,
  downloadingId,
  onAdd
}: {
  title: string
  items: StickerAsset[]
  downloadingId: string | null
  onAdd: (item: StickerAsset) => Promise<void>
}) {
  const draggedStickerId = useRef<string | null>(null)

  return (
    <section className="sticker-section">
      <h3>{title}</h3>
      <div className="sticker-grid">
        {items.map((item) => {
          const downloading = item.id === downloadingId
          return (
            <button
              key={item.id}
              type="button"
              className="sticker-item"
              draggable={!downloadingId}
              disabled={Boolean(downloadingId)}
              onPointerDown={() => {
                draggedStickerId.current = null
                void prepareStickerAsset(item).catch(() => undefined)
              }}
              onDragStart={(event) => {
                draggedStickerId.current = item.id
                void prepareStickerAsset(item).catch(() => undefined)
                setDragData({
                  dataTransfer: event.dataTransfer,
                  dragData: {
                    id: item.id,
                    name: item.name,
                    type: 'sticker',
                    iconName: item.id
                  }
                })
                event.dataTransfer.effectAllowed = 'copy'
              }}
              onDragEnd={() => {
                clearDragData()
                window.setTimeout(() => {
                  draggedStickerId.current = null
                }, 250)
              }}
              onClick={() => {
                if (draggedStickerId.current === item.id) return
                void onAdd(item)
              }}
              title={`${item.name} · ${item.collectionLabel}\n点击添加，或拖到时间线指定轨道`}
            >
              <img
                src={buildStickerUrl(item.remotePath)}
                alt=""
                aria-hidden="true"
                loading="lazy"
                draggable={false}
              />
              {downloading && (
                <span className="sticker-downloading" aria-label="正在下载">
                  <LoaderCircle size={22} />
                </span>
              )}
              <span className="sr-only">{item.name}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
