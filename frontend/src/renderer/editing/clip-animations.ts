import {
  BUILTIN_EASING_PRESETS,
  getBezierHandlesForSegment,
  getScalarChannelValueAtTime,
  type ScalarAnimationChannel,
  type ScalarAnimationKey,
  type ScalarSegmentType
} from './animation'

export const CLIP_ANIMATION_CATEGORIES = ['in', 'out', 'combo'] as const
export type ClipAnimationCategory = (typeof CLIP_ANIMATION_CATEGORIES)[number]

export const CLIP_ANIMATION_CATEGORY_LABELS: Record<ClipAnimationCategory, string> = {
  in: '入场',
  out: '出场',
  combo: '组合'
}

export type ClipAnimationPreviewMotion =
  | 'fade'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'zoom-in'
  | 'zoom-out'
  | 'rotate'
  | 'pulse'
  | 'float'
  | 'shake'
  | 'bounce'
  | 'spin'
  | 'flicker'
  | 'drift'

export type ClipAnimationChannelProperty = 'offsetX' | 'offsetY' | 'scale' | 'rotation' | 'opacity'

export interface ClipAnimationSelection {
  presetId: string
  duration: number
}

export type ClipAnimations = Partial<Record<ClipAnimationCategory, ClipAnimationSelection>>

interface ClipAnimationPresetKeyframe {
  at: number
  value: number
  easing?: string
  segment?: ScalarSegmentType
}

export interface ClipAnimationPreset {
  id: string
  name: string
  category: ClipAnimationCategory
  preview: ClipAnimationPreviewMotion
  defaultDuration: number
  minDuration?: number
  maxDuration?: number
  channels: Partial<Record<ClipAnimationChannelProperty, ClipAnimationPresetKeyframe[]>>
}

export interface ResolvedClipAnimationState {
  offsetX: number
  offsetY: number
  scale: number
  rotation: number
  opacity: number
}

const NEUTRAL_STATE: ResolvedClipAnimationState = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
  opacity: 1
}

const intro = (
  preset: Omit<ClipAnimationPreset, 'category' | 'defaultDuration'> & {
    defaultDuration?: number
  }
): ClipAnimationPreset => ({ category: 'in', defaultDuration: 0.6, ...preset })

const outro = (
  preset: Omit<ClipAnimationPreset, 'category' | 'defaultDuration'> & {
    defaultDuration?: number
  }
): ClipAnimationPreset => ({ category: 'out', defaultDuration: 0.6, ...preset })

const combo = (
  preset: Omit<ClipAnimationPreset, 'category' | 'defaultDuration'> & {
    defaultDuration?: number
  }
): ClipAnimationPreset => ({
  category: 'combo',
  defaultDuration: 1.6,
  maxDuration: 6,
  ...preset
})

