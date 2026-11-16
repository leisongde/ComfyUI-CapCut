import { useState, type ReactNode } from 'react'
import type { StickerElement, TextElement } from '@/types/timeline'
import { TrackingProperties } from './TrackingProperties'

export function TrackingPropertiesCategories({
  children,
  element,
  trackId,
  label,
  trackingAvailable = true
}: {
  children: ReactNode
  element: TextElement | StickerElement
  trackId: string
  label: string
  trackingAvailable?: boolean
}) {
  const [category, setCategory] = useState<'properties' | 'tracking'>('properties')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="border-border bg-background grid h-10 shrink-0 grid-cols-2 border-b"
        role="tablist"
        aria-label={`${label}属性分类`}
      >
        <button
          type="button"
          role="tab"
          aria-selected={category === 'properties'}
          className={`relative min-w-0 px-2 text-xs transition-colors ${
            category === 'properties'
              ? 'text-sky-400'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
          onClick={() => setCategory('properties')}
        >
          {label}
          {category === 'properties' && (
            <span className="absolute inset-x-3 bottom-0 h-0.5 bg-sky-400" />
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={category === 'tracking'}
          disabled={!trackingAvailable}
          title={trackingAvailable ? '跟踪' : '多选时不能设置跟踪'}
          className={`relative min-w-0 px-2 text-xs transition-colors ${
            category === 'tracking'
              ? 'text-sky-400'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          } ${trackingAvailable ? '' : 'cursor-not-allowed opacity-45'}`}
          onClick={() => setCategory('tracking')}
        >
          跟踪
          {category === 'tracking' && (
            <span className="absolute inset-x-3 bottom-0 h-0.5 bg-sky-400" />
          )}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {category === 'tracking' ? (
          <TrackingProperties element={element} trackId={trackId} />
        ) : (
          children
        )}
      </div>
    </div>
  )
}
