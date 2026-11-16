import { useEffect, useMemo, useState } from 'react'
import { Check, Image as ImageIcon, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { EditingLibraryAsset } from '../../shared/editing'
import { request } from './bridge'

export function TransitionAssetPicker({
  open,
  slot,
  onOpenChange,
  onSelect
}: {
  open: boolean
  slot: 'from' | 'to'
  onOpenChange: (open: boolean) => void
  onSelect: (asset: EditingLibraryAsset) => void
}) {
  const [assets, setAssets] = useState<EditingLibraryAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    void request<EditingLibraryAsset[]>('library:list')
      .then((items) => setAssets(items.filter((item) => item.type === 'image' && item.previewUrl)))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '资产库读取失败'))
      .finally(() => setLoading(false))
  }, [open])

  const visibleAssets = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    return assets.filter((asset) => !keyword || asset.name.toLocaleLowerCase().includes(keyword))
  }, [assets, search])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogTitle>选择{slot === 'from' ? '第一张' : '第二张'}预览图片</DialogTitle>
          <DialogDescription>
            预览只使用图片素材，实际应用到时间线时会自动使用相邻的视频或图片片段。
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
          <Search className="size-4" />
          <input
            className="min-w-0 flex-1 bg-transparent outline-none"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索资产库图片"
          />
        </label>
        <div className="max-h-[52vh] overflow-auto">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center text-xs text-muted-foreground">
              正在读取资产库…
            </div>
          ) : error ? (
            <div className="flex min-h-40 items-center justify-center text-xs text-destructive">{error}</div>
          ) : visibleAssets.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <ImageIcon className="size-7" />
              资产库中暂时没有可用图片
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {visibleAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className="group overflow-hidden rounded-lg border text-left transition-colors hover:border-primary hover:bg-accent"
                  onClick={() => {
                    onSelect(asset)
                    onOpenChange(false)
                  }}
                >
                  <div className="relative aspect-video overflow-hidden bg-muted">
                    <img className="h-full w-full object-cover" src={asset.previewUrl} alt="" />
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                      图片
                    </span>
                    <span className="absolute right-1 top-1 hidden rounded-full bg-primary p-1 text-primary-foreground group-hover:block">
                      <Check className="size-3" />
                    </span>
                  </div>
                  <span className="block truncate px-2 py-1.5 text-[10px]" title={asset.name}>
                    {asset.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

