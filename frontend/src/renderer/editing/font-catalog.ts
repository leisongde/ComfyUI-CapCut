import fontCatalogData from './font-catalog-data.json'

export type OpenSourceFontLanguage = 'simplified' | 'traditional' | 'latin' | 'other'
export type OpenSourceFontCategory =
  | 'sans-serif'
  | 'serif'
  | 'handwriting'
  | 'monospace'
  | 'display'

export interface OpenSourceFontDefinition {
  id: string
  family: string
  displayNameZh: string
  description: string
  previewText: string
  language: OpenSourceFontLanguage
  category: OpenSourceFontCategory
  sourceRepository: string
  sourceCommit: string
  remotePath: string
  downloadUrls: string[]
  sha256: string
  sizeBytes: number
  mimeType: string
  license: string
  licenseUrl: string
  author: string
}

interface GeneratedFontEntry {
  id: string
  family: string
  author: string
  category: OpenSourceFontCategory
  language: OpenSourceFontLanguage
  remotePath: string
  sha256: string
  sizeBytes: number
}

type FontCopy = Pick<OpenSourceFontDefinition, 'displayNameZh' | 'description' | 'previewText'>

const GOOGLE_FONTS_REPOSITORY = 'https://github.com/google/fonts'
const GOOGLE_FONTS_REF = 'main'
const MODELSCOPE_FONT_REPOSITORY =
  'https://modelscope.cn/models/leisongde/google-fonts/resolve/master'

const CATEGORY_LABELS: Record<OpenSourceFontCategory, string> = {
  'sans-serif': '无衬线字体',
  serif: '衬线字体',
  handwriting: '手写字体',
  monospace: '等宽字体',
  display: '展示字体'
}

const LANGUAGE_PREVIEWS: Record<OpenSourceFontLanguage, string> = {
  simplified: '字体预览',
  traditional: '字體預覽',
  latin: 'Creative Story',
  other: 'Font Preview'
}