export const CLIP_ANIMATION_PRESETS: ClipAnimationPreset[] = [
  intro({
    id: 'in-fade',
    name: '渐显',
    preview: 'fade',
    channels: {
      opacity: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 1, value: 1 }
      ]
    }
  }),
  intro({
    id: 'in-slide-right',
    name: '向右滑入',
    preview: 'right',
    channels: {
      offsetX: [
        { at: 0, value: -360, easing: 'ease-out' },
        { at: 1, value: 0 }
      ],
      opacity: [
        { at: 0, value: 0.35, easing: 'ease-out' },
        { at: 0.7, value: 1 }
      ]
    }
  }),
  intro({
    id: 'in-slide-left',
    name: '向左滑入',
    preview: 'left',
    channels: {
      offsetX: [
        { at: 0, value: 360, easing: 'ease-out' },
        { at: 1, value: 0 }
      ],
      opacity: [
        { at: 0, value: 0.35, easing: 'ease-out' },
        { at: 0.7, value: 1 }
      ]
    }
  }),
  intro({
    id: 'in-rise',
    name: '向上浮现',
    preview: 'up',
    channels: {
      offsetY: [
        { at: 0, value: 260, easing: 'ease-out' },
        { at: 1, value: 0 }
      ],
      opacity: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.72, value: 1 }
      ]
    }
  }),
  intro({
    id: 'in-drop',
    name: '向下落入',
    preview: 'down',
    channels: {
      offsetY: [
        { at: 0, value: -260, easing: 'pop' },
        { at: 1, value: 0 }
      ],
      opacity: [
        { at: 0, value: 0.2, easing: 'ease-out' },
        { at: 0.65, value: 1 }
      ]
    }
  }),
  intro({
    id: 'in-zoom',
    name: '轻微放大',
    preview: 'zoom-in',
    channels: {
      scale: [
        { at: 0, value: 0.35, easing: 'pop' },
        { at: 1, value: 1 }
      ],
      opacity: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.55, value: 1 }
      ]
    }
  }),
  intro({
    id: 'in-zoom-back',
    name: '缩回画面',
    preview: 'zoom-out',
    channels: {
      scale: [
        { at: 0, value: 1.65, easing: 'ease-out' },
        { at: 1, value: 1 }
      ],
      opacity: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.55, value: 1 }
      ]
    }
  }),
  intro({
    id: 'in-rotate',
    name: '旋转进入',
    preview: 'rotate',
    channels: {
      rotation: [
        { at: 0, value: -28, easing: 'ease-out' },
        { at: 1, value: 0 }
      ],
      scale: [
        { at: 0, value: 0.68, easing: 'pop' },
        { at: 1, value: 1 }
      ],
      opacity: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.62, value: 1 }
      ]
    }
  }),
  intro({
    id: 'in-bounce',
    name: '弹跳进入',
    preview: 'bounce',
    defaultDuration: 0.8,
    channels: {
      offsetY: [
        { at: 0, value: -240, easing: 'ease-in' },
        { at: 0.55, value: 18, easing: 'ease-out' },
        { at: 0.76, value: -10, easing: 'ease-in-out' },
        { at: 1, value: 0 }
      ],
      opacity: [
        { at: 0, value: 0 },
        { at: 0.35, value: 1 }
      ]
    }
  }),
  outro({
    id: 'out-fade',
    name: '渐隐',
    preview: 'fade',
    channels: {
      opacity: [
        { at: 0, value: 1, easing: 'ease-in' },
        { at: 1, value: 0 }
      ]
    }
  }),
  outro({
    id: 'out-slide-left',
    name: '向左滑出',
    preview: 'left',
    channels: {
      offsetX: [
        { at: 0, value: 0, easing: 'ease-in' },
        { at: 1, value: -360 }
      ],
      opacity: [
        { at: 0.3, value: 1, easing: 'ease-in' },
        { at: 1, value: 0.25 }
      ]
    }
  }),
  outro({
    id: 'out-slide-right',
    name: '向右滑出',
    preview: 'right',
    channels: {
      offsetX: [
        { at: 0, value: 0, easing: 'ease-in' },
        { at: 1, value: 360 }
      ],
      opacity: [
        { at: 0.3, value: 1, easing: 'ease-in' },
        { at: 1, value: 0.25 }
      ]
    }
  }),
  outro({
    id: 'out-sink',
    name: '向下沉出',
    preview: 'down',
    channels: {
      offsetY: [
        { at: 0, value: 0, easing: 'ease-in' },
        { at: 1, value: 260 }
      ],
      opacity: [
        { at: 0.25, value: 1, easing: 'ease-in' },
        { at: 1, value: 0 }
      ]
    }
  }),
  outro({
    id: 'out-lift',
    name: '向上离场',
    preview: 'up',
    channels: {
      offsetY: [
        { at: 0, value: 0, easing: 'ease-in' },
        { at: 1, value: -260 }
      ],
      opacity: [
        { at: 0.25, value: 1, easing: 'ease-in' },
        { at: 1, value: 0 }
      ]
    }
  }),
  outro({
    id: 'out-shrink',
    name: '缩小消失',
    preview: 'zoom-out',
    channels: {
      scale: [
        { at: 0, value: 1, easing: 'ease-in' },
        { at: 1, value: 0.25 }
      ],
      opacity: [
        { at: 0.35, value: 1, easing: 'ease-in' },
        { at: 1, value: 0 }
      ]
    }
  }),
  outro({
    id: 'out-expand',
    name: '放大消失',
    preview: 'zoom-in',
    channels: {
      scale: [
        { at: 0, value: 1, easing: 'ease-in' },
        { at: 1, value: 1.8 }
      ],
      opacity: [
        { at: 0.3, value: 1, easing: 'ease-in' },
        { at: 1, value: 0 }
      ]
    }
  }),
  outro({
    id: 'out-rotate',
    name: '旋转离场',
    preview: 'rotate',
    channels: {
      rotation: [
        { at: 0, value: 0, easing: 'ease-in' },
        { at: 1, value: 32 }
      ],
      scale: [
        { at: 0, value: 1, easing: 'ease-in' },
        { at: 1, value: 0.62 }
      ],
      opacity: [
        { at: 0.35, value: 1, easing: 'ease-in' },
        { at: 1, value: 0 }
      ]
    }
  }),
  outro({
    id: 'out-fall',
    name: '坠落离场',
    preview: 'bounce',
    defaultDuration: 0.8,
    channels: {
      offsetY: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.2, value: -24, easing: 'ease-in' },
        { at: 1, value: 380 }
      ],
      rotation: [
        { at: 0, value: 0, easing: 'ease-in' },
        { at: 1, value: 12 }
      ],
      opacity: [
        { at: 0.55, value: 1, easing: 'ease-in' },
        { at: 1, value: 0 }
      ]
    }
  }),
  combo({
    id: 'combo-pulse',
    name: '呼吸缩放',
    preview: 'pulse',
    channels: {
      scale: [
        { at: 0, value: 1, easing: 'ease-in-out' },
        { at: 0.5, value: 1.08, easing: 'ease-in-out' },
        { at: 1, value: 1 }
      ]
    }
  }),
  combo({
    id: 'combo-float',
    name: '上下漂浮',
    preview: 'float',
    defaultDuration: 2,
    channels: {
      offsetY: [
        { at: 0, value: 0, easing: 'ease-in-out' },
        { at: 0.5, value: -34, easing: 'ease-in-out' },
        { at: 1, value: 0 }
      ]
    }
  }),
  combo({
    id: 'combo-shake',
    name: '左右抖动',
    preview: 'shake',
    defaultDuration: 0.65,
    channels: {
      offsetX: [
        { at: 0, value: 0, segment: 'linear' },
        { at: 0.16, value: -22, segment: 'linear' },
        { at: 0.34, value: 18, segment: 'linear' },
        { at: 0.52, value: -13, segment: 'linear' },
        { at: 0.7, value: 9, segment: 'linear' },
        { at: 1, value: 0 }
      ]
    }
  }),
  combo({
    id: 'combo-sway',
    name: '轻微摇摆',
    preview: 'drift',
    defaultDuration: 1.8,
    channels: {
      rotation: [
        { at: 0, value: 0, easing: 'ease-in-out' },
        { at: 0.25, value: -3, easing: 'ease-in-out' },
        { at: 0.75, value: 3, easing: 'ease-in-out' },
        { at: 1, value: 0 }
      ]
    }
  }),
  combo({
    id: 'combo-heartbeat',
    name: '心跳',
    preview: 'pulse',
    defaultDuration: 1.1,
    channels: {
      scale: [
        { at: 0, value: 1, easing: 'ease-out' },
        { at: 0.18, value: 1.12, easing: 'ease-in' },
        { at: 0.34, value: 1, easing: 'ease-out' },
        { at: 0.5, value: 1.17, easing: 'ease-in' },
        { at: 0.7, value: 1, easing: 'linear' },
        { at: 1, value: 1 }
      ]
    }
  }),
  combo({
    id: 'combo-bounce',
    name: '连续弹跳',
    preview: 'bounce',
    defaultDuration: 1.25,
    channels: {
      offsetY: [
        { at: 0, value: 0, easing: 'ease-out' },
        { at: 0.34, value: -64, easing: 'ease-in' },
        { at: 0.62, value: 0, easing: 'ease-out' },
        { at: 0.78, value: -18, easing: 'ease-in' },
        { at: 1, value: 0 }
      ]
    }
  }),
  combo({
    id: 'combo-spin',
    name: '持续旋转',
    preview: 'spin',
    defaultDuration: 2.4,
    channels: {
      rotation: [
        { at: 0, value: 0, segment: 'linear' },
        { at: 1, value: 360 }
      ]
    }
  }),
  combo({
    id: 'combo-flicker',
    name: '闪烁',
    preview: 'flicker',
    defaultDuration: 1,
    channels: {
      opacity: [
        { at: 0, value: 1, segment: 'step' },
        { at: 0.18, value: 0.28, segment: 'step' },
        { at: 0.34, value: 1, segment: 'step' },
        { at: 0.58, value: 0.5, segment: 'step' },
        { at: 0.72, value: 1, segment: 'step' },
        { at: 1, value: 1 }
      ]
    }
  })
]

