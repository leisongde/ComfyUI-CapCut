import type { AudioCatalogItem } from './audio-catalog'

type Translation = readonly [source: string, target: string]

const translations: Record<string, readonly Translation[]> = {
  'casino-audio': [
    ['cards pack take out', '从牌盒取牌'],
    ['cards pack open', '打开牌盒'],
    ['chips collide', '筹码碰撞'],
    ['chips handle', '拿取筹码'],
    ['chips stack', '堆叠筹码'],
    ['card shuffle', '洗牌'],
    ['card place', '放置纸牌'],
    ['card shove', '推动纸牌'],
    ['card slide', '滑动纸牌'],
    ['card fan', '扇开纸牌'],
    ['chip lay', '放置筹码'],
    ['dice grab', '抓取骰子'],
    ['dice shake', '摇晃骰子'],
    ['dice throw', '投掷骰子'],
    ['die throw', '投掷单骰']
  ],
  'digital-audio': [
    ['zapthreetonedown', '电击三连音下降'],
    ['zapthreetoneup', '电击三连音上升'],
    ['zaptwotone', '电击双音'],
    ['lowthreetone', '低音三连音'],
    ['spacetrash', '太空杂音'],
    ['phaserdown', '相位下降'],
    ['phaserup', '相位上升'],
    ['phasejump', '相位跳跃'],
    ['threetone', '三连音'],
    ['twotone', '双音'],
    ['powerup', '能量提升'],
    ['pepsound', '电子提示音'],
    ['lowrandom', '低音随机'],
    ['highdown', '高音下降'],
    ['highup', '高音上升'],
    ['lowdown', '低音下降'],
    ['laser', '激光'],
    ['tone', '单音'],
    ['zap', '电击']
  ],
  'impact-sounds': [
    ['footstep concrete', '水泥地脚步'],
    ['footstep carpet', '地毯脚步'],
    ['footstep grass', '草地脚步'],
    ['footstep snow', '雪地脚步'],
    ['footstep wood', '木地板脚步'],
    ['impactgeneric light', '通用轻度撞击'],
    ['impactglass heavy', '玻璃重度撞击'],
    ['impactglass medium', '玻璃中度撞击'],
    ['impactglass light', '玻璃轻度撞击'],
    ['impactmetal heavy', '金属重度撞击'],
    ['impactmetal medium', '金属中度撞击'],
    ['impactmetal light', '金属轻度撞击'],
    ['impactplate heavy', '金属板重度撞击'],
    ['impactplate medium', '金属板中度撞击'],
    ['impactplate light', '金属板轻度撞击'],
    ['impactpunch heavy', '重拳撞击'],
    ['impactpunch medium', '中度拳击'],
    ['impactsoft heavy', '软物重度撞击'],
    ['impactsoft medium', '软物中度撞击'],
    ['impactwood heavy', '木材重度撞击'],
    ['impactwood medium', '木材中度撞击'],
    ['impactwood light', '木材轻度撞击'],
    ['impactbell heavy', '钟声重度撞击'],
    ['impactplank medium', '木板中度撞击'],
    ['impacttin medium', '铁皮中度撞击'],
    ['impactmining', '采矿撞击']
  ],
  'interface-sounds': [
    ['confirmation', '确认'],
    ['maximize', '最大化'],
    ['minimize', '最小化'],
    ['question', '疑问'],
    ['scratch', '刮擦'],
    ['scroll', '滚动'],
    ['select', '选择'],
    ['switch', '切换'],
    ['toggle', '开关'],
    ['glitch', '故障'],
    ['click', '点击'],
    ['close', '关闭'],
    ['error', '错误'],
    ['glass', '玻璃声'],
    ['pluck', '拨弦'],
    ['back', '返回'],
    ['bong', '咚声'],
    ['drop', '放下'],
    ['open', '打开'],
    ['tick', '滴答']
  ],
  'music-jingles': [
    ['8 bit jingles jingles nes', '8 位游戏音乐短句'],
    ['pizzicato jingles jingles pizzi', '拨弦音乐短句'],
    ['steel jingles jingles steel', '金属乐器音乐短句'],
    ['hit jingles jingles hit', '重击音乐短句'],
    ['sax jingles jingles sax', '萨克斯音乐短句']
  ],
  'rpg-audio': [
    ['handlesmallleather', '操作小件皮革'],
    ['handlecoins', '拿取金币'],
    ['belthandle', '操作腰带'],
    ['bookclose', '合上书本'],
    ['bookflip', '翻书'],
    ['bookopen', '打开书本'],
    ['bookplace', '放置书本'],
    ['clothbelt', '布制腰带'],
    ['doorclose', '关门'],
    ['dooropen', '开门'],
    ['drawknife', '拔刀'],
    ['dropleather', '皮革掉落'],
    ['knifeslice', '刀刃切割'],
    ['metalclick', '金属卡扣'],
    ['metallatch', '金属门闩'],
    ['metalpot', '金属锅'],
    ['footstep', '脚步'],
    ['cloth', '布料'],
    ['creak', '吱呀'],
    ['chop', '劈砍']
  ],
  'sci-fi-sounds': [
    ['lowfrequency explosion', '低频爆炸'],
    ['spaceenginelarge', '大型太空引擎'],
    ['spaceenginesmall', '小型太空引擎'],
    ['spaceenginelow', '低频太空引擎'],
    ['spaceengine', '太空引擎'],
    ['explosioncrunch', '爆裂冲击'],
    ['enginecircular', '循环引擎'],
    ['computernoise', '计算机噪声'],
    ['thrusterfire', '推进器点火'],
    ['impactmetal', '金属撞击'],
    ['laserlarge', '大型激光'],
    ['laserretro', '复古激光'],
    ['lasersmall', '小型激光'],
    ['doorclose', '关门'],
    ['dooropen', '开门'],
    ['forcefield', '力场'],
    ['slime', '黏液']
  ],
  'ui-audio': [
    ['mouserelease', '鼠标释放'],
    ['mouseclick', '鼠标按下'],
    ['rollover', '鼠标悬停'],
    ['switch', '切换'],
    ['click', '点击']
  ],
  'ui-pack': [
    ['sounds click a', '点击音 甲'],
    ['sounds click b', '点击音 乙'],
    ['sounds switch a', '切换音 甲'],
    ['sounds switch b', '切换音 乙'],
    ['sounds tap a', '轻触音 甲'],
    ['sounds tap b', '轻触音 乙']
  ]
}

