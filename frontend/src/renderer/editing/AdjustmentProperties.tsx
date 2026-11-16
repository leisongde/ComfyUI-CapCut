import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import type { ImageElement, TimelineElement, VideoElement } from '@/types/timeline'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CopyCheck,
  Diamond,
  Pencil,
  Pipette,
  Plus,
  Save,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { useEditor } from '@/hooks/use-editor'
import { usePlaybackTime } from './playback-time'
import {
  createNeutralColorAdjustment,
  findColorAdjustmentKeyframeAtTime,
  getNeighborColorAdjustmentKeyframe,
  normalizeColorAdjustment,
  resolveColorAdjustment,
  toggleColorAdjustmentKeyframe,
  updateColorAdjustmentParameter,
  type AdjustmentCurvePoint,
  type BasicAdjustmentParameter,
  type ColorAdjustment,
  type ColorWheelValue,
  type HslBandId,
  type HslCurveId,
  type RgbCurveId
} from './color-adjustment'
import {
  MAX_COLOR_ADJUSTMENT_PRESETS,
  buildColorAdjustmentVideoUpdates,
  createColorAdjustmentPreset,
  createColorAdjustmentPresetSnapshot,
  readColorAdjustmentPresets,
  renameColorAdjustmentPreset,
  updateColorAdjustmentPreset,
  writeColorAdjustmentPresets,
  type ColorAdjustmentPreset
} from './color-adjustment-presets'
import { isAdjustmentElement } from './adjustment-layer'
import { ClipEffectsProperties } from './ClipEffectsProperties'
import { ColorAdjustmentMaskProperties } from './ColorAdjustmentMaskProperties'

type AdjustmentElement = (VideoElement | ImageElement) & {
  colorAdjustment?: unknown
  colorAdjustmentMask?: unknown
  colorAdjustmentCustomMask?: unknown
}

type AdjustmentTab = 'basic' | 'hsl' | 'curves' | 'wheels' | 'mask'

const TABS: ReadonlyArray<{ id: AdjustmentTab; label: string }> = [
  { id: 'basic', label: '基础' },
  { id: 'hsl', label: 'HSL' },
  { id: 'curves', label: '曲线' },
  { id: 'wheels', label: '色轮' },
  { id: 'mask', label: '蒙版' }
]

type BasicControl = {
  key: BasicAdjustmentParameter
  label: string
  minimum: number
  maximum: number
}

const BASIC_CONTROLS: readonly BasicControl[] = [
  { key: 'temperature', label: '色温', minimum: -100, maximum: 100 },
  { key: 'tint', label: '色调', minimum: -100, maximum: 100 },
  { key: 'saturation', label: '饱和度', minimum: -100, maximum: 100 },
  { key: 'vibrance', label: '自然饱和度', minimum: -100, maximum: 100 },
  { key: 'brightness', label: '亮度', minimum: -100, maximum: 100 },
  { key: 'contrast', label: '对比度', minimum: -100, maximum: 100 },
  { key: 'highlights', label: '高光', minimum: -100, maximum: 100 },
  { key: 'shadows', label: '阴影', minimum: -100, maximum: 100 },
  { key: 'whites', label: '白色', minimum: -100, maximum: 100 },
  { key: 'blacks', label: '黑色', minimum: -100, maximum: 100 },
  { key: 'brilliance', label: '光感', minimum: -100, maximum: 100 },
  { key: 'sharpen', label: '锐化', minimum: 0, maximum: 100 },
  { key: 'clarity', label: '清晰度', minimum: 0, maximum: 100 },
  { key: 'grain', label: '颗粒', minimum: 0, maximum: 100 },
  { key: 'fade', label: '褪色', minimum: 0, maximum: 100 },
  { key: 'vignette', label: '暗角', minimum: 0, maximum: 100 }
]

const HSL_BANDS: ReadonlyArray<{ id: HslBandId; label: string; color: string }> = [
  { id: 'red', label: '红', color: '#ef4444' },
  { id: 'orange', label: '橙', color: '#f97316' },
  { id: 'yellow', label: '黄', color: '#eab308' },
  { id: 'green', label: '绿', color: '#22c55e' },
  { id: 'cyan', label: '青', color: '#06b6d4' },
  { id: 'blue', label: '蓝', color: '#3b82f6' },
  { id: 'purple', label: '紫', color: '#8b5cf6' },
  { id: 'magenta', label: '洋红', color: '#ec4899' }
]

