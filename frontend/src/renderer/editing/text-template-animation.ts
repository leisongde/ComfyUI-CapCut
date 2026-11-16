import type { EditingTextTemplateKeyframe, EditingTextTemplatePhase } from '../../shared/editing'

export type TextTemplateAnimation = {
  opacity: number
  x: number
  y: number
  scale: number
  rotate: number
  color?: string
}

type AnimatedTextElement = {
  startTime: number
  duration: number
  textTemplate?: {
    animation?: {
      intro?: EditingTextTemplatePhase
      outro?: EditingTextTemplatePhase
    }
  }
}

const DEFAULT_ANIMATION: TextTemplateAnimation = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  rotate: 0
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function ease(value: number, name = 'linear'): number {
  let t = clamp(value)
  switch (name) {
    case 'easeIn':
      return t * t
    case 'easeOut':
      return 1 - (1 - t) * (1 - t)
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    case 'backOut': {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
    }
    case 'bounceOut': {
      const n1 = 7.5625
      const d1 = 2.75
      if (t < 1 / d1) return n1 * t * t
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
      return n1 * (t -= 2.625 / d1) * t + 0.984375
    }
    default:
      return t
  }
}

function valueFor(
  keyframe: EditingTextTemplateKeyframe | undefined,
  property: keyof TextTemplateAnimation
): number | string | undefined {
  return keyframe?.[property as keyof EditingTextTemplateKeyframe]
}

function interpolate(phase: EditingTextTemplatePhase, progress: number): TextTemplateAnimation {
  const keyframes = [...(phase.keyframes || [])]
    .filter((keyframe) => Number.isFinite(keyframe.at))
    .sort((a, b) => a.at - b.at)
  if (!keyframes.length) return { ...DEFAULT_ANIMATION }

  const t = clamp(progress)
  const before = keyframes[0]
  const after = keyframes[keyframes.length - 1]
  let from = before
  let to = after
  for (let index = 1; index < keyframes.length; index += 1) {
    if (t <= keyframes[index].at) {
      from = keyframes[index - 1]
      to = keyframes[index]
      break
    }
  }
  const span = Math.max(1e-6, to.at - from.at)
  const localProgress = ease((t - from.at) / span, phase.easing)
  const numeric = (property: keyof TextTemplateAnimation, fallback: number): number => {
    const start = valueFor(from, property)
    const end = valueFor(to, property)
    const a = typeof start === 'number' ? start : fallback
    const b = typeof end === 'number' ? end : fallback
    return a + (b - a) * localProgress
  }
  const result: TextTemplateAnimation = {
    opacity: numeric('opacity', 1),
    x: numeric('x', 0),
    y: numeric('y', 0),
    scale: numeric('scale', 1),
    rotate: numeric('rotate', 0)
  }
  const color = valueFor(from, 'color')
  const endColor = valueFor(to, 'color')
  if (typeof color === 'string' || typeof endColor === 'string')
    result.color = localProgress < 0.5 ? String(color ?? endColor) : String(endColor ?? color)
  return result
}

export function resolveTextTemplateAnimation(
  element: AnimatedTextElement,
  timelineTime: number
): TextTemplateAnimation {
  const definition = element.textTemplate?.animation
  if (!definition) return { ...DEFAULT_ANIMATION }
  const localTime = timelineTime - element.startTime
  const intro = definition.intro
  if (intro && intro.duration > 0 && localTime < intro.duration)
    return interpolate(intro, localTime / intro.duration)

  const outro = definition.outro
  if (outro && outro.duration > 0 && localTime > element.duration - outro.duration)
    return interpolate(outro, (localTime - (element.duration - outro.duration)) / outro.duration)

  return { ...DEFAULT_ANIMATION }
}
