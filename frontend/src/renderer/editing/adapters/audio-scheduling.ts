/** Map one decoded source buffer to the unmuted part of a timeline clip. */
export function planAudioChunk({
  clip,
  timestamp,
  bufferDuration,
  timelineTime,
  contextTime
}: {
  clip: { startTime: number; duration: number; trimStart: number; playbackRate: number }
  timestamp: number
  bufferDuration: number
  timelineTime: number
  contextTime: number
}): { when: number; offset: number; duration: number } | null {
  const rate = clip.playbackRate
  if (!Number.isFinite(rate) || rate <= 0) return null
  const sourceStart = Math.max(
    timestamp,
    clip.trimStart,
    clip.trimStart + (timelineTime - clip.startTime) * rate
  )
  const sourceEnd = Math.min(timestamp + bufferDuration, clip.trimStart + clip.duration * rate)
  if (sourceEnd <= sourceStart) return null
  const start = clip.startTime + (sourceStart - clip.trimStart) / rate
  return {
    when: contextTime + Math.max(0, start - timelineTime),
    offset: sourceStart - timestamp,
    // AudioBufferSourceNode.start() takes a duration in source seconds, even at other rates.
    duration: sourceEnd - sourceStart
  }
}

/** Map one decoded source buffer to a reversed timeline clip. */
export function planReversedAudioChunk({
  clip,
  timestamp,
  bufferDuration,
  timelineTime,
  contextTime
}: {
  clip: { startTime: number; duration: number; trimStart: number; playbackRate: number }
  timestamp: number
  bufferDuration: number
  timelineTime: number
  contextTime: number
}): { when: number; offset: number; duration: number; timelineStart: number } | null {
  const rate = clip.playbackRate
  if (!Number.isFinite(rate) || rate <= 0) return null

  const clipSourceEnd = clip.trimStart + clip.duration * rate
  const elapsed = Math.max(0, timelineTime - clip.startTime)
  const currentSourceTime = clipSourceEnd - elapsed * rate
  const sourceStart = Math.max(timestamp, clip.trimStart)
  const sourceEnd = Math.min(timestamp + bufferDuration, clipSourceEnd, currentSourceTime)
  if (sourceEnd <= sourceStart) return null

  const timelineStart = clip.startTime + (clipSourceEnd - sourceEnd) / rate
  return {
    when: contextTime + Math.max(0, timelineStart - timelineTime),
    offset: sourceStart - timestamp,
    duration: sourceEnd - sourceStart,
    timelineStart
  }
}

/** Copy a source-buffer segment in reverse sample order for Web Audio playback. */
export function reverseAudioBufferSegment({
  context,
  buffer,
  offset,
  duration
}: {
  context: BaseAudioContext
  buffer: AudioBuffer
  offset: number
  duration: number
}): AudioBuffer | null {
  const startFrame = Math.max(0, Math.floor(offset * buffer.sampleRate))
  const endFrame = Math.min(
    buffer.length,
    Math.ceil((offset + duration) * buffer.sampleRate)
  )
  const frameCount = endFrame - startFrame
  if (frameCount <= 0) return null

  const reversed = context.createBuffer(buffer.numberOfChannels, frameCount, buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel)
    const target = reversed.getChannelData(channel)
    for (let index = 0; index < frameCount; index++) {
      target[index] = source[endFrame - index - 1]
    }
  }
  return reversed
}
