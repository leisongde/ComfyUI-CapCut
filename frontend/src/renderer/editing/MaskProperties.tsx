import { useEffect, useRef, useState, type ComponentType } from 'react'
import type { ImageElement, VideoElement } from '@/types/timeline'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useEditor } from '@/hooks/use-editor'
import { usePlaybackTime } from './playback-time'
import {
  AlignVerticalSpaceAround,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDashed,
  Diamond,
  Heart,
  Link2,
  Minus,
  Plus,
  RectangleHorizontal,
  RotateCcw,
  Square,
  Star,
  Trash2,
  Unlink2
} from 'lucide-react'
import {
  CLIP_MASK_LABELS,
  createClipMask,
  findClipMaskKeyframeAtTime,
  getClipMaskLocalTime,
  getNeighborClipMaskKeyframe,
  normalizeClipMaskSettings,
  replaceClipMask,
  resolveClipMaskAtTime,
  toggleClipMaskKeyframe,
  updateClipMaskProperty,
  type ClipMask,
  type ClipMaskKeyframeProperty,
  type ClipMaskKeyframeValue,
  type ClipMaskSettings,
  type ClipMaskType
} from './clip-mask'

export type MaskField = 'clipMask' | 'colorAdjustmentMask'
type MaskElement = (VideoElement | ImageElement) & {
  clipMask?: unknown
  colorAdjustmentMask?: unknown
}

const SHAPES: ReadonlyArray<{
  type: ClipMaskType
  icon: ComponentType<{ className?: string }>
}> = [
  { type: 'linear', icon: Minus },
  { type: 'mirror', icon: AlignVerticalSpaceAround },
  { type: 'circle', icon: Circle },
  { type: 'rectangle', icon: Square },
  { type: 'arc', icon: CircleDashed },
  { type: 'star', icon: Star },
  { type: 'heart', icon: Heart }
]

