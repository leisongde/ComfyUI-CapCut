import type { EditingProjectCover } from '../../shared/editing'

export type CoverStyle = Omit<EditingProjectCover, 'sourceAssetId' | 'origin' | 'time'>

export const DEFAULT_COVER_STYLE: CoverStyle = {
  fit: 'cover', zoom: 1, offsetX: 0, offsetY: 0,
  title: '', titleColor: '#ffffff', titleSize: 0.1, titleX: 0.5, titleY: 0.75
}

export function drawProjectCover(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  size: { width: number; height: number },
  style: CoverStyle
): void {
  const context = canvas.getContext('2d')!
  const { width, height } = canvas
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#000000'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const fit = style.fit === 'cover' ? Math.max : Math.min
  const scale = fit(width / size.width, height / size.height) * style.zoom
  const imageWidth = size.width * scale, imageHeight = size.height * scale
  context.drawImage(source, (width - imageWidth) / 2 + style.offsetX * width,
    (height - imageHeight) / 2 + style.offsetY * height, imageWidth, imageHeight)

  if (!style.title.trim()) return
  const fontSize = Math.min(width, height) * style.titleSize
  context.font = `700 ${fontSize}px "Microsoft YaHei", system-ui, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.lineWidth = Math.max(1, fontSize * 0.07)
  context.strokeStyle = '#151515'
  context.fillStyle = style.titleColor
  const lines: string[] = []
  for (const paragraph of style.title.split('\n')) {
    let line = ''
    for (const character of paragraph) {
      if (line && context.measureText(line + character).width > width * 0.9) {
        lines.push(line)
        line = ''
      }
      line += character
    }
    lines.push(line)
  }
  lines.forEach((line, index) => {
    const y = style.titleY * height + (index - (lines.length - 1) / 2) * fontSize * 1.25
    const x = style.titleX * width
    context.strokeText(line, x, y)
    context.fillText(line, x, y)
  })
}

export function coverCanvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob)
    else reject(new Error('封面图片编码失败，请重试'))
  }, 'image/png'))
}

export function downloadCover(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}-封面.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
