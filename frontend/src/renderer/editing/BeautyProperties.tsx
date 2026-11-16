import { useRef, useState } from 'react'
import type { ImageElement, VideoElement } from '@/types/timeline'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useEditor } from '@/hooks/use-editor'
import { ChevronDown, RotateCcw } from 'lucide-react'
import {
  BEAUTY_SKIN_KEYS,
  BEAUTY_SKIN_TONES,
  DEFAULT_BEAUTY_SETTINGS,
  DEFAULT_FACE_SHAPE_SETTINGS,
  DEFAULT_FACIAL_FEATURE_SETTINGS,
  SIGNED_FACE_SHAPE_KEYS,
  SIGNED_FACIAL_FEATURE_KEYS,
  normalizeBeautySettings,
  type BeautySettings,
  type FaceShapeSettings,
  type FacialFeatureSettings
} from './beauty'

type BeautyElement = (VideoElement | ImageElement) & { beauty?: unknown }
type BeautySkinKey = (typeof BEAUTY_SKIN_KEYS)[number]
type FeatureCategory = 'eyes' | 'nose' | 'mouth' | 'brow'

const SKIN_CONTROLS: ReadonlyArray<{ key: BeautySkinKey; label: string }> = [
  { key: 'smooth', label: '磨皮' },
  { key: 'whiten', label: '美白' },
  { key: 'evenSkin', label: '匀肤' },
  { key: 'plump', label: '丰盈' },
  { key: 'blemish', label: '祛斑祛痘' },
  { key: 'nasolabial', label: '祛法令纹' },
  { key: 'darkCircles', label: '祛黑眼圈' },
  { key: 'clarity', label: '清晰' }
]

const FACE_SHAPE_CONTROLS: ReadonlyArray<{ key: keyof FaceShapeSettings; label: string }> = [
  { key: 'smoothFace', label: '流畅脸' },
  { key: 'smallFace', label: '小脸' },
  { key: 'slimFace', label: '瘦脸' },
  { key: 'narrowFace', label: '窄脸' },
  { key: 'jawline', label: '下颌线' },
  { key: 'jawbone', label: '下颌骨' },
  { key: 'cheekbone', label: '颧骨' },
  { key: 'shortFace', label: '短脸' },
  { key: 'vFace', label: 'V脸' },
  { key: 'chinLength', label: '下巴长短' }
]

const FEATURE_TABS: ReadonlyArray<{ id: FeatureCategory; label: string }> = [
  { id: 'eyes', label: '眼睛' },
  { id: 'nose', label: '鼻子' },
  { id: 'mouth', label: '嘴巴' },
  { id: 'brow', label: '眉毛' }
]

const FEATURE_CONTROLS: Record<
  FeatureCategory,
  ReadonlyArray<{ key: keyof FacialFeatureSettings; label: string }>
> = {
  eyes: [
    { key: 'bigEyes', label: '大眼' },
    { key: 'brightEyes', label: '亮眼' },
    { key: 'eyeDistance', label: '眼距' },
    { key: 'eyeCorner', label: '开眼角' },
    { key: 'eyeHeight', label: '眼高低' },
    { key: 'eyeTilt', label: '眼倾斜' }
  ],
  nose: [
    { key: 'noseSlim', label: '瘦鼻' },
    { key: 'noseWing', label: '鼻翼' },
    { key: 'noseTip', label: '鼻头' },
    { key: 'noseBridge', label: '山根' },
    { key: 'noseLength', label: '鼻子长短' }
  ],
  mouth: [
    { key: 'mouthSize', label: '嘴巴大小' },
    { key: 'mouthWidth', label: '嘴巴宽度' },
    { key: 'lipThickness', label: '嘴唇厚度' },
    { key: 'mouthCorner', label: '嘴角' },
    { key: 'philtrum', label: '人中长短' }
  ],
  brow: [
    { key: 'browHeight', label: '眉毛高低' },
    { key: 'browDistance', label: '眉间距' },
    { key: 'browTilt', label: '眉毛倾斜' },
    { key: 'browThickness', label: '眉毛粗细' }
  ]
}

function BeautySlider({
  value,
  label,
  signed = false,
  onChange
}: {
  value: number
  label: string
  signed?: boolean
  onChange: (value: number, pushHistory: boolean) => void
}) {
  const initial = useRef<number | null>(null)
  const percent = Math.round(value * 100)
  return (
    <div className="beauty-control-row">
      <span>{label}</span>
      <Slider
        value={[percent]}
        min={signed ? -100 : 0}
        max={100}
        step={1}
        aria-label={label}
        onValueChange={([next]) => {
          initial.current ??= value
          onChange(next / 100, false)
        }}
        onValueCommit={([next]) => {
          if (initial.current === null) return
          onChange(initial.current, false)
          onChange(next / 100, true)
          initial.current = null
        }}
        className="min-w-0 flex-1"
      />
      <output>{percent}</output>
    </div>
  )
}

function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
    >
      <RotateCcw className="size-3.5" />
    </button>
  )
}