const FONT_COPY_OVERRIDES: Record<string, FontCopy> = {
  'zcool-kuaile': {
    displayNameZh: '站酷快乐体',
    description: '活泼醒目的简体标题字',
    previewText: '快乐创作'
  },
  'zcool-qingke-huangyou': {
    displayNameZh: '站酷庆科黄油体',
    description: '厚重紧凑，适合大字标题',
    previewText: '高能时刻'
  },
  'zcool-xiaowei': {
    displayNameZh: '站酷小薇 LOGO 体',
    description: '现代宋体风格，适合片名',
    previewText: '故事开始'
  },
  'long-cang': {
    displayNameZh: '龙藏体',
    description: '自然随性的简体手写书法',
    previewText: '江湖故人'
  },
  'liu-jian-mao-cao': {
    displayNameZh: '刘建毛草',
    description: '奔放的简体草书标题字',
    previewText: '一气呵成'
  },
  'noto-sans-sc': {
    displayNameZh: 'Noto Sans SC 简体黑体',
    description: '正文与字幕通用的可变字重黑体',
    previewText: '清晰字幕'
  },
  'noto-serif-sc': {
    displayNameZh: 'Noto Serif SC 简体宋体',
    description: '正文与片名通用的可变字重宋体',
    previewText: '东方叙事'
  },
  'wdxl-lubrifont-sc': {
    displayNameZh: 'WDXL Lubrifont SC',
    description: '圆润醒目的简体展示字',
    previewText: '灵感上场'
  },
  'zhi-mang-xing': {
    displayNameZh: '志莽行书',
    description: '自由流动的简体行草书',
    previewText: '挥笔成章'
  },
  'bpmf-huninn': {
    displayNameZh: 'Bpmf Huninn',
    description: '带注音字形的繁体圆体',
    previewText: '溫暖日常'
  },
  'bpmf-iansui': {
    displayNameZh: 'Bpmf Iansui',
    description: '带注音字形的繁体手写体',
    previewText: '手寫心情'
  },
  'bpmf-zihi-kai-std': {
    displayNameZh: 'Bpmf Zihi Kai Std',
    description: '带注音字形的繁体楷体',
    previewText: '字裡行間'
  },
  'cactus-classical-serif': {
    displayNameZh: 'Cactus Classical Serif',
    description: '古典气质的繁体衬线体',
    previewText: '經典篇章'
  },
  'chiron-goround-tc': {
    displayNameZh: 'Chiron GoRound TC',
    description: '亲和圆润的繁体可变字体',
    previewText: '圓滿時刻'
  },
  'chiron-hei-hk': {
    displayNameZh: 'Chiron Hei HK',
    description: '适合香港繁体的可变字重黑体',
    previewText: '城市光影'
  },
  'chocolate-classical-sans': {
    displayNameZh: 'Chocolate Classical Sans',
    description: '古典结构的繁体无衬线体',
    previewText: '雅緻標題'
  },
  huninn: {
    displayNameZh: 'Huninn 粉圆体',
    description: '温润亲和的繁体圆体',
    previewText: '溫柔日常'
  },
  iansui: {
    displayNameZh: 'Iansui 芫荽',
    description: '自然清新的繁体手写体',
    previewText: '隨心書寫'
  },
  'lxgw-marker-gothic': {
    displayNameZh: '霞鹜漫黑',
    description: '记号笔质感的繁体标题字',
    previewText: '重點登場'
  },
  'lxgw-wenkai-mono-tc': {
    displayNameZh: '霞鹜文楷等宽 TC',
    description: '等宽排版的繁体文楷',
    previewText: '整齊書寫'
  },
  'lxgw-wenkai-tc': {
    displayNameZh: '霞鹜文楷 TC',
    description: '清晰自然的繁体楷体',
    previewText: '閱讀時光'
  },
  'noto-sans-tc': {
    displayNameZh: 'Noto Sans TC 繁体黑体',
    description: '正文与字幕通用的可变字重黑体',
    previewText: '清晰字幕'
  },
  'noto-serif-tc': {
    displayNameZh: 'Noto Serif TC 繁体宋体',
    description: '正文与片名通用的可变字重宋体',
    previewText: '東方敘事'
  },
  'uoq-mun-then-khung': {
    displayNameZh: '宇文天穹',
    description: '端庄古典的繁体衬线体',
    previewText: '天穹萬象'
  },
  'wdxl-lubrifont-tc': {
    displayNameZh: 'WDXL Lubrifont TC',
    description: '圆润醒目的繁体展示字',
    previewText: '靈感上場'
  }
}

function downloadUrls(remotePath: string): string[] {
  return [
    `${MODELSCOPE_FONT_REPOSITORY}/${remotePath}?view=false`,
    `https://cdn.jsdelivr.net/gh/google/fonts@${GOOGLE_FONTS_REF}/${remotePath}`,
    `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_REF}/${remotePath}`
  ]
}

function defineFont(entry: GeneratedFontEntry): OpenSourceFontDefinition {
  const copy = FONT_COPY_OVERRIDES[entry.id] || {
    displayNameZh: entry.family,
    description: `Google Fonts · ${CATEGORY_LABELS[entry.category]}`,
    previewText: LANGUAGE_PREVIEWS[entry.language]
  }
  return {
    ...entry,
    ...copy,
    sourceRepository: GOOGLE_FONTS_REPOSITORY,
    sourceCommit: GOOGLE_FONTS_REF,
    downloadUrls: downloadUrls(entry.remotePath),
    mimeType: entry.remotePath.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf',
    license: 'OFL-1.1',
    licenseUrl: `${GOOGLE_FONTS_REPOSITORY}/blob/${GOOGLE_FONTS_REF}/${entry.remotePath.replace(/[^/]+$/, 'OFL.txt')}`
  }
}

// The catalog contains metadata only. Font binaries are downloaded and cached on demand.
export const OPEN_SOURCE_FONTS: OpenSourceFontDefinition[] = (
  fontCatalogData as GeneratedFontEntry[]
).map(defineFont)

export function formatFontSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.ceil(sizeBytes / 1024)} KB`
}