const PRESETS_BY_ID = new Map(CLIP_ANIMATION_PRESETS.map((preset) => [preset.id, preset]))
const EASING_BY_ID = new Map(BUILTIN_EASING_PRESETS.map((preset) => [preset.id, preset.value]))

function compileChannel(keyframes: ClipAnimationPresetKeyframe[]): ScalarAnimationChannel {
  const keys: ScalarAnimationKey[] = keyframes.map((keyframe, index) => ({
    id: `preset-${index}`,
    time: Math.max(0, Math.min(1, keyframe.at)),
    value: keyframe.value,
    segmentToNext: keyframe.segment ?? 'bezier',
    tangentMode: 'broken'
  }))

  for (let index = 0; index < keys.length - 1; index += 1) {
    const source = keyframes[index]
    if (source.segment === 'step' || source.segment === 'linear') continue
    const left = keys[index]
    const right = keys[index + 1]
    const easing = EASING_BY_ID.get(source.easing ?? 'smooth') ?? [0.25, 0.1, 0.25, 1]
    const handles = getBezierHandlesForSegment({
      easing,
      timeSpan: right.time - left.time,
      valueDelta: right.value - left.value
    })
    left.rightHandle = handles.rightHandle
    right.leftHandle = handles.leftHandle
  }
  return { keys }
}

