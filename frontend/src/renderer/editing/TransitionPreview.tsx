import type { CSSProperties } from 'react'
import sampleFrom from './assets/transition-preview-1.jpg'
import sampleTo from './assets/transition-preview-2.jpg'

export const DEFAULT_TRANSITION_PREVIEW = {
  from: sampleFrom,
  to: sampleTo
}

export type TransitionPreviewMode =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'center'
  | 'zoom'
  | 'flip'
  | 'glitch'
  | 'diagonal'
  | 'spin'
  | 'fade'

function stableMode(id: string): TransitionPreviewMode {
  const modes: TransitionPreviewMode[] = ['left', 'right', 'up', 'down', 'diagonal', 'spin']
  const score = Array.from(id).reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return modes[score % modes.length]
}

export function transitionPreviewMode({
  id,
  name,
  category
}: {
  id: string
  name?: string
  category?: string
}): TransitionPreviewMode {
  const key = `${id} ${name || ''}`.toLowerCase().replace(/[_\s-]+/g, '')

  if (/(glitch|datamosh|static|tv|noise|flicker|mosh)/.test(key)) return 'glitch'
  if (/(flip|cube|book|fold|revolve|roll|swap|doorway|stereo)/.test(key)) return 'flip'
  if (/(wipedown|slidedown|downwipe|verticalclose|topbottom)/.test(key)) return 'down'
  if (/(wiperight|slideright|rightwipe|zoomright)/.test(key)) return 'right'
  if (/(wipeleft|slideleft|leftwipe|zoomleft|leftright)/.test(key)) return 'left'
  if (/(wipeup|slideup|upwipe|verticalopen|bottomtop)/.test(key)) return 'up'
  if (/(simplezoom|dreamyzoom|zoomquick|zoomout)/.test(key)) return 'zoom'
  if (/(circle|radial|zoom|scale|pixel|mosaic|rectangle|heart|star|hexagonal|polkadot|kaleido|ripple)/.test(key)) {
    return 'center'
  }
  if (/(directional|wind|squeeze|angular|warp|cross|tile)/.test(key)) return 'diagonal'
  if (/(fade|dissolve|burn|luma|color|colour|overexposure|defocus|blur|melt)/.test(key)) return 'fade'
  if (category === 'wipe') return stableMode(id)
  return stableMode(id)
}

export function TransitionPreview({
  from,
  to,
  variant,
  mode = 'fade'
}: {
  from?: string
  to?: string
  variant: number
  mode?: TransitionPreviewMode
}) {
  return (
    <div
      className="online-transition-preview"
      data-preview-mode={mode}
      style={{ '--transition-delay': `${(variant % 9) * -0.32}s` } as CSSProperties}
    >
      <img className="online-transition-preview-from" src={from || DEFAULT_TRANSITION_PREVIEW.from} alt="" />
      <img className="online-transition-preview-to" src={to || DEFAULT_TRANSITION_PREVIEW.to} alt="" />
      <span className="online-transition-preview-label">动态预览</span>
    </div>
  )
}