function MaskNumberInput({
  value,
  minimum,
  maximum,
  step = 1,
  prefix,
  suffix,
  onChange
}: {
  value: number
  minimum: number
  maximum: number
  step?: number
  prefix?: string
  suffix?: string
  onChange: (value: number, pushHistory: boolean) => void
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100))
  const initial = useRef<number | null>(null)
  const latest = useRef(value)

  useEffect(() => {
    if (initial.current === null) setDraft(String(Math.round(value * 100) / 100))
    latest.current = value
  }, [value])

  const clamp = (next: number) => Math.min(maximum, Math.max(minimum, next))
  const commit = () => {
    const parsed = Number.parseFloat(draft)
    const finalValue = clamp(Number.isFinite(parsed) ? parsed : latest.current)
    if (initial.current !== null) {
      onChange(initial.current, false)
      onChange(finalValue, true)
    }
    initial.current = null
    latest.current = finalValue
    setDraft(String(Math.round(finalValue * 100) / 100))
  }

  return (
    <label className="mask-number-field">
      {prefix && <span>{prefix}</span>}
      <Input
        type="number"
        value={draft}
        min={minimum}
        max={maximum}
        step={step}
        onFocus={() => {
          initial.current ??= value
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          initial.current ??= value
          const parsed = Number.parseFloat(event.target.value)
          if (Number.isFinite(parsed)) {
            const next = clamp(parsed)
            latest.current = next
            onChange(next, false)
          }
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        className="h-7 border-0 bg-transparent px-1 text-center !text-xs shadow-none [appearance:textfield] focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix && <span>{suffix}</span>}
    </label>
  )
}

function MaskSlider({
  value,
  minimum,
  maximum,
  step = 1,
  onChange
}: {
  value: number
  minimum: number
  maximum: number
  step?: number
  onChange: (value: number, pushHistory: boolean) => void
}) {
  const initial = useRef<number | null>(null)
  return (
    <Slider
      value={[Math.min(maximum, Math.max(minimum, value))]}
      min={minimum}
      max={maximum}
      step={step}
      onValueChange={([next]) => {
        initial.current ??= value
        onChange(next, false)
      }}
      onValueCommit={([next]) => {
        if (initial.current !== null) {
          onChange(initial.current, false)
          onChange(next, true)
          initial.current = null
        }
      }}
      className="min-w-0 flex-1"
    />
  )
}

function MaskKeyframeControl({
  editor,
  element,
  mask,
  property,
  label,
  onToggle
}: {
  editor: ReturnType<typeof useEditor>
  element: MaskElement
  mask: ClipMask
  property: ClipMaskKeyframeProperty
  label: string
  onToggle: () => void
}) {
  const localTime = getClipMaskLocalTime({
    startTime: element.startTime,
    duration: element.duration,
    timelineTime: editor.playback.getCurrentTime()
  })
  const isKeyframed = findClipMaskKeyframeAtTime({ mask, property, localTime }) >= 0
  const previous = getNeighborClipMaskKeyframe({
    mask,
    property,
    localTime,
    direction: 'previous'
  })
  const next = getNeighborClipMaskKeyframe({
    mask,
    property,
    localTime,
    direction: 'next'
  })
  const seek = (time: number | undefined) => {
    if (time === undefined) return
    editor.playback.seek({ time: element.startTime + time })
  }

  return (
    <span className="mask-keyframe-control">
      <button
        type="button"
        aria-label={`上一个${label}关键帧`}
        title={`上一个${label}关键帧`}
        disabled={!previous}
        onClick={() => seek(previous?.time)}
      >
        <ChevronLeft className="size-3" />
      </button>
      <button
        type="button"
        aria-label={isKeyframed ? `删除当前${label}关键帧` : `添加${label}关键帧`}
        title={isKeyframed ? `删除当前${label}关键帧` : `添加${label}关键帧`}
        className={isKeyframed ? 'active' : ''}
        data-mask-keyframe-property={property}
        data-mask-keyframe-active={isKeyframed ? 'true' : 'false'}
        onClick={onToggle}
      >
        <Diamond className={`size-2.5 ${isKeyframed ? 'fill-current' : ''}`} />
      </button>
      <button
        type="button"
        aria-label={`下一个${label}关键帧`}
        title={`下一个${label}关键帧`}
        disabled={!next}
        onClick={() => seek(next?.time)}
      >
        <ChevronRight className="size-3" />
      </button>
    </span>
  )
}

export function MaskProperties({
  element,
  trackId,
  field = 'clipMask',
  title = '蒙版',
  subtitle = '基础蒙版'
}: {
  element: MaskElement
  trackId: string
  field?: MaskField
  title?: string
  subtitle?: string
}) {
  const editor = useEditor()
  const timelineTime = usePlaybackTime(editor.playback)
  const canvasSize = editor.project.getActive().settings.canvasSize
  const settings = normalizeClipMaskSettings(element[field], canvasSize, element.duration)
  const baseActiveMask =
    settings.masks.find((mask) => mask.id === settings.activeMaskId) ?? settings.masks[0]
  const localTime = getClipMaskLocalTime({
    startTime: element.startTime,
    duration: element.duration,
    timelineTime
  })
  const activeMask = baseActiveMask ? resolveClipMaskAtTime(baseActiveMask, localTime) : undefined

  const save = (next: ClipMaskSettings, pushHistory = true) => {
    editor.timeline.updateElements({
      updates: [
        {
          trackId,
          elementId: element.id,
          updates: { [field]: next } as Partial<MaskElement>
        }
      ],
      pushHistory
    })
  }

  const addMask = (type: ClipMaskType = 'rectangle') => {
    if (settings.masks.length >= 12) return
    const mask = createClipMask({ type, canvasSize })
    save({
      enabled: true,
      activeMaskId: mask.id,
      masks: [...settings.masks, mask]
    })
  }

  const updateActive = (updates: Partial<Omit<ClipMask, 'id'>>, pushHistory = true) => {
    if (!baseActiveMask) return
    save(replaceClipMask(settings, baseActiveMask.id, updates), pushHistory)
  }

  const replaceActive = (mask: ClipMask, pushHistory = true) => {
    if (!baseActiveMask) return
    save(replaceClipMask(settings, baseActiveMask.id, mask), pushHistory)
  }

  const updateActiveProperty = (
    property: ClipMaskKeyframeProperty,
    value: ClipMaskKeyframeValue,
    pushHistory = true
  ) => {
    if (!baseActiveMask) return
    replaceActive(
      updateClipMaskProperty({
        mask: baseActiveMask,
        property,
        value,
        localTime,
        duration: element.duration
      }),
      pushHistory
    )
  }

  const toggleKeyframe = (property: ClipMaskKeyframeProperty) => {
    if (!baseActiveMask) return
    replaceActive(
      toggleClipMaskKeyframe({
        mask: baseActiveMask,
        property,
        localTime,
        duration: element.duration
      })
    )
  }

  const selectShape = (type: ClipMaskType) => {
    if (!activeMask) {
      addMask(type)
      return
    }
    const replacement = createClipMask({ type, canvasSize, id: activeMask.id })
    updateActive({
      ...replacement,
      position: activeMask.position,
      rotation: activeMask.rotation,
      feather: activeMask.feather,
      inverted: activeMask.inverted,
      enabled: activeMask.enabled,
      keyframes: baseActiveMask.keyframes
    })
  }

  const setDimension = (dimension: 'width' | 'height', next: number, pushHistory: boolean) => {
    if (!activeMask) return
    if (!activeMask.aspectLocked) {
      updateActiveProperty(
        'size',
        dimension === 'width'
          ? { width: next, height: activeMask.height }
          : { width: activeMask.width, height: next },
        pushHistory
      )
      return
    }
    const ratio = activeMask.width / Math.max(1, activeMask.height)
    updateActiveProperty(
      'size',
      dimension === 'width'
        ? { width: next, height: next / ratio }
        : { height: next, width: next * ratio },
      pushHistory
    )
  }

  return (
    <div className="desktop-mask-properties h-full overflow-y-auto">
      <div className="mask-panel-header">
        <div>
          <strong>{title}</strong>
          <span>
            {settings.masks.length > 1 ? `${settings.masks.length} 个蒙版叠加` : subtitle}
          </span>
        </div>
        <Switch
          checked={settings.enabled}
          aria-label={settings.enabled ? '关闭蒙版' : '开启蒙版'}
          onCheckedChange={(checked) => {
            if (settings.masks.length === 0 && checked) {
              addMask()
              return
            }
            save({ ...settings, enabled: checked })
          }}
        />
      </div>

      <div className="mask-shape-section">
        <span className="mask-section-label">基础</span>
        <div className="mask-shape-grid">
          {SHAPES.map(({ type, icon: Icon }) => {
            const selected = settings.enabled && activeMask?.type === type
            return (
              <button
                type="button"
                key={type}
                className={selected ? 'active' : ''}
                aria-pressed={selected}
                data-mask-shape={type}
                onClick={() => selectShape(type)}
              >
                <span>
                  <Icon className="size-7" />
                </span>
                {CLIP_MASK_LABELS[type]}
              </button>
            )
          })}
        </div>
      </div>

      {settings.masks.length > 0 && (
        <>
          <div className="mask-layer-tabs" role="tablist" aria-label="蒙版列表">
            {settings.masks.map((mask, index) => (
              <button
                type="button"
                role="tab"
                key={mask.id}
                aria-selected={mask.id === activeMask?.id}
                className={mask.id === activeMask?.id ? 'active' : ''}
                onClick={() => save({ ...settings, activeMaskId: mask.id })}
              >
                蒙版{index + 1} {CLIP_MASK_LABELS[mask.type]}
              </button>
            ))}
            <button
              type="button"
              className="icon-button"
              aria-label="叠加蒙版"
              title="叠加蒙版"
              disabled={settings.masks.length >= 12}
              onClick={() => addMask()}
            >
              <Plus className="size-4" />
            </button>
          </div>

          {activeMask && (
            <div className="mask-parameter-section">
              <div className="mask-parameter-heading">
                <span>蒙版参数</span>
                <div>
                  <button
                    type="button"
                    aria-label="重置当前蒙版"
                    title="重置当前蒙版"
                    onClick={() => {
                      const reset = createClipMask({
                        type: activeMask.type,
                        canvasSize,
                        id: activeMask.id
                      })
                      save(replaceClipMask(settings, activeMask.id, reset))
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="删除当前蒙版"
                    title="删除当前蒙版"
                    onClick={() => {
                      const masks = settings.masks.filter((mask) => mask.id !== activeMask.id)
                      save({
                        enabled: settings.enabled && masks.length > 0,
                        activeMaskId: masks[0]?.id ?? null,
                        masks
                      })
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              <div className="mask-control-row">
                <span>位置</span>
                <div className="mask-control-content">
                  <div className="mask-two-fields">
                    <MaskNumberInput
                      prefix="X"
                      value={activeMask.position.x}
                      minimum={-canvasSize.width * 2}
                      maximum={canvasSize.width * 2}
                      onChange={(x, pushHistory) =>
                        updateActiveProperty(
                          'position',
                          { x, y: activeMask.position.y },
                          pushHistory
                        )
                      }
                    />
                    <MaskNumberInput
                      prefix="Y"
                      value={activeMask.position.y}
                      minimum={-canvasSize.height * 2}
                      maximum={canvasSize.height * 2}
                      onChange={(y, pushHistory) =>
                        updateActiveProperty(
                          'position',
                          { x: activeMask.position.x, y },
                          pushHistory
                        )
                      }
                    />
                  </div>
                  <MaskKeyframeControl
                    editor={editor}
                    element={element}
                    mask={baseActiveMask}
                    property="position"
                    label="位置"
                    onToggle={() => toggleKeyframe('position')}
                  />
                </div>
              </div>

              <div className="mask-control-row">
                <span>旋转</span>
                <div className="mask-control-content">
                  <div className="mask-slider-field">
                    <MaskSlider
                      value={activeMask.rotation}
                      minimum={-180}
                      maximum={180}
                      onChange={(rotation, pushHistory) =>
                        updateActiveProperty('rotation', rotation, pushHistory)
                      }
                    />
                    <MaskNumberInput
                      value={activeMask.rotation}
                      minimum={-360}
                      maximum={360}
                      suffix="°"
                      onChange={(rotation, pushHistory) =>
                        updateActiveProperty('rotation', rotation, pushHistory)
                      }
                    />
                  </div>
                  <MaskKeyframeControl
                    editor={editor}
                    element={element}
                    mask={baseActiveMask}
                    property="rotation"
                    label="旋转"
                    onToggle={() => toggleKeyframe('rotation')}
                  />
                </div>
              </div>

              {!['linear', 'mirror'].includes(activeMask.type) && (
                <div className="mask-control-row">
                  <span>大小</span>
                  <div className="mask-control-content">
                    <div className="mask-size-fields">
                      <MaskNumberInput
                        prefix="宽"
                        value={activeMask.width}
                        minimum={1}
                        maximum={canvasSize.width * 4}
                        onChange={(width, pushHistory) => setDimension('width', width, pushHistory)}
                      />
                      <button
                        type="button"
                        className={activeMask.aspectLocked ? 'active' : ''}
                        aria-label={activeMask.aspectLocked ? '取消宽高联动' : '启用宽高联动'}
                        title={activeMask.aspectLocked ? '取消宽高联动' : '启用宽高联动'}
                        onClick={() => updateActive({ aspectLocked: !activeMask.aspectLocked })}
                      >
                        {activeMask.aspectLocked ? (
                          <Link2 className="size-3.5" />
                        ) : (
                          <Unlink2 className="size-3.5" />
                        )}
                      </button>
                      <MaskNumberInput
                        prefix="高"
                        value={activeMask.height}
                        minimum={1}
                        maximum={canvasSize.height * 4}
                        onChange={(height, pushHistory) =>
                          setDimension('height', height, pushHistory)
                        }
                      />
                    </div>
                    <MaskKeyframeControl
                      editor={editor}
                      element={element}
                      mask={baseActiveMask}
                      property="size"
                      label="大小"
                      onToggle={() => toggleKeyframe('size')}
                    />
                  </div>
                </div>
              )}

              {activeMask.type === 'mirror' && (
                <div className="mask-control-row">
                  <span>宽度</span>
                  <div className="mask-control-content">
                    <div className="mask-slider-field">
                      <MaskSlider
                        value={activeMask.height}
                        minimum={1}
                        maximum={canvasSize.height * 2}
                        onChange={(height, pushHistory) =>
                          setDimension('height', height, pushHistory)
                        }
                      />
                      <MaskNumberInput
                        value={activeMask.height}
                        minimum={1}
                        maximum={canvasSize.height * 2}
                        onChange={(height, pushHistory) =>
                          setDimension('height', height, pushHistory)
                        }
                      />
                    </div>
                    <MaskKeyframeControl
                      editor={editor}
                      element={element}
                      mask={baseActiveMask}
                      property="size"
                      label="宽度"
                      onToggle={() => toggleKeyframe('size')}
                    />
                  </div>
                </div>
              )}

              <div className="mask-control-row">
                <span>羽化</span>
                <div className="mask-control-content">
                  <div className="mask-slider-field">
                    <MaskSlider
                      value={activeMask.feather}
                      minimum={0}
                      maximum={Math.max(
                        100,
                        Math.round(Math.min(canvasSize.width, canvasSize.height) / 3)
                      )}
                      onChange={(feather, pushHistory) =>
                        updateActiveProperty('feather', feather, pushHistory)
                      }
                    />
                    <MaskNumberInput
                      value={activeMask.feather}
                      minimum={0}
                      maximum={Math.max(canvasSize.width, canvasSize.height)}
                      onChange={(feather, pushHistory) =>
                        updateActiveProperty('feather', feather, pushHistory)
                      }
                    />
                  </div>
                  <MaskKeyframeControl
                    editor={editor}
                    element={element}
                    mask={baseActiveMask}
                    property="feather"
                    label="羽化"
                    onToggle={() => toggleKeyframe('feather')}
                  />
                </div>
              </div>

              <div className="mask-toggle-row">
                <span>反转蒙版</span>
                <Switch
                  checked={activeMask.inverted}
                  aria-label={activeMask.inverted ? '关闭反转蒙版' : '开启反转蒙版'}
                  onCheckedChange={(inverted) => updateActive({ inverted })}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
