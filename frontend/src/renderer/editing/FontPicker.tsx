import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Check, ChevronDown, Download, LoaderCircle, Search } from 'lucide-react'
import { toast } from 'sonner'
import { FONT_OPTIONS, type FontFamily } from '@/constants/font-constants'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/utils/ui'
import { OPEN_SOURCE_FONTS, formatFontSize } from './font-catalog'
import { downloadAndRegisterFont, downloadedFontHashes } from './font-runtime'

type LanguageFilter = 'all' | 'chinese' | 'latin' | 'other'

const FONT_PAGE_SIZE = 80

const LANGUAGE_FILTERS: Array<{ value: LanguageFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'chinese', label: '中文' },
  { value: 'latin', label: '拉丁' },
  { value: 'other', label: '其他' }
]

interface FontPickerProps {
  defaultValue?: FontFamily
  onValueChange?: (value: FontFamily) => void
  className?: string
}

export function FontPicker({
  defaultValue,
  onValueChange,
  className
}: FontPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [downloaded, setDownloaded] = useState<Map<string, string>>(new Map())
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState<LanguageFilter>('all')
  const [visibleCount, setVisibleCount] = useState(FONT_PAGE_SIZE)

  useEffect(() => {
    let active = true
    void downloadedFontHashes()
      .then((hashes) => {
        if (active) setDownloaded(hashes)
      })
      .catch((error) => {
        if (active) toast.error('读取已下载字体失败', { description: (error as Error).message })
      })
    return () => {
      active = false
    }
  }, [])

  const selected = useMemo(
    () =>
      OPEN_SOURCE_FONTS.find((font) => font.family === defaultValue)?.displayNameZh ||
      FONT_OPTIONS.find((font) => font.value === defaultValue)?.label ||
      defaultValue ||
      '选择字体',
    [defaultValue]
  )

  useEffect(() => {
    setVisibleCount(FONT_PAGE_SIZE)
  }, [language, query])

  const matchingFonts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return OPEN_SOURCE_FONTS.filter((font) => {
      if (
        language === 'chinese' &&
        font.language !== 'simplified' &&
        font.language !== 'traditional'
      ) {
        return false
      }
      if ((language === 'latin' || language === 'other') && font.language !== language) {
        return false
      }
      if (!normalizedQuery) return true
      return [font.displayNameZh, font.family, font.description, font.author].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery)
      )
    })
  }, [language, query])

  const visibleFonts = useMemo(
    () => matchingFonts.slice(0, visibleCount),
    [matchingFonts, visibleCount]
  )

  const choose = (family: string): void => {
    onValueChange?.(family as FontFamily)
    setOpen(false)
  }

  const download = async (font: (typeof OPEN_SOURCE_FONTS)[number]): Promise<void> => {
    if (downloadingId) return
    setDownloadingId(font.id)
    try {
      await downloadAndRegisterFont(font)
      setDownloaded((current) => new Map(current).set(font.id, font.sha256))
      choose(font.family)
      toast.success(`${font.displayNameZh} 已下载并应用`)
    } catch (error) {
      toast.error(`${font.displayNameZh} 下载失败`, {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'bg-accent focus:ring-ring flex h-8 w-full items-center justify-between gap-2 rounded-md px-3 text-sm focus:ring-1 focus:outline-hidden',
            className
          )}
          aria-label="选择字体"
        >
          <span className="truncate">{selected}</span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] max-w-[calc(100vw-24px)] p-2">
        <div className="max-h-[420px] overflow-y-auto pr-1">
          <div className="px-2 pb-1 pt-1 text-[10px] font-semibold text-muted-foreground">
            系统字体
          </div>
          <div className="grid grid-cols-2 gap-1">
            {FONT_OPTIONS.map((font) => (
              <button
                type="button"
                key={font.value}
                className="flex h-8 min-w-0 items-center justify-between rounded px-2 text-left text-xs hover:bg-accent"
                style={{ fontFamily: font.value }}
                onClick={() => choose(font.value)}
              >
                <span className="truncate">{font.label}</span>
                {defaultValue === font.value && (
                  <Check className="size-3.5 shrink-0 text-primary" />
                )}
              </button>
            ))}
          </div>

          <div className="my-2 h-px bg-border" />
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-[10px] font-semibold text-muted-foreground">
              开源字体 · {OPEN_SOURCE_FONTS.length} 个家族
            </span>
            <span className="text-[9px] text-muted-foreground">按需下载 · OFL 1.1</span>
          </div>
          <div className="mb-2 space-y-1.5 px-1">
            <label className="bg-accent flex h-8 items-center gap-2 rounded-md px-2">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                className="min-w-0 flex-1 bg-transparent text-xs outline-hidden placeholder:text-muted-foreground"
                placeholder="搜索字体名称"
                aria-label="搜索开源字体"
              />
            </label>
            <div className="grid grid-cols-4 rounded-md bg-muted p-0.5">
              {LANGUAGE_FILTERS.map((filter) => (
                <button
                  type="button"
                  key={filter.value}
                  className={cn(
                    'h-6 rounded text-[10px] transition-colors',
                    language === filter.value
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setLanguage(filter.value)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            {visibleFonts.map((font) => {
              const isDownloaded = downloaded.get(font.id) === font.sha256
              const isDownloading = downloadingId === font.id
              const isSelected = defaultValue === font.family
              return (
                <div
                  key={font.id}
                  className={cn(
                    'flex min-h-[58px] items-center gap-2 rounded-md border border-transparent px-2 py-1.5',
                    isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                    disabled={!isDownloaded}
                    onClick={() => choose(font.family)}
                    title={isDownloaded ? `使用${font.displayNameZh}` : '下载后可使用'}
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className="truncate text-[15px] font-medium"
                        style={{ fontFamily: isDownloaded ? font.family : undefined }}
                      >
                        {isDownloaded ? font.previewText : font.displayNameZh}
                      </span>
                      {isDownloaded && (
                        <span className="truncate text-[10px] text-muted-foreground">
                          {font.displayNameZh}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[9px] text-muted-foreground">
                      {font.description} · {formatFontSize(font.sizeBytes)}
                    </div>
                  </button>
                  {isDownloaded ? (
                    <span
                      className="flex size-7 shrink-0 items-center justify-center"
                      title="已下载"
                    >
                      <Check
                        className={cn('size-4', isSelected ? 'text-primary' : 'text-emerald-500')}
                      />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="flex size-7 shrink-0 items-center justify-center rounded border hover:bg-background disabled:opacity-50"
                      disabled={Boolean(downloadingId)}
                      onClick={() => void download(font)}
                      aria-label={`下载${font.displayNameZh}`}
                      title={`下载${font.displayNameZh}`}
                    >
                      {isDownloading ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                    </button>
                  )}
                </div>
              )
            })}
            {visibleFonts.length === 0 && (
              <div className="px-2 py-8 text-center text-xs text-muted-foreground">
                没有找到匹配的字体
              </div>
            )}
            {visibleFonts.length < matchingFonts.length && (
              <button
                type="button"
                className="flex h-9 w-full items-center justify-center rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setVisibleCount((count) => count + FONT_PAGE_SIZE)}
              >
                显示更多（剩余 {matchingFonts.length - visibleFonts.length}）
              </button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
