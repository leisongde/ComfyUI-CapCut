import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSampleSink
} from 'mediabunny'
import type { MediaAsset } from '@/types/assets'
import type { VideoElement } from '@/types/timeline'
import { reverseAudioBufferSegment } from './adapters/audio-scheduling'

export interface DirectorVideoSourceRange {
  start: number
  end: number
  duration: number
  playbackRate: number
  reversed: boolean
}

/** trimStart is in source seconds; startTime only locates the clip on the editing timeline. */
export function getDirectorVideoSourceRange(
  element: Pick<VideoElement, 'trimStart' | 'duration' | 'playbackRate' | 'reversed'>
): DirectorVideoSourceRange {
  const duration = Number(element.duration)
  const start = Number(element.trimStart ?? 0)
  const playbackRate = Number(element.playbackRate ?? 1)
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 15 ||
    !Number.isFinite(start) ||
    start < 0 ||
    !Number.isFinite(playbackRate) ||
    playbackRate <= 0
  )
    throw new Error('当前视频片段范围无效，请重新选择片段')
  return {
    start,
    end: start + duration * playbackRate,
    duration,
    playbackRate,
    reversed: element.reversed === true
  }
}

export function getDirectorVideoSourceTime(range: DirectorVideoSourceRange, time: number): number {
  // Stay inside the selected half-open range, including when sampling the first reversed frame.
  const elapsed = Math.min(range.duration, Math.max(0, time)) * range.playbackRate
  return range.reversed
    ? Math.max(range.start, range.end - elapsed - 1e-6)
    : Math.min(range.end - 1e-6, range.start + elapsed)
}

async function extractAudio(
  input: Input,
  range: DirectorVideoSourceRange
): Promise<AudioBuffer | null> {
  const track = await input.getPrimaryAudioTrack()
  if (!track) return null
  if (!(await track.canDecode())) throw new Error('当前视频的音频格式无法解码')
  const sampleRate = 48000
  const context = new OfflineAudioContext(
    Math.min(2, track.numberOfChannels),
    Math.ceil(range.duration * sampleRate),
    sampleRate
  )
  for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(
    range.start,
    range.end
  )) {
    const start = Math.max(timestamp, range.start)
    const end = Math.min(timestamp + buffer.duration, range.end)
    if (end <= start) continue
    const source = context.createBufferSource()
    source.playbackRate.value = range.playbackRate
    source.connect(context.destination)
    if (range.reversed) {
      source.buffer = reverseAudioBufferSegment({
        context,
        buffer,
        offset: start - timestamp,
        duration: end - start
      })
      if (source.buffer) source.start((range.end - end) / range.playbackRate)
    } else {
      source.buffer = buffer
      source.start((start - range.start) / range.playbackRate, start - timestamp, end - start)
    }
  }
  return context.startRendering()
}

/** Materialize a self-contained clip so previews, references and generation all read the same range. */
export async function extractDirectorVideoSource(
  element: VideoElement,
  media: MediaAsset,
  onProgress?: (progress: number) => void
): Promise<Omit<MediaAsset, 'id'>> {
  const range = getDirectorVideoSourceRange(element)
  const input = new Input({ source: new BlobSource(media.file), formats: ALL_FORMATS })
  let output: Output<Mp4OutputFormat, BufferTarget> | undefined
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) throw new Error('当前视频格式无法解码')
    const sourceDuration = await track.computeDuration()
    if (range.start >= sourceDuration || range.end > sourceDuration + 0.1)
      throw new Error('当前片段超出源视频范围，请重新裁剪后再试')
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(2, Math.round(track.displayWidth / 2) * 2)
    canvas.height = Math.max(2, Math.round(track.displayHeight / 2) * 2)
    // Windows AVC encoders can reject GPU-backed canvas frame formats.
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
    if (!context) throw new Error('无法创建视频片段预览')
    const audio = await extractAudio(input, range)
    const fps = 24
    const frameCount = Math.ceil(range.duration * fps)
    output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
    const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH, hardwareAcceleration: 'prefer-software' })
    output.addVideoTrack(videoSource, { frameRate: fps })
    const audioSource = audio ? new AudioBufferSource({ codec: 'aac', bitrate: 192000 }) : null
    if (audioSource) output.addAudioTrack(audioSource)
    await output.start()
    if (audioSource && audio) {
      await audioSource.add(audio)
      audioSource.close()
    }
    const times = Array.from({ length: frameCount }, (_, index) =>
      getDirectorVideoSourceTime(range, index / fps)
    )
    let index = 0
    let thumbnailUrl: string | undefined
    for await (const sample of new VideoSampleSink(track).samplesAtTimestamps(times)) {
      if (!sample) throw new Error('无法读取选中视频片段的画面')
      try {
        sample.draw(context, 0, 0, canvas.width, canvas.height)
        if (index === 0) {
          const thumbnail = document.createElement('canvas')
          const scale = Math.min(1, 640 / canvas.width, 360 / canvas.height)
          thumbnail.width = Math.max(1, Math.round(canvas.width * scale))
          thumbnail.height = Math.max(1, Math.round(canvas.height * scale))
          thumbnail.getContext('2d')!.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height)
          thumbnailUrl = thumbnail.toDataURL('image/jpeg', 0.8)
        }
        await videoSource.add(index / fps, Math.min(1 / fps, range.duration - index / fps))
      } finally {
        sample.close()
      }
      index += 1
      onProgress?.(index / frameCount)
    }
    videoSource.close()
    await output.finalize()
    if (!output.target.buffer) throw new Error('视频片段提取失败')
    const name = `${(media.name || element.name || '视频').replace(/\.[^.]+$/, '')}（片段 ${range.start.toFixed(2)}-${range.end.toFixed(2)}秒）.mp4`
    const file = new File([output.target.buffer], name, { type: 'video/mp4' })
    return {
      name,
      type: 'video',
      file,
      duration: range.duration,
      width: canvas.width,
      height: canvas.height,
      fps,
      thumbnailUrl
    }
  } catch (error) {
    await output?.cancel().catch(() => undefined)
    throw error
  } finally {
    input.dispose()
  }
}
