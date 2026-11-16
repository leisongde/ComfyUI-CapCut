import type { EditingTextTemplateDefinition } from '../../shared/editing'

export const DEFAULT_TEXT_TEMPLATE_DEFINITIONS: EditingTextTemplateDefinition[] = [
  {
    schemaVersion: 1,
    id: 'rise-fade',
    name: 'Rise Fade',
    displayNameZh: '上浮淡入',
    category: 'basic',
    categoryLabel: '基础入场',
    tags: ['上浮', '淡入', '标题'],
    description: '文字从下方轻柔上浮并显现。',
    style: { fontWeight: 'bold', stroke: { color: '#000000', width: 2 } },
    animation: {
      intro: {
        duration: 0.55,
        easing: 'easeOut',
        keyframes: [
          { at: 0, opacity: 0, y: 56 },
          { at: 1, opacity: 1, y: 0 }
        ]
      },
      outro: {
        duration: 0.3,
        easing: 'easeIn',
        keyframes: [
          { at: 0, opacity: 1, y: 0 },
          { at: 1, opacity: 0, y: -20 }
        ]
      }
    }
  },
  {
    schemaVersion: 1,
    id: 'elastic-pop',
    name: 'Elastic Pop',
    displayNameZh: '弹性弹入',
    category: 'emphasis',
    categoryLabel: '强调',
    tags: ['弹性', '放大', '强调'],
    description: '文字快速放大，带有轻微回弹。',
    style: { fontWeight: 'bold', color: '#fff4bf', stroke: { color: '#7a3d00', width: 2 } },
    animation: {
      intro: {
        duration: 0.65,
        easing: 'backOut',
        keyframes: [
          { at: 0, opacity: 0, scale: 0.35 },
          { at: 0.72, opacity: 1, scale: 1.08 },
          { at: 1, opacity: 1, scale: 1 }
        ]
      },
      outro: {
        duration: 0.28,
        easing: 'easeIn',
        keyframes: [
          { at: 0, opacity: 1, scale: 1 },
          { at: 1, opacity: 0, scale: 0.85 }
        ]
      }
    }
  },
  {
    schemaVersion: 1,
    id: 'slide-in-right',
    name: 'Slide In Right',
    displayNameZh: '右侧滑入',
    category: 'motion',
    categoryLabel: '动感',
    tags: ['滑入', '右侧', '标题'],
    description: '文字从画面右侧快速滑入并停稳。',
    style: { fontWeight: 'bold', stroke: { color: '#101828', width: 2 } },
    animation: {
      intro: {
        duration: 0.5,
        easing: 'easeOut',
        keyframes: [
          { at: 0, opacity: 0, x: 180, rotate: 4 },
          { at: 1, opacity: 1, x: 0, rotate: 0 }
        ]
      },
      outro: {
        duration: 0.3,
        easing: 'easeIn',
        keyframes: [
          { at: 0, opacity: 1, x: 0 },
          { at: 1, opacity: 0, x: -80 }
        ]
      }
    }
  },
  {
    schemaVersion: 1,
    id: 'bounce-in',
    name: 'Bounce In',
    displayNameZh: '落地弹跳',
    category: 'playful',
    categoryLabel: '活泼',
    tags: ['弹跳', '综艺', '活泼'],
    description: '文字从上方落下并产生弹跳感。',
    style: { fontWeight: 'bold', color: '#ffffff', stroke: { color: '#ef4444', width: 3 } },
    animation: {
      intro: {
        duration: 0.8,
        easing: 'bounceOut',
        keyframes: [
          { at: 0, opacity: 0, y: -140, rotate: -8 },
          { at: 1, opacity: 1, y: 0, rotate: 0 }
        ]
      },
      outro: {
        duration: 0.32,
        easing: 'easeIn',
        keyframes: [
          { at: 0, opacity: 1, y: 0 },
          { at: 1, opacity: 0, y: 40 }
        ]
      }
    }
  },
  {
    schemaVersion: 1,
    id: 'zoom-focus',
    name: 'Zoom Focus',
    displayNameZh: '聚焦放大',
    category: 'title',
    categoryLabel: '标题',
    tags: ['聚焦', '缩放', '宣传'],
    description: '文字从小到大聚焦，适合标题和宣传片。',
    style: { fontWeight: 'bold', color: '#dff8ff', stroke: { color: '#075985', width: 2 } },
    animation: {
      intro: {
        duration: 0.62,
        easing: 'easeOut',
        keyframes: [
          { at: 0, opacity: 0, scale: 0.55 },
          { at: 0.7, opacity: 1, scale: 1.04 },
          { at: 1, opacity: 1, scale: 1 }
        ]
      },
      outro: {
        duration: 0.4,
        easing: 'easeIn',
        keyframes: [
          { at: 0, opacity: 1, scale: 1 },
          { at: 1, opacity: 0, scale: 1.18 }
        ]
      }
    }
  },
  {
    schemaVersion: 1,
    id: 'soft-fade',
    name: 'Soft Fade',
    displayNameZh: '柔和淡出',
    category: 'basic',
    categoryLabel: '基础入场',
    tags: ['淡入', '淡出', '简洁'],
    description: '简洁的透明度渐入渐出效果。',
    style: {
      color: '#ffffff',
      shadow: { color: 'rgba(0,0,0,0.45)', offsetX: 0, offsetY: 3, blur: 8 }
    },
    animation: {
      intro: {
        duration: 0.5,
        easing: 'easeOut',
        keyframes: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 }
        ]
      },
      outro: {
        duration: 0.5,
        easing: 'easeIn',
        keyframes: [
          { at: 0, opacity: 1 },
          { at: 1, opacity: 0 }
        ]
      }
    }
  }
]

export const DEFAULT_TEXT_TEMPLATE_CATALOG = {
  schemaVersion: 1,
  collectionId: 'raccoon-text-templates',
  collectionName: '浣熊文字动画模板',
  collectionVersion: '1.0.0',
  kind: 'text-template-collection',
  categories: [
    ...new Map(
      DEFAULT_TEXT_TEMPLATE_DEFINITIONS.map((item) => [item.category, item.categoryLabel])
    ).entries()
  ].map(([id, label]) => ({
    id,
    label,
    count: DEFAULT_TEXT_TEMPLATE_DEFINITIONS.filter((item) => item.category === id).length
  })),
  items: DEFAULT_TEXT_TEMPLATE_DEFINITIONS.map((item) => ({
    id: item.id,
    name: item.name,
    displayNameZh: item.displayNameZh,
    category: item.category,
    categoryLabel: item.categoryLabel,
    tags: item.tags,
    file: `templates/${item.id}.json`,
    remotePath: `templates/${item.id}.json`,
    downloadUrl: `https://modelscope.cn/models/leisongde/Raccoon_dataset/resolve/master/jianji/weizimoban/templates/${item.id}.json?view=false`,
    sizeBytes: 0,
    sha256: '',
    license: 'MIT',
    author: 'Raccoon / Motion Canvas reference'
  }))
}

export const DEFAULT_TEXT_TEMPLATE_BY_ID = new Map(
  DEFAULT_TEXT_TEMPLATE_DEFINITIONS.map((definition) => [definition.id, definition])
)