const COMPILED_CHANNELS = new Map(
  CLIP_ANIMATION_PRESETS.map((preset) => [
    preset.id,
    Object.fromEntries(
      Object.entries(preset.channels).map(([property, keyframes]) => [
        property,
        compileChannel(keyframes)
      ])
    ) as Partial<Record<ClipAnimationChannelProperty, ScalarAnimationChannel>>
  ])
)

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function getClipAnimationPreset(
  presetId: string | undefined
): ClipAnimationPreset | undefined {
  return presetId ? PRESETS_BY_ID.get(presetId) : undefined
}

export function getClipAnimationPresets(category: ClipAnimationCategory): ClipAnimationPreset[] {
  return CLIP_ANIMATION_PRESETS.filter((preset) => preset.category === category)
}

export function getClipAnimationDurationBounds({
  preset,
  clipDuration
}: {
  preset: ClipAnimationPreset
  clipDuration: number
}): { minimum: number; maximum: number } {
  const minimum = Math.min(Math.max(0.1, preset.minDuration ?? 0.2), Math.max(0.1, clipDuration))
  return {
    minimum,
    maximum: Math.max(minimum, Math.min(clipDuration, preset.maxDuration ?? 3))
  }
}

export function normalizeClipAnimations(
  animations: ClipAnimations | undefined,
  clipDuration: number
): ClipAnimations | undefined {
  if (!animations || clipDuration <= 0) return undefined
  const normalized: ClipAnimations = {}
  for (const category of CLIP_ANIMATION_CATEGORIES) {
    const selection = animations[category]
    const preset = getClipAnimationPreset(selection?.presetId)
    if (!selection || !preset || preset.category !== category) continue
    const bounds = getClipAnimationDurationBounds({ preset, clipDuration })
    normalized[category] = {
      presetId: preset.id,
      duration: clamp(
        Number.isFinite(selection.duration) ? selection.duration : preset.defaultDuration,
        bounds.minimum,
        bounds.maximum
      )
    }
  }
  return Object.keys(normalized).length ? normalized : undefined
}