export function BeautyProperties({
  element,
  trackId
}: {
  element: BeautyElement
  trackId: string
}) {
  const editor = useEditor()
  const [featureCategory, setFeatureCategory] = useState<FeatureCategory>('eyes')
  const settings = normalizeBeautySettings(element.beauty)

  const save = (beauty: BeautySettings, pushHistory = true) => {
    editor.timeline.updateElements({
      updates: [{ trackId, elementId: element.id, updates: { beauty } }],
      pushHistory
    })
  }

  const updateSkin = (key: BeautySkinKey, value: number, pushHistory: boolean) => {
    save({ ...settings, enabled: true, [key]: value }, pushHistory)
  }

  const updateFaceShape = (
    key: keyof FaceShapeSettings,
    value: number,
    pushHistory: boolean
  ) => {
    save(
      { ...settings, enabled: true, faceShape: { ...settings.faceShape, [key]: value } },
      pushHistory
    )
  }

  const updateFacialFeature = (
    key: keyof FacialFeatureSettings,
    value: number,
    pushHistory: boolean
  ) => {
    save(
      {
        ...settings,
        enabled: true,
        facialFeatures: { ...settings.facialFeatures, [key]: value }
      },
      pushHistory
    )
  }

  return (
    <div className="desktop-beauty-properties h-full overflow-y-auto">
      <div className="beauty-panel-header">
        <div>
          <strong>美颜</strong>
          <span>皮肤、脸型与五官</span>
        </div>
        <div className="beauty-header-actions">
          <ResetButton
            label="重置美颜"
            onClick={() =>
              save({
                ...DEFAULT_BEAUTY_SETTINGS,
                faceShape: { ...DEFAULT_FACE_SHAPE_SETTINGS },
                facialFeatures: { ...DEFAULT_FACIAL_FEATURE_SETTINGS }
              })
            }
          />
          <Switch
            checked={settings.enabled}
            aria-label={settings.enabled ? '关闭美颜' : '开启美颜'}
            onCheckedChange={(enabled) => save({ ...settings, enabled })}
          />
        </div>
      </div>

      <details className="beauty-collapsible" open>
        <summary>
          <span>皮肤管理</span>
          <ChevronDown className="beauty-chevron size-3.5" />
        </summary>
        <div className="beauty-section-body">
          <div className="beauty-controls">
            {SKIN_CONTROLS.map((control) => (
              <BeautySlider
                key={control.key}
                label={control.label}
                value={settings[control.key]}
                onChange={(value, pushHistory) => updateSkin(control.key, value, pushHistory)}
              />
            ))}
          </div>
          <span className="beauty-section-label">肤色</span>
          <div className="beauty-tone-swatches">
            {BEAUTY_SKIN_TONES.map((tone) => (
              <button
                key={tone.id}
                type="button"
                className={`${tone.id === 'none' ? 'none' : ''}${settings.skinTone === tone.id ? ' active' : ''}`}
                style={tone.color ? { backgroundColor: tone.color } : undefined}
                aria-label={tone.label}
                aria-pressed={settings.skinTone === tone.id}
                title={tone.label}
                onClick={() => save({ ...settings, enabled: true, skinTone: tone.id })}
              />
            ))}
          </div>
        </div>
      </details>

      <details className="beauty-collapsible" open>
        <summary>
          <span>脸型</span>
          <span className="beauty-summary-actions">
            <ResetButton
              label="重置脸型"
              onClick={() => save({ ...settings, faceShape: { ...DEFAULT_FACE_SHAPE_SETTINGS } })}
            />
            <ChevronDown className="beauty-chevron size-3.5" />
          </span>
        </summary>
        <div className="beauty-section-body">
          <div className="beauty-controls">
            {FACE_SHAPE_CONTROLS.map((control) => (
              <BeautySlider
                key={control.key}
                label={control.label}
                value={settings.faceShape[control.key]}
                signed={SIGNED_FACE_SHAPE_KEYS.has(control.key)}
                onChange={(value, pushHistory) =>
                  updateFaceShape(control.key, value, pushHistory)
                }
              />
            ))}
          </div>
        </div>
      </details>

      <details className="beauty-collapsible" open>
        <summary>
          <span>五官精修</span>
          <span className="beauty-summary-actions">
            <ResetButton
              label="重置五官精修"
              onClick={() =>
                save({
                  ...settings,
                  facialFeatures: { ...DEFAULT_FACIAL_FEATURE_SETTINGS }
                })
              }
            />
            <ChevronDown className="beauty-chevron size-3.5" />
          </span>
        </summary>
        <div className="beauty-section-body">
          <div className="beauty-feature-tabs" role="tablist" aria-label="五官分类">
            {FEATURE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={featureCategory === tab.id}
                className={featureCategory === tab.id ? 'active' : ''}
                onClick={() => setFeatureCategory(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="beauty-controls">
            {FEATURE_CONTROLS[featureCategory].map((control) => (
              <BeautySlider
                key={control.key}
                label={control.label}
                value={settings.facialFeatures[control.key]}
                signed={SIGNED_FACIAL_FEATURE_KEYS.has(control.key)}
                onChange={(value, pushHistory) =>
                  updateFacialFeature(control.key, value, pushHistory)
                }
              />
            ))}
          </div>
        </div>
      </details>
    </div>
  )
}
