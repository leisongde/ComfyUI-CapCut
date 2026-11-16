export const DEFAULT_DIRECTOR_CHARACTER_SWAP_SUBJECT_PROMPT = 'girl in pink dress'
export const DEFAULT_DIRECTOR_CHARACTER_SWAP_MAX_OBJECTS = 1
export const MAX_DIRECTOR_CHARACTER_SWAP_MAX_OBJECTS = 100

export const normalizeDirectorCharacterSwapMaxObjects = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(MAX_DIRECTOR_CHARACTER_SWAP_MAX_OBJECTS, Math.max(1, Math.trunc(parsed)))
    : DEFAULT_DIRECTOR_CHARACTER_SWAP_MAX_OBJECTS
}

export const DEFAULT_DIRECTOR_CHARACTER_SWAP_STANDARD_PROMPT =
  '仅将 <Video 1> 中前景的女性替换为 <Picture 1> 中的人物。保留 <Picture 1> 中替换人物的身份特征、服装和画风。保持源视频的镜头、构图、背景、光照、物体及其他所有人物不变。在整个片段中，使替换人物的位置、大小、姿态和动作与被替换的女性保持一致。不要在视频中展示整张参考图或其背景。'

export const normalizeDirectorCharacterSwapSubjectPrompt = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .slice(0, 1_000) || DEFAULT_DIRECTOR_CHARACTER_SWAP_SUBJECT_PROMPT

export const directorCharacterSwapSubjectNeedsTranslation = (value: unknown): boolean =>
  /\p{Script=Han}/u.test(normalizeDirectorCharacterSwapSubjectPrompt(value))

export const buildDirectorCharacterSwapTranslationSystemPrompt = (): string =>
  `You translate a source-video person description for a SAM3 visual detector.

Translate the user's Chinese description into one concise English noun phrase that identifies the person already visible in the source video.
- Preserve visible identity cues such as gender, clothing color, clothing type, position, and foreground/background location.
- Do not add traits that the user did not provide.
- Do not describe the replacement character, desired edit, camera, action, or generation instructions.
- Output English only, with no label, explanation, quotation marks, Markdown, or ending punctuation.

Example:
Input: 穿粉色裙子的女孩
Output: girl in pink dress`

export const parseDirectorCharacterSwapTranslation = (value: unknown): string => {
  let result = String(value ?? '').trim()
  const fenced = result.match(/^```(?:text|english)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) result = fenced[1].trim()
  result = result
    .replace(/^(?:translation|english|output)\s*[:：]\s*/i, '')
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .replace(/[。.!！]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!result) throw new Error('人物识别文本翻译结果为空')
  if (/\p{Script=Han}/u.test(result)) throw new Error('人物识别文本未能翻译为英文')
  if (result.length > 1_000) throw new Error('人物识别文本翻译结果超过 1000 个字符')
  return result
}
