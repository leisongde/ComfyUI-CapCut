import { useState } from 'react'
import type { AudioElement } from '@/types/timeline'
import { ClipAudioProperties } from './ClipAudioProperties'
import { AudioSpeedProperties } from './AudioSpeedProperties'

const AUDIO_CATEGORIES = [
  { id: 'basic', label: '基础' },
  { id: 'speed', label: '变速' }
] as const

type AudioCategory = (typeof AUDIO_CATEGORIES)[number]['id']

export function AudioPropertiesCategories({
  _element: element,
  trackId
}: {
  _element: AudioElement
  trackId: string
}) {
  const [category, setCategory] = useState<AudioCategory>('basic')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="border-border bg-background grid h-10 shrink-0 grid-cols-2 border-b"
        role="tablist"
        aria-label="音频属性分类"
      >
        {AUDIO_CATEGORIES.map((item) => {
          const isActive = category === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-audio-property-category={item.id}
              className={`relative flex min-w-0 items-center justify-center px-1 text-xs transition-colors ${
                isActive
                  ? 'text-sky-400'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
              onClick={() => setCategory(item.id)}
            >
              <span className="truncate">{item.label}</span>
              {isActive && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-sky-400" />}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden" role="tabpanel">
        {category === 'basic' ? (
          <ClipAudioProperties element={element} trackId={trackId} />
        ) : (
          <AudioSpeedProperties element={element} trackId={trackId} />
        )}
      </div>
    </div>
  )
}