const voicePhrases: readonly Translation[] = [
  ['war fire in the hole', '小心手雷'],
  ['war call for backup', '请求支援'],
  ['war target destroyed', '目标已摧毁'],
  ['war suppressing fire', '火力压制'],
  ['war supressing fire', '火力压制'],
  ['war target engaged', '正在攻击目标'],
  ['war watch my back', '掩护我身后'],
  ['war cover me', '掩护我'],
  ['war get down', '趴下'],
  ['war go go go', '冲冲冲'],
  ['war look out', '小心'],
  ['war reloading', '正在换弹'],
  ['mission completed', '任务完成'],
  ['objective achieved', '目标达成'],
  ['mission failed', '任务失败'],
  ['new highscore', '新纪录'],
  ['congratulations', '恭喜'],
  ['final round', '最后一回合'],
  ['game over', '游戏结束'],
  ['hurry up', '快点'],
  ['its a tie', '平局'],
  ['level up', '升级'],
  ['power up', '能量提升'],
  ['time over', '时间到'],
  ['war medic', '医疗兵'],
  ['war hold', '坚守'],
  ['war rpg', '火箭筒'],
  ['war sniper', '狙击手'],
  ['you lose', '你输了'],
  ['you win', '你赢了'],
  ['correct', '正确'],
  ['level', '关卡'],
  ['ready', '准备'],
  ['round', '回合'],
  ['wrong', '错误'],
  ['hold', '停下'],
  ['go', '开始'],
  ['set', '预备']
]

const fighterPhrases: readonly Translation[] = [
  ['choose your character', '选择角色'],
  ['championship mode', '锦标赛模式'],
  ['flawless victory', '完美胜利'],
  ['prepare yourself', '做好准备'],
  ['combo breaker', '连击终结'],
  ['survival mode', '生存模式'],
  ['sudden death', '决胜局'],
  ['arcade mode', '街机模式'],
  ['battle mode', '对战模式'],
  ['story mode', '剧情模式'],
  ['final round', '最后一回合'],
  ['game over', '游戏结束'],
  ['it s a tie', '宣布平局'],
  ['multi kill', '多重击杀'],
  ['tie breaker', '加赛决胜'],
  ['kill her', '击败她'],
  ['kill him', '击败他'],
  ['kill it', '击败它'],
  ['you lose', '你输了'],
  ['you win', '你赢了'],
  ['deathmatch', '死斗模式'],
  ['player', '玩家'],
  ['round', '回合'],
  ['begin', '开始'],
  ['combo', '连击'],
  ['fight', '战斗开始'],
  ['loser', '败者'],
  ['ready', '准备'],
  ['winner', '胜者'],
  ['tie', '平局'],
  ['time', '时间']
]

function normalize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function translatePrefix(name: string, entries: readonly Translation[]): string | null {
  for (const [source, target] of entries) {
    if (name === source) return target
    if (name.startsWith(`${source} `)) return `${target} ${name.slice(source.length + 1)}`
  }
  return null
}

export function translateAudioName(category: string, value: string): string {
  const name = normalize(value)
  if (category === 'voiceover-pack') {
    const match = /^(female|male) (.+)$/.exec(name)
    if (match) {
      const speaker = match[1] === 'female' ? '女声' : '男声'
      const phrase = translatePrefix(match[2], voicePhrases) || match[2]
      return `${speaker} ${phrase}`
    }
  }
  if (category === 'voiceover-pack-fighter') {
    if (/^\d+$/.test(name)) return `格斗语音 ${name}`
    return translatePrefix(name, fighterPhrases) || `格斗语音 ${name}`
  }
  return translatePrefix(name, translations[category] || []) || `音效 ${name}`
}

export function displayAudioName(
  item: Pick<AudioCatalogItem, 'category' | 'name' | 'nameZh'>
): string {
  return item.nameZh?.trim() || translateAudioName(item.category, item.name)
}
