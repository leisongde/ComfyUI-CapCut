import type { ReactNode } from 'react'
import { useFileUpload } from '@/hooks/use-file-upload'

export function MediaUpload({ accept, label, disabled, onFileSelected, children }: {
  accept: string
  label: string
  disabled: boolean
  onFileSelected: (file: File) => void
  children: ReactNode
}) {
  const { isDragOver, openFilePicker, fileInputProps, dragProps } = useFileUpload({
    accept,
    onFilesSelected: files => { if (!disabled && files[0]) onFileSelected(files[0]) }
  })

  return <>
    <input {...fileInputProps} accept={accept} aria-label={label} disabled={disabled} />
    <button {...dragProps} type="button" className={`media-upload${isDragOver && !disabled ? ' drag-over' : ''}`} aria-label={label} disabled={disabled} onClick={openFilePicker}>
      {children}
      {isDragOver && !disabled && <span className="media-upload-drop-hint">松开即可上传</span>}
    </button>
  </>
}
