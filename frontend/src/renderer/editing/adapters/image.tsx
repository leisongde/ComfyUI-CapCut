import type { ImgHTMLAttributes, CSSProperties } from 'react'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | { src: string }
  fill?: boolean
  priority?: boolean
  unoptimized?: boolean
  quality?: number
}
/** Next's server image optimization is replaced by the native browser image element. */
export default function Image({
  src,
  fill,
  priority: _priority,
  unoptimized: _unoptimized,
  quality: _quality,
  style,
  ...props
}: Props) {
  const fillStyle: CSSProperties = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style }
    : style
  return <img {...props} src={typeof src === 'string' ? src : src.src} style={fillStyle} />
}