const RGB_CURVES: ReadonlyArray<{ id: RgbCurveId; label: string; color: string }> = [
  { id: 'master', label: '主曲线', color: '#e5e7eb' },
  { id: 'red', label: '红', color: '#ef4444' },
  { id: 'green', label: '绿', color: '#22c55e' },
  { id: 'blue', label: '蓝', color: '#3b82f6' }
]

const HSL_CURVES: ReadonlyArray<{ id: HslCurveId; label: string; color: string }> = [
  { id: 'hueHue', label: '色相 - 色相', color: '#f97316' },
  { id: 'hueSaturation', label: '色相 - 饱和度', color: '#22c55e' },
  { id: 'hueLightness', label: '色相 - 亮度', color: '#eab308' },
  { id: 'lightnessSaturation', label: '亮度 - 饱和度', color: '#06b6d4' },
  { id: 'saturationSaturation', label: '饱和度 - 饱和度', color: '#8b5cf6' },
  { id: 'saturationLightness', label: '饱和度 - 亮度', color: '#ec4899' }
]

const WHEEL_LABELS = {
  lift: '暗部',
  gamma: '中间调',
  gain: '亮部',
  offset: '全局',
  shadow: '阴影',
  midtone: '中间调',
  highlight: '高光'
} as const

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))
const displayValue = (value: number): number => Math.round(value * 100)
const modelValue = (value: number): number => value / 100
const clonePoints = (points: AdjustmentCurvePoint[]): AdjustmentCurvePoint[] =>
  points.map((point) => ({ ...point }))

function KeyframeControl({
  editor,
  source,
  adjustment,
  path,
  label,
  onToggle
}: {
  editor: ReturnType<typeof useEditor>
  source: AdjustmentElement
  adjustment: ColorAdjustment
  path: string
  label: string
  onToggle(): void
}) {
  const timelineTime = editor.playback.getCurrentTime()
  const isActive =
    findColorAdjustmentKeyframeAtTime({ source, adjustment, path, timelineTime }) >= 0
  const previous = getNeighborColorAdjustmentKeyframe({
    source,
    adjustment,
    path,
    timelineTime,
    direction: 'previous'
  })
  const next = getNeighborColorAdjustmentKeyframe({
    source,
    adjustment,
    path,
    timelineTime,
    direction: 'next'
  })
  const seek = (time: number | undefined) => {
    if (time !== undefined) editor.playback.seek({ time: source.startTime + time })
  }

  return (
    <span className="adjustment-keyframe-control">
      <button type="button" title={`上一个${label}关键帧`} disabled={!previous} onClick={() => seek(previous?.time)}>
        <ChevronLeft size={12} />
      </button>
      <button
        type="button"
        className={isActive ? 'active' : ''}
        title={isActive ? `删除当前${label}关键帧` : `添加${label}关键帧`}
        onClick={onToggle}
      >
        <Diamond size={10} className={isActive ? 'fill-current' : ''} />
      </button>
      <button type="button" title={`下一个${label}关键帧`} disabled={!next} onClick={() => seek(next?.time)}>
        <ChevronRight size={12} />
      </button>
    </span>
  )
}

function AdjustmentControl({
  label,
  value,
  minimum,
  maximum,
  disabled,
  neutral = 0,
  keyframe,
  onBegin,
  onPreview,
  onCommit,
  onReset
}: {
  label: string
  value: number
  minimum: number
  maximum: number
  disabled?: boolean
  neutral?: number
  keyframe?: ReactNode
  onBegin(): void
  onPreview(value: number): void
  onCommit(value: number): void
  onReset(): void
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100))
  const dragging = useRef(false)
  const editingNumber = useRef(false)
  useEffect(() => {
    if (!editingNumber.current) setDraft(String(Math.round(value * 100) / 100))
  }, [value])

  const commitDraft = () => {
    const parsed = Number.parseFloat(draft)
    const next = clamp(Number.isFinite(parsed) ? parsed : value, minimum, maximum)
    editingNumber.current = false
    setDraft(String(Math.round(next * 100) / 100))
    if (Math.abs(next - value) > 0.0001) onCommit(next)
  }

  return (
    <div className="adjustment-control">
      <div className="adjustment-control-label">
        <span>{label}</span>
        {keyframe}
      </div>
      <div className="adjustment-control-input">
        <input
          type="range"
          min={minimum}
          max={maximum}
          step={1}
          value={clamp(value, minimum, maximum)}
          aria-label={label}
          disabled={disabled}
          onPointerDown={() => {
            dragging.current = true
            onBegin()
          }}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (dragging.current) onPreview(next)
            else onCommit(next)
          }}
          onPointerUp={(event) => {
            if (!dragging.current) return
            dragging.current = false
            onCommit(Number(event.currentTarget.value))
          }}
          onPointerCancel={() => {
            dragging.current = false
          }}
        />
        <input
          className="adjustment-number-input"
          type="number"
          min={minimum}
          max={maximum}
          value={draft}
          disabled={disabled}
          aria-label={`${label}数值`}
          onFocus={() => {
            editingNumber.current = true
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        <button
          type="button"
          title={`重置${label}`}
          disabled={disabled || Math.abs(value - neutral) < 0.0001}
          onClick={onReset}
        >
          <RotateCcw size={12} />
        </button>
      </div>
    </div>
  )
}