export function setClipAnimation({
  animations,
  category,
  presetId,
  duration,
  clipDuration
}: {
  animations: ClipAnimations | undefined
  category: ClipAnimationCategory
  presetId: string | undefined
  duration?: number
  clipDuration: number
}): ClipAnimations | undefined {
  const next = { ...(animations ?? {}) }
  const preset = getClipAnimationPreset(presetId)
  if (!preset || preset.category !== category) delete next[category]
  else {
    next[category] = {
      presetId: preset.id,
      duration: duration ?? next[category]?.duration ?? preset.defaultDuration
    }
  }
  return normalizeClipAnimations(next, clipDuration)
}

function getAnimationProgress({
  category,
  localTime,
  clipDuration,
  animationDuration
}: {
  category: ClipAnimationCategory
  localTime: number
  clipDuration: number
  animationDuration: number
}): number | null {
  if (category === 'in') {
    if (localTime > animationDuration) return null
    return clamp(localTime / animationDuration, 0, 1)
  }
  if (category === 'out') {
    const start = Math.max(0, clipDuration - animationDuration)
    if (localTime < start) return null
    return clamp((localTime - start) / animationDuration, 0, 1)
  }
  if (localTime >= clipDuration) return 1
  const cycleTime = ((localTime % animationDuration) + animationDuration) % animationDuration
  return clamp(cycleTime / animationDuration, 0, 1)
}

function resolvePresetState({
  preset,
  progress
}: {
  preset: ClipAnimationPreset
  progress: number
}): ResolvedClipAnimationState {
  const channels = COMPILED_CHANNELS.get(preset.id)
  if (!channels) return { ...NEUTRAL_STATE }
  const value = (property: ClipAnimationChannelProperty, fallbackValue: number) =>
    getScalarChannelValueAtTime({
      channel: channels[property],
      time: progress,
      fallbackValue
    })
  return {
    offsetX: value('offsetX', 0),
    offsetY: value('offsetY', 0),
    scale: value('scale', 1),
    rotation: value('rotation', 0),
    opacity: value('opacity', 1)
  }
}

export function resolveClipAnimations({
  animations,
  localTime,
  clipDuration
}: {
  animations: ClipAnimations | undefined
  localTime: number
  clipDuration: number
}): ResolvedClipAnimationState {
  const normalized = normalizeClipAnimations(animations, clipDuration)
  if (!normalized) return { ...NEUTRAL_STATE }

  const resolved = { ...NEUTRAL_STATE }
  for (const category of CLIP_ANIMATION_CATEGORIES) {
    const selection = normalized[category]
    const preset = getClipAnimationPreset(selection?.presetId)
    if (!selection || !preset) continue
    const progress = getAnimationProgress({
      category,
      localTime,
      clipDuration,
      animationDuration: selection.duration
    })
    if (progress === null) continue
    const state = resolvePresetState({ preset, progress })
    resolved.offsetX += state.offsetX
    resolved.offsetY += state.offsetY
    resolved.scale *= state.scale
    resolved.rotation += state.rotation
    resolved.opacity *= state.opacity
  }
  return resolved
}

export function getClipAnimationMarkerTimes({
  animations,
  clipDuration
}: {
  animations: ClipAnimations | undefined
  clipDuration: number
}): number[] {
  const normalized = normalizeClipAnimations(animations, clipDuration)
  if (!normalized) return []
  const times = new Set<number>()
  if (normalized.in) {
    times.add(0)
    times.add(normalized.in.duration)
  }
  if (normalized.out) {
    times.add(Math.max(0, clipDuration - normalized.out.duration))
    times.add(clipDuration)
  }
  if (normalized.combo) {
    times.add(0)
    times.add(clipDuration)
  }
  return [...times].sort((left, right) => left - right)
}
