import { useRef, useState, type ReactNode } from 'react'
import { Check, FolderOpen, Image, Music, Video } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useFileUpload } from '@/hooks/use-file-upload'
import type { MediaAsset, MediaType } from '@/types/assets'

const mediaLabels = { image: '图片', video: '视频', audio: '音频' }
const mediaIcons = { image: Image, video: Video, audio: Music }

export function MediaUpload({ accept, label, kind, assets, selectedId, disabled, onFileSelected, onAssetSelected, children }: {
  accept: string
  label: string
  kind: MediaType
  assets: MediaAsset[]
  selectedId?: string
  disabled: boolean
  onFileSelected: (file: File) => void
  onAssetSelected: (asset: MediaAsset) => void
  children: ReactNode
}) {
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [search, setSearch] = useState('')
  const libraryTrigger = useRef<HTMLButtonElement>(null)
  const { isDragOver, openFilePicker, fileInputProps, dragProps } = useFileUpload({
    accept,
    onFilesSelected: files => { if (!disabled && files[0]) onFileSelected(files[0]) }
  })

  const matchingAssets = libraryOpen ? assets.filter(asset => asset.type === kind && !asset.ephemeral) : []
  const query = search.trim().toLowerCase()
  const visibleAssets = query ? matchingAssets.filter(asset => asset.name.toLowerCase().includes(query)) : matchingAssets
  const mediaLabel = mediaLabels[kind]
  const Icon = mediaIcons[kind]

  return <>
    <input {...fileInputProps} accept={accept} aria-label={label} disabled={disabled} />
    <button {...dragProps} type="button" className={`media-upload${isDragOver && !disabled ? ' drag-over' : ''}`} aria-label={label} disabled={disabled} onClick={openFilePicker}>
      {children}
      {isDragOver && !disabled && <span className="media-upload-drop-hint">松开即可上传</span>}
    </button>
    <Dialog open={libraryOpen} onOpenChange={open => {
      if (open) setSearch('')
      setLibraryOpen(open)
    }}>
      <DialogTrigger ref={libraryTrigger} type="button" className="media-library-trigger" disabled={disabled} aria-label={`从素材库选择（${label}）`}>
        <FolderOpen size={15} />从素材库选择
      </DialogTrigger>
      <DialogContent className="media-library-dialog" onCloseAutoFocus={event => {
        event.preventDefault()
        libraryTrigger.current?.focus({ preventScroll: true })
      }}>
        <DialogHeader>
          <DialogTitle>从素材库选择</DialogTitle>
          <DialogDescription>当前工程的{mediaLabel}</DialogDescription>
        </DialogHeader>
        {matchingAssets.length > 0 && <input type="search" className="media-library-search" aria-label="搜索素材名称" placeholder="搜索素材名称" value={search} onChange={event => setSearch(event.target.value)} />}
        <div className="media-library-list">
          {visibleAssets.map(asset => {
            const thumbnail = asset.thumbnailUrl ?? (kind === 'image' ? asset.url : undefined)
            const selected = asset.id === selectedId
            return <button key={asset.id} type="button" disabled={disabled} title={asset.name} aria-pressed={selected} onClick={() => {
              onAssetSelected(asset)
              setLibraryOpen(false)
            }}>
              <span className="media-library-thumb">{thumbnail ? <img src={thumbnail} loading="lazy" alt="" /> : <Icon size={18} />}</span>
              <span className="media-library-name">{asset.name}</span>
              {selected && <Check size={16} />}
            </button>
          })}
          {visibleAssets.length === 0 && <p>{matchingAssets.length ? `没有匹配的${mediaLabel}` : `当前工程还没有${mediaLabel}素材，请先导入资源或上传文件。`}</p>}
        </div>
      </DialogContent>
    </Dialog>
  </>
}