function CurveEditor({
  points,
  color,
  middle,
  disabled,
  onChange
}: {
  points: AdjustmentCurvePoint[]
  color: string
  middle: boolean
  disabled?: boolean
  onChange(points: AdjustmentCurvePoint[], pushHistory: boolean): void
}) {
  const active = useRef<number | null>(null)
  const initial = useRef<AdjustmentCurvePoint[] | null>(null)
  const latest = useRef(points)
  const path = points.map((point) => `${point.x * 240},${(1 - point.y) * 160}`).join(' ')
  const eventPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
      y: clamp(1 - (event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1)
    }
  }

  return (
    <svg
      className={`adjustment-curve-editor ${disabled ? 'disabled' : ''}`}
      viewBox="0 0 240 160"
      preserveAspectRatio="none"
      aria-label="曲线编辑器"
      onPointerDown={(event) => {
        if (disabled) return
        const pointIndex = Number((event.target as SVGElement).dataset.curvePoint)
        initial.current = clonePoints(points)
        latest.current = clonePoints(points)
        if (Number.isInteger(pointIndex)) active.current = pointIndex
        else {
          const point = eventPoint(event)
          const next = [...latest.current, point].sort((left, right) => left.x - right.x)
          latest.current = next
          active.current = next.indexOf(point)
          onChange(next, false)
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (active.current === null || disabled) return
        const index = active.current
        const next = clonePoints(latest.current)
        const point = eventPoint(event)
        const endpoint = index === 0 || index === next.length - 1
        const updated = { x: endpoint ? next[index].x : point.x, y: point.y }
        next[index] = updated
        next.sort((left, right) => left.x - right.x)
        latest.current = next
        active.current = next.indexOf(updated)
        onChange(next, false)
      }}
      onPointerUp={(event) => {
        if (active.current === null) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        const start = initial.current
        const finish = clonePoints(latest.current)
        active.current = null
        initial.current = null
        if (start) onChange(start, false)
        onChange(finish, true)
      }}
      onPointerCancel={() => {
        active.current = null
        initial.current = null
      }}
    >
      <rect width="240" height="160" fill="transparent" />
      {[0.25, 0.5, 0.75].map((position) => (
        <g key={position}>
          <line x1={position * 240} y1="0" x2={position * 240} y2="160" />
          <line x1="0" y1={(1 - position) * 160} x2="240" y2={(1 - position) * 160} />
        </g>
      ))}
      <line className="curve-reference" x1="0" y1={middle ? 80 : 160} x2="240" y2={middle ? 80 : 0} />
      <polyline points={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {points.map((point, index) => (
        <circle
          key={`${index}-${point.x}-${point.y}`}
          data-curve-point={index}
          cx={point.x * 240}
          cy={(1 - point.y) * 160}
          r="4"
          fill={color}
          stroke="#111827"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          onDoubleClick={(event) => {
            event.stopPropagation()
            if (index === 0 || index === points.length - 1 || disabled) return
            onChange(points.filter((_, pointIndex) => pointIndex !== index), true)
          }}
        />
      ))}
    </svg>
  )
}

function ColorWheel({
  label,
  value,
  disabled,
  onBegin,
  onPreview,
  onCommit
}: {
  label: string
  value: ColorWheelValue
  disabled?: boolean
  onBegin(): void
  onPreview(value: ColorWheelValue): void
  onCommit(value: ColorWheelValue): void
}) {
  const dragging = useRef(false)
  const latest = useRef(value)
  const point = (event: ReactPointerEvent<HTMLDivElement>): ColorWheelValue => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5
    const y = (event.clientY - bounds.top) / Math.max(1, bounds.height) - 0.5
    return {
      ...value,
      hue: (((Math.atan2(y, x) * 180) / Math.PI + 90 + 360) % 360) - 180,
      saturation: clamp(Math.hypot(x, y) * 2, 0, 1)
    }
  }
  const markerAngle = ((value.hue + 90) * Math.PI) / 180
  const markerRadius = value.saturation * 50

  return (
    <div className={`adjustment-wheel ${disabled ? 'disabled' : ''}`}>
      <strong>{label}</strong>
      <div
        className="adjustment-wheel-face"
        role="slider"
        aria-label={`${label}色轮`}
        aria-valuetext={`色相 ${Math.round(value.hue)}，饱和度 ${Math.round(value.saturation * 100)}`}
        onPointerDown={(event) => {
          if (disabled) return
          dragging.current = true
          onBegin()
          const next = point(event)
          latest.current = next
          onPreview(next)
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!dragging.current || disabled) return
          const next = point(event)
          latest.current = next
          onPreview(next)
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return
          dragging.current = false
          event.currentTarget.releasePointerCapture(event.pointerId)
          onCommit(latest.current)
        }}
      >
        <span
          style={{
            left: `${50 + Math.cos(markerAngle) * markerRadius}%`,
            top: `${50 + Math.sin(markerAngle) * markerRadius}%`
          }}
        />
      </div>
    </div>
  )
}

