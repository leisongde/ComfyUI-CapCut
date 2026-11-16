import { useState, type ReactNode } from 'react'
import type { ImageElement, VideoElement } from '@/types/timeline'
import { ClipAudioProperties } from './ClipAudioProperties'
import { ClipAnimationsProperties } from './ClipAnimationsProperties'
import { TrackingProperties } from './TrackingProperties'
import { AdjustmentProperties } from './AdjustmentProperties'

const PRIMARY_CATEGORIES = [
  { id: 'visual', label: '画面' },
  { id: 'audio', label: '音频' },
  { id: 'speed', label: '变速' },
  { id: 'animation', label: '动画' },
  { id: 'tracking', label: '跟踪' },
  { id: 'adjustment', label: '调整' }
] as const

const VISUAL_CATEGORIES = [
  { id: 'basic', label: '基础' },
  { id: 'cutout', label: '抠像' },
  { id: 'mask', label: '蒙版' },
  { id: 'beauty', label: '美颜' }
] as const

const AUDIO_CATEGORIES = [
  { id: 'basic', label: '基础', available: true },
  { id: 'voice', label: '换音色', available: false },
  { id: 'effects', label: '声音效果', available: false }
] as const

type PrimaryCategory = (typeof PRIMARY_CATEGORIES)[number]['id']
type VisualCategory = (typeof VISUAL_CATEGORIES)[number]['id']

export function VideoPropertiesCategories({
  children,
  element,
  trackId
}: {
  children: ReactNode
  element: VideoElement | ImageElement
  trackId: string
}) {
  const [primaryCategory, setPrimaryCategory] = useState<PrimaryCategory>('visual')
  const [visualCategory, setVisualCategory] = useState<VisualCategory>('basic')
  const primaryCategories =
    element.type === 'video'
      ? PRIMARY_CATEGORIES
      : PRIMARY_CATEGORIES.filter((category) => category.id !== 'audio')
  const showBasicProperties = primaryCategory === 'visual' && visualCategory === 'basic'
  const propertyContent = showBasicProperties
    ? 'basic'
    : primaryCategory === 'audio'
      ? 'audio'
      : primaryCategory === 'animation'
        ? 'animation'
        : primaryCategory === 'tracking'
          ? 'tracking'
          : primaryCategory === 'adjustment'
            ? 'adjustment'
          : primaryCategory === 'speed'
            ? 'speed'
            : primaryCategory === 'visual' && visualCategory === 'cutout'
              ? 'cutout'
              : primaryCategory === 'visual' && visualCategory === 'mask'
                ? 'mask'
                : primaryCategory === 'visual' && visualCategory === 'beauty'
                  ? 'beauty'
                  : null

  const visibilityClass =
    propertyContent === 'basic'
      ? '[&_.desktop-video-speed-properties]:hidden [&_.desktop-video-cutout-properties]:hidden [&_.desktop-video-mask-properties]:hidden [&_.desktop-video-beauty-properties]:hidden'
      : propertyContent === 'speed'
        ? '[&_.desktop-video-basic-properties]:hidden [&_.desktop-video-cutout-properties]:hidden [&_.desktop-video-mask-properties]:hidden [&_.desktop-video-beauty-properties]:hidden'
        : propertyContent === 'cutout'
          ? '[&_.desktop-video-basic-properties]:hidden [&_.desktop-video-speed-properties]:hidden [&_.desktop-video-mask-properties]:hidden [&_.desktop-video-beauty-properties]:hidden'
          : propertyContent === 'mask'
            ? '[&_.desktop-video-basic-properties]:hidden [&_.desktop-video-speed-properties]:hidden [&_.desktop-video-cutout-properties]:hidden [&_.desktop-video-beauty-properties]:hidden'
            : '[&_.desktop-video-basic-properties]:hidden [&_.desktop-video-speed-properties]:hidden [&_.desktop-video-cutout-properties]:hidden [&_.desktop-video-mask-properties]:hidden'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border bg-background shrink-0 border-b">
        <div
          className="grid h-10"
          style={{ gridTemplateColumns: `repeat(${primaryCategories.length}, minmax(0, 1fr))` }}
          role="tablist"
          aria-label="视频属性分类"
        >
          {primaryCategories.map((category) => {
            const isActive = primaryCategory === category.id
            return (
              <button
                key={category.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-video-property-category={category.id}
                className={`relative flex min-w-0 items-center justify-center px-1 text-xs transition-colors ${
                  isActive
                    ? 'text-sky-400'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`}
                onClick={() => setPrimaryCategory(category.id)}
              >
                <span className="truncate">{category.label}</span>
                {isActive && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-sky-400" />}
              </button>
            )
          })}
        </div>

        {primaryCategory === 'visual' && (
          <div
            className="border-border grid h-9 grid-cols-4 gap-1 border-t px-1.5 py-1"
            role="tablist"
            aria-label="画面属性分类"
          >
            {VISUAL_CATEGORIES.map((category) => {
              const isActive = visualCategory === category.id
              return (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-video-visual-category={category.id}
                  className={`min-w-0 rounded-sm px-2 text-xs transition-colors ${
                    isActive
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                  onClick={() => setVisualCategory(category.id)}
                >
                  <span className="truncate">{category.label}</span>
                </button>
              )
            })}
          </div>
        )}
        {primaryCategory === 'audio' && (
          <div
            className="border-border grid h-9 grid-cols-3 gap-1 border-t px-1.5 py-1"
            role="tablist"
            aria-label="音频属性分类"
          >
            {AUDIO_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                role="tab"
                aria-selected={category.id === 'basic'}
                disabled={!category.available}
                title={category.available ? category.label : `${category.label}（后续开放）`}
                className={`min-w-0 rounded-sm px-2 text-xs transition-colors ${
                  category.id === 'basic'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground opacity-55'
                }`}
              >
                <span className="truncate">{category.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`min-h-0 flex-1 overflow-hidden ${visibilityClass}`}>
        {propertyContent === 'audio' && element.type === 'video' ? (
          <ClipAudioProperties element={element} trackId={trackId} />
        ) : propertyContent === 'animation' ? (
          <ClipAnimationsProperties element={element} trackId={trackId} />
        ) : propertyContent === 'tracking' ? (
          <TrackingProperties element={element} trackId={trackId} />
        ) : propertyContent === 'adjustment' ? (
          <AdjustmentProperties element={element} trackId={trackId} />
        ) : propertyContent ? (
          children
        ) : null}
      </div>
    </div>
  )
}