export function AdjustmentProperties({
  element: rawElement,
  trackId
}: {
  element: TimelineElement
  trackId: string
}) {
  const editor = useEditor()
  const timelineTime = usePlaybackTime(editor.playback)
  const [tab, setTab] = useState<AdjustmentTab>('basic')
  const [hslBand, setHslBand] = useState<HslBandId>('red')
  const [curveFamily, setCurveFamily] = useState<'rgb' | 'hsl'>('rgb')
  const [rgbCurve, setRgbCurve] = useState<RgbCurveId>('master')
  const [hslCurve, setHslCurve] = useState<HslCurveId>('hueHue')
  const [wheelFamily, setWheelFamily] = useState<'primary' | 'log'>('primary')
  const [customColor, setCustomColor] = useState('#ef4444')
  const [presets, setPresets] = useState<ColorAdjustmentPreset[]>(readColorAdjustmentPresets)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [presetEditor, setPresetEditor] = useState<'create' | 'rename' | null>(null)
  const [presetName, setPresetName] = useState('')
  const drag = useRef<{ path: string; snapshot: ColorAdjustment } | null>(null)
  const wheelDrag = useRef<ColorAdjustment | null>(null)

  if (rawElement.type !== 'video' && rawElement.type !== 'image') return null
  const element = rawElement as AdjustmentElement
  const adjustment = normalizeColorAdjustment(element.colorAdjustment)
  const resolved = resolveColorAdjustment({ source: element, timelineTime })

  const save = (next: ColorAdjustment, pushHistory = true) => {
    editor.timeline.updateElements({
      updates: [{ trackId, elementId: element.id, updates: { colorAdjustment: next } }],
      pushHistory
    })
  }
  const updatePathFrom = (base: ColorAdjustment, path: string, value: number) =>
    updateColorAdjustmentParameter({
      source: { ...element, colorAdjustment: base },
      adjustment: base,
      path,
      timelineTime,
      value
    })
  const beginPath = (path: string) => {
    drag.current = { path, snapshot: normalizeColorAdjustment(element.colorAdjustment) }
  }
  const previewPath = (path: string, value: number) =>
    save(updatePathFrom(normalizeColorAdjustment(element.colorAdjustment), path, value), false)
  const commitPath = (path: string, value: number) => {
    const transaction = drag.current?.path === path ? drag.current : null
    drag.current = null
    const base = transaction?.snapshot ?? normalizeColorAdjustment(element.colorAdjustment)
    if (transaction) save(base, false)
    save(updatePathFrom(base, path, value), true)
  }
  const toggleKeyframe = (path: string) =>
    save(toggleColorAdjustmentKeyframe({ source: element, adjustment, path, timelineTime }))
  const keyframeFor = (path: string, label: string) => (
    <KeyframeControl
      editor={editor}
      source={element}
      adjustment={adjustment}
      path={path}
      label={label}
      onToggle={() => toggleKeyframe(path)}
    />
  )
  const renderPathControl = (input: {
    path: string
    label: string
    value: number
    minimum?: number
    maximum?: number
    neutral?: number
    keyed?: boolean
  }) => (
    <AdjustmentControl
      key={input.path}
      label={input.label}
      value={input.value}
      minimum={input.minimum ?? -100}
      maximum={input.maximum ?? 100}
      neutral={input.neutral ?? 0}
      disabled={!adjustment.enabled}
      keyframe={input.keyed === false ? undefined : keyframeFor(input.path, input.label)}
      onBegin={() => beginPath(input.path)}
      onPreview={(value) => previewPath(input.path, modelValue(value))}
      onCommit={(value) => commitPath(input.path, modelValue(value))}
      onReset={() => commitPath(input.path, modelValue(input.neutral ?? 0))}
    />
  )
  const replaceCurves = (
    family: 'rgb' | 'hsl',
    id: RgbCurveId | HslCurveId,
    points: AdjustmentCurvePoint[],
    pushHistory: boolean
  ) => {
    const current = normalizeColorAdjustment(element.colorAdjustment)
    save(
      {
        ...current,
        curves: { ...current.curves, [family]: { ...current.curves[family], [id]: points } }
      },
      pushHistory
    )
  }
  const updateWheel = (
    family: 'primaryWheels' | 'logWheels',
    wheel: 'lift' | 'gamma' | 'gain' | 'offset' | 'shadow' | 'midtone' | 'highlight',
    value: ColorWheelValue,
    base?: ColorAdjustment,
    pushHistory = false
  ) => {
    let next = base ?? normalizeColorAdjustment(element.colorAdjustment)
    next = updatePathFrom(next, `${family}.${wheel}.hue`, value.hue)
    next = updatePathFrom(next, `${family}.${wheel}.saturation`, value.saturation)
    save(next, pushHistory)
  }
  const pickScreenColor = async () => {
    const Picker = (window as typeof window & {
      EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> }
    }).EyeDropper
    if (!Picker) return
    try {
      setCustomColor((await new Picker().open()).sRGBHex)
    } catch {
      // The native picker rejects when the user cancels.
    }
  }
  const addCustomBand = () => {
    if (adjustment.customHsl.length >= 10) return
    save({
      ...adjustment,
      customHsl: [
        ...adjustment.customHsl,
        {
          id: `custom-hsl-${Date.now().toString(36)}`,
          color: customColor,
          hue: 0,
          saturation: 0,
          lightness: 0
        }
      ]
    })
  }
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId)
  const videoUpdates = buildColorAdjustmentVideoUpdates(editor.timeline.getTracks(), resolved)
  const persistPresets = (next: ColorAdjustmentPreset[]) => {
    try {
      const saved = writeColorAdjustmentPresets(next)
      setPresets(saved)
      return saved
    } catch {
      toast.error('调色预设保存失败')
      return null
    }
  }
  const nameExists = (name: string, excludedId?: string) =>
    presets.some(
      (preset) => preset.id !== excludedId && preset.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase()
    )
  const openCreatePreset = () => {
    if (presets.length >= MAX_COLOR_ADJUSTMENT_PRESETS) {
      toast.error(`最多保存 ${MAX_COLOR_ADJUSTMENT_PRESETS} 个调色预设`)
      return
    }
    setPresetName(`调色预设 ${presets.length + 1}`)
    setPresetEditor('create')
  }
  const openRenamePreset = () => {
    if (!selectedPreset) return
    setPresetName(selectedPreset.name)
    setPresetEditor('rename')
  }
  const commitPresetEditor = () => {
    const name = presetName.trim()
    if (!name) {
      toast.error('请输入预设名称')
      return
    }
    if (nameExists(name, presetEditor === 'rename' ? selectedPreset?.id : undefined)) {
      toast.error('已有同名调色预设')
      return
    }
    if (presetEditor === 'create') {
      const created = createColorAdjustmentPreset({ name, adjustment: resolved })
      if (!persistPresets([created, ...presets])) return
      setSelectedPresetId(created.id)
      toast.success('已保存调色预设')
    } else if (presetEditor === 'rename' && selectedPreset) {
      const renamed = renameColorAdjustmentPreset(selectedPreset, name)
      if (!persistPresets(presets.map((preset) => (preset.id === renamed.id ? renamed : preset)))) return
      toast.success('预设已重命名')
    }
    setPresetEditor(null)
    setPresetName('')
  }
  const applyPreset = (presetId: string) => {
    setSelectedPresetId(presetId)
    const preset = presets.find((item) => item.id === presetId)
    if (!preset) return
    save(createColorAdjustmentPresetSnapshot(preset.adjustment))
    toast.success(`已应用“${preset.name}”`)
  }
  const overwritePreset = () => {
    if (!selectedPreset) return
    if (!window.confirm(`使用当前调色覆盖“${selectedPreset.name}”？`)) return
    const updated = updateColorAdjustmentPreset(selectedPreset, resolved)
    if (!persistPresets(presets.map((preset) => (preset.id === updated.id ? updated : preset)))) return
    toast.success('预设已更新')
  }
  const deletePreset = () => {
    if (!selectedPreset) return
    if (!window.confirm(`删除调色预设“${selectedPreset.name}”？`)) return
    if (!persistPresets(presets.filter((preset) => preset.id !== selectedPreset.id))) return
    setSelectedPresetId('')
    setPresetEditor(null)
    toast.success('预设已删除')
  }
  const applyToAllVideos = () => {
    if (!videoUpdates.length) {
      toast.info('当前工程没有视频片段')
      return
    }
    editor.timeline.updateElements({ updates: videoUpdates })
    toast.success(`已应用到 ${videoUpdates.length} 个视频片段`)
  }

  return (
    <div className="adjustment-properties">
      <header className="adjustment-properties-header">
        <div>
          <SlidersHorizontal size={15} />
          <strong>{isAdjustmentElement(element) ? '调节层' : '调整'}</strong>
        </div>
        <div className="adjustment-header-actions">
          <label className="adjustment-enable-switch" title="启用调整">
            <input
              type="checkbox"
              checked={adjustment.enabled}
              onChange={(event) => save({ ...adjustment, enabled: event.target.checked })}
            />
            <span />
          </label>
          <button type="button" title="全部重置" onClick={() => save(createNeutralColorAdjustment())}>
            <RotateCcw size={13} />
          </button>
        </div>
      </header>

      <div className="adjustment-tabs" role="tablist" aria-label="调整分类">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="adjustment-panel-body">
        {tab === 'basic' && (
          <div className="adjustment-section">
            <div className="adjustment-preset-tools">
              <div className="adjustment-preset-row">
                <select
                  aria-label="调色预设"
                  value={selectedPresetId}
                  onChange={(event) => applyPreset(event.target.value)}
                >
                  <option value="">选择调色预设</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                  ))}
                </select>
                <button type="button" title="保存为新预设" onClick={openCreatePreset}>
                  <Save size={13} />
                </button>
                <button type="button" title="更新当前预设" disabled={!selectedPreset} onClick={overwritePreset}>
                  <Check size={13} />
                </button>
                <button type="button" title="重命名当前预设" disabled={!selectedPreset} onClick={openRenamePreset}>
                  <Pencil size={13} />
                </button>
                <button type="button" title="删除当前预设" disabled={!selectedPreset} onClick={deletePreset}>
                  <Trash2 size={13} />
                </button>
              </div>
              {presetEditor && (
                <div className="adjustment-preset-editor">
                  <input
                    autoFocus
                    aria-label="预设名称"
                    maxLength={40}
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitPresetEditor()
                      if (event.key === 'Escape') setPresetEditor(null)
                    }}
                  />
                  <button type="button" title="确认" onClick={commitPresetEditor}>
                    <Check size={13} />
                  </button>
                  <button type="button" title="取消" onClick={() => setPresetEditor(null)}>
                    <X size={13} />
                  </button>
                </div>
              )}
              <button type="button" className="adjustment-apply-all" onClick={applyToAllVideos}>
                <CopyCheck size={13} />
                <span>应用到全部视频</span>
                <b>{videoUpdates.length}</b>
              </button>
            </div>
            <div className="adjustment-divider" />
            <AdjustmentControl
              label="强度"
              value={displayValue(adjustment.intensity)}
              minimum={0}
              maximum={100}
              neutral={100}
              onBegin={() => {
                drag.current = { path: 'intensity', snapshot: adjustment }
              }}
              onPreview={(value) =>
                save(
                  { ...normalizeColorAdjustment(element.colorAdjustment), intensity: modelValue(value) },
                  false
                )
              }
              onCommit={(value) => {
                const base = drag.current?.path === 'intensity' ? drag.current.snapshot : adjustment
                drag.current = null
                save(base, false)
                save({ ...base, intensity: modelValue(value) })
              }}
              onReset={() => save({ ...adjustment, intensity: 1 })}
            />
            <div className="adjustment-divider" />
            {BASIC_CONTROLS.map((control) =>
              renderPathControl({
                path: `basic.${control.key}`,
                label: control.label,
                value: displayValue(resolved.basic[control.key]),
                minimum: control.minimum,
                maximum: control.maximum
              })
            )}
            {isAdjustmentElement(element) && (
              <ClipEffectsProperties element={element} trackId={trackId} title="叠加特效" />
            )}
          </div>
        )}

        {tab === 'hsl' && (
          <div className="adjustment-section">
            <div className="adjustment-hsl-swatches" role="tablist" aria-label="HSL 颜色">
              {HSL_BANDS.map((band) => (
                <button
                  key={band.id}
                  type="button"
                  role="tab"
                  aria-selected={hslBand === band.id}
                  className={hslBand === band.id ? 'active' : ''}
                  title={band.label}
                  onClick={() => setHslBand(band.id)}
                >
                  <span style={{ background: band.color }} />
                  {band.label}
                </button>
              ))}
            </div>
            <div className="adjustment-divider" />
            {(['hue', 'saturation', 'lightness'] as const).map((component) => {
              const labels = { hue: '色相', saturation: '饱和度', lightness: '亮度' }
              const path = `hsl.${hslBand}.${component}`
              return renderPathControl({
                path,
                label: labels[component],
                value: displayValue(resolved.hsl[hslBand][component])
              })
            })}
            <div className="adjustment-subheading">
              <span>自定义颜色</span>
              <div>
                <button type="button" title="屏幕取色" onClick={() => void pickScreenColor()}>
                  <Pipette size={13} />
                </button>
                <label className="adjustment-color-input" title="选择颜色">
                  <input type="color" value={customColor} onChange={(event) => setCustomColor(event.target.value)} />
                  <span style={{ background: customColor }} />
                </label>
                <button type="button" title="添加自定义颜色" disabled={adjustment.customHsl.length >= 10} onClick={addCustomBand}>
                  <Plus size={13} />
                </button>
              </div>
            </div>
            {adjustment.customHsl.map((band, index) => (
              <div className="adjustment-custom-hsl" key={band.id}>
                <div className="adjustment-custom-hsl-header">
                  <span style={{ background: band.color }} />
                  <strong>自定义 {index + 1}</strong>
                  <button
                    type="button"
                    title="删除自定义颜色"
                    onClick={() =>
                      save({
                        ...adjustment,
                        customHsl: adjustment.customHsl.filter((item) => item.id !== band.id)
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {(['hue', 'saturation', 'lightness'] as const).map((component) => (
                  <AdjustmentControl
                    key={component}
                    label={{ hue: '色相', saturation: '饱和度', lightness: '亮度' }[component]}
                    value={displayValue(band[component])}
                    minimum={-100}
                    maximum={100}
                    disabled={!adjustment.enabled}
                    onBegin={() => {}}
                    onPreview={() => {}}
                    onCommit={(value) => {
                      const current = normalizeColorAdjustment(element.colorAdjustment)
                      save({
                        ...current,
                        customHsl: current.customHsl.map((item) =>
                          item.id === band.id ? { ...item, [component]: modelValue(value) } : item
                        )
                      })
                    }}
                    onReset={() =>
                      save({
                        ...adjustment,
                        customHsl: adjustment.customHsl.map((item) =>
                          item.id === band.id ? { ...item, [component]: 0 } : item
                        )
                      })
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {tab === 'curves' && (
          <div className="adjustment-section">
            <div className="color-adjustment-subtabs" role="tablist" aria-label="曲线类型">
              <button type="button" className={curveFamily === 'rgb' ? 'active' : ''} onClick={() => setCurveFamily('rgb')}>
                RGB 曲线
              </button>
              <button type="button" className={curveFamily === 'hsl' ? 'active' : ''} onClick={() => setCurveFamily('hsl')}>
                HSL 曲线
              </button>
            </div>
            {curveFamily === 'rgb' ? (
              <>
                <div className="adjustment-curve-channels">
                  {RGB_CURVES.map((curve) => (
                    <button key={curve.id} type="button" className={rgbCurve === curve.id ? 'active' : ''} onClick={() => setRgbCurve(curve.id)}>
                      <span style={{ background: curve.color }} />
                      {curve.label}
                    </button>
                  ))}
                </div>
                <CurveEditor
                  points={adjustment.curves.rgb[rgbCurve]}
                  color={RGB_CURVES.find((curve) => curve.id === rgbCurve)!.color}
                  middle={false}
                  disabled={!adjustment.enabled}
                  onChange={(points, pushHistory) => replaceCurves('rgb', rgbCurve, points, pushHistory)}
                />
              </>
            ) : (
              <>
                <select className="adjustment-curve-select" value={hslCurve} onChange={(event) => setHslCurve(event.target.value as HslCurveId)}>
                  {HSL_CURVES.map((curve) => <option key={curve.id} value={curve.id}>{curve.label}</option>)}
                </select>
                <CurveEditor
                  points={adjustment.curves.hsl[hslCurve]}
                  color={HSL_CURVES.find((curve) => curve.id === hslCurve)!.color}
                  middle
                  disabled={!adjustment.enabled}
                  onChange={(points, pushHistory) => replaceCurves('hsl', hslCurve, points, pushHistory)}
                />
              </>
            )}
            <button
              type="button"
              className="adjustment-reset-section"
              onClick={() => save({ ...adjustment, curves: createNeutralColorAdjustment().curves })}
            >
              <RotateCcw size={13} /> 重置全部曲线
            </button>
          </div>
        )}

        {tab === 'wheels' && (
          <div className="adjustment-section">
            <div className="color-adjustment-subtabs" role="tablist" aria-label="色轮类型">
              <button type="button" className={wheelFamily === 'primary' ? 'active' : ''} onClick={() => setWheelFamily('primary')}>
                一级色轮
              </button>
              <button type="button" className={wheelFamily === 'log' ? 'active' : ''} onClick={() => setWheelFamily('log')}>
                Log 色轮
              </button>
            </div>
            {wheelFamily === 'primary' ? (
              <>
                <label className="adjustment-toggle-row">
                  <span>启用一级色轮</span>
                  <input
                    type="checkbox"
                    checked={adjustment.primaryWheels.enabled}
                    onChange={(event) => save({ ...adjustment, primaryWheels: { ...adjustment.primaryWheels, enabled: event.target.checked } })}
                  />
                </label>
                <div className="adjustment-wheel-grid">
                  {(['lift', 'gamma', 'gain', 'offset'] as const).map((wheel) => (
                    <div className="adjustment-wheel-block" key={wheel}>
                      <ColorWheel
                        label={WHEEL_LABELS[wheel]}
                        value={resolved.primaryWheels[wheel]}
                        disabled={!adjustment.enabled || !adjustment.primaryWheels.enabled}
                        onBegin={() => {
                          wheelDrag.current = normalizeColorAdjustment(element.colorAdjustment)
                        }}
                        onPreview={(value) => updateWheel('primaryWheels', wheel, value)}
                        onCommit={(value) => {
                          const base = wheelDrag.current ?? adjustment
                          wheelDrag.current = null
                          save(base, false)
                          updateWheel('primaryWheels', wheel, value, base, true)
                        }}
                      />
                      {renderPathControl({
                        path: `primaryWheels.${wheel}.luminance`,
                        label: '明度',
                        value: displayValue(resolved.primaryWheels[wheel].luminance)
                      })}
                    </div>
                  ))}
                </div>
                {renderPathControl({
                  path: 'primaryWheels.lumaMix',
                  label: '亮度混合',
                  value: displayValue(resolved.primaryWheels.lumaMix),
                  minimum: 0,
                  maximum: 100,
                  neutral: 100,
                  keyed: false
                })}
              </>
            ) : (
              <>
                <label className="adjustment-toggle-row">
                  <span>启用 Log 色轮</span>
                  <input
                    type="checkbox"
                    checked={adjustment.logWheels.enabled}
                    onChange={(event) => save({ ...adjustment, logWheels: { ...adjustment.logWheels, enabled: event.target.checked } })}
                  />
                </label>
                <div className="adjustment-wheel-grid">
                  {(['shadow', 'midtone', 'highlight', 'offset'] as const).map((wheel) => (
                    <div className="adjustment-wheel-block" key={wheel}>
                      <ColorWheel
                        label={WHEEL_LABELS[wheel]}
                        value={resolved.logWheels[wheel]}
                        disabled={!adjustment.enabled || !adjustment.logWheels.enabled}
                        onBegin={() => {
                          wheelDrag.current = normalizeColorAdjustment(element.colorAdjustment)
                        }}
                        onPreview={(value) => updateWheel('logWheels', wheel, value)}
                        onCommit={(value) => {
                          const base = wheelDrag.current ?? adjustment
                          wheelDrag.current = null
                          save(base, false)
                          updateWheel('logWheels', wheel, value, base, true)
                        }}
                      />
                      {renderPathControl({
                        path: `logWheels.${wheel}.luminance`,
                        label: '明度',
                        value: displayValue(resolved.logWheels[wheel].luminance)
                      })}
                    </div>
                  ))}
                </div>
                {renderPathControl({
                  path: 'logWheels.shadowRange',
                  label: '阴影范围',
                  value: displayValue(resolved.logWheels.shadowRange),
                  minimum: 5,
                  maximum: 90,
                  neutral: 33,
                  keyed: false
                })}
                {renderPathControl({
                  path: 'logWheels.highlightRange',
                  label: '高光范围',
                  value: displayValue(resolved.logWheels.highlightRange),
                  minimum: 10,
                  maximum: 95,
                  neutral: 55,
                  keyed: false
                })}
              </>
            )}
          </div>
        )}

        {tab === 'mask' && <ColorAdjustmentMaskProperties element={element} trackId={trackId} />}
      </div>
    </div>
  )
}
