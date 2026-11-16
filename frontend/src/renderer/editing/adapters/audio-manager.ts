import type { EditorCore } from '@/core'
import { collectAudioClips, createAudioContext } from '@/lib/media/audio'
import type { AudioClipSource } from '@/lib/media/audio'
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny'
import {
  planAudioChunk,
  planReversedAudioChunk,
  reverseAudioBufferSegment
} from './audio-scheduling'
import { scheduleAudioEnvelope } from '../audio-envelope'

const LOOKAHEAD_SECONDS = 0.5

type DesktopAudioClipSource = AudioClipSource & { reversed?: boolean }

/** Read only audio packets, with bounded decoding ahead of the timeline playhead. */
export class AudioManager {
  private audioContext: AudioContext | null = null
  private masterGain: GainNode | null = null
  private queuedSources = new Map<AudioBufferSourceNode, GainNode>()
  private inputs = new Set<Input>()
  private waits = new Map<number, () => void>()
  private playbackSessionId = 0
  private playbackStartTime = 0
  private playbackStartContextTime = 0
  private lastIsPlaying = false
  private lastIsScrubbing = false
  private unsubscribers: Array<() => void> = []
  private timelineChangeTimer: number | null = null
  private disposed = false

  constructor(private editor: EditorCore) {
    this.unsubscribers.push(
      editor.playback.subscribe(this.handlePlaybackChange),
      editor.timeline.subscribe(this.handleTimelineChange),
      editor.media.subscribe(this.handleTimelineChange)
    )
    window.addEventListener('playback-seek', this.handleSeek)
  }

  dispose(): void {
    this.disposed = true
    this.stopPlayback()
    if (this.timelineChangeTimer !== null) window.clearTimeout(this.timelineChangeTimer)
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
    window.removeEventListener('playback-seek', this.handleSeek)
    if (this.audioContext) void this.audioContext.close()
    this.audioContext = null
    this.masterGain = null
  }

  private handlePlaybackChange = (): void => {
    if (this.masterGain) this.masterGain.gain.value = this.editor.playback.getVolume()
    const playing = this.editor.playback.getIsPlaying()
    const scrubbing = this.editor.playback.getIsScrubbing()
    if (playing === this.lastIsPlaying && scrubbing === this.lastIsScrubbing) return
    this.lastIsPlaying = playing
    this.lastIsScrubbing = scrubbing
    if (playing && !scrubbing) void this.startPlayback()
    else this.stopPlayback()
  }

  private handleSeek = (): void => {
    if (this.editor.playback.getIsPlaying() && !this.editor.playback.getIsScrubbing())
      void this.startPlayback()
    else this.stopPlayback()
  }

  private handleTimelineChange = (): void => {
    if (this.timelineChangeTimer !== null) window.clearTimeout(this.timelineChangeTimer)
    // Mutes and edits must stop already queued buffers immediately.
    this.stopPlayback()
    this.timelineChangeTimer = window.setTimeout(() => {
      this.timelineChangeTimer = null
      if (this.editor.playback.getIsPlaying() && !this.editor.playback.getIsScrubbing())
        void this.startPlayback()
    }, 50)
  }

  private isCurrent(session: number): boolean {
    return (
      !this.disposed &&
      session === this.playbackSessionId &&
      this.editor.playback.getIsPlaying() &&
      !this.editor.playback.getIsScrubbing()
    )
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = createAudioContext()
      this.masterGain = this.audioContext.createGain()
      this.masterGain.gain.value = this.editor.playback.getVolume()
      this.masterGain.connect(this.audioContext.destination)
    }
    return this.audioContext
  }

  private async startPlayback(): Promise<void> {
    this.stopPlayback()
    const session = this.playbackSessionId
    if (!this.isCurrent(session)) return
    try {
      const context = this.ensureAudioContext()
      if (context.state === 'suspended') await context.resume()
      if (!this.isCurrent(session)) return
      const clips = await collectAudioClips({
        tracks: this.editor.timeline.getTracks(),
        mediaAssets: this.editor.media.getAssets()
      })
      if (!this.isCurrent(session)) return
      this.playbackStartTime = this.editor.playback.getCurrentTime()
      this.playbackStartContextTime = context.currentTime
      for (const clip of clips) {
        if (!clip.muted && clip.duration > 0 && clip.playbackRate > 0)
          void this.streamClip(clip, session)
      }
    } catch (error) {
      if (this.isCurrent(session)) console.warn('Failed to start timeline audio:', error)
    }
  }

  private async waitUntilNear(time: number, session: number): Promise<boolean> {
    while (this.isCurrent(session)) {
      const ahead = time - this.editor.playback.getCurrentTime() - LOOKAHEAD_SECONDS
      if (ahead <= 0) return true
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(
          () => {
            this.waits.delete(timer)
            resolve()
          },
          Math.min(100, ahead * 1000)
        )
        this.waits.set(timer, resolve)
      })
    }
    return false
  }

  private async streamClip(source: AudioClipSource, session: number): Promise<void> {
    const clip = source as DesktopAudioClipSource
    let input: Input | undefined
    try {
      if (!(await this.waitUntilNear(clip.startTime, session))) return
      const elapsed = Math.max(0, this.editor.playback.getCurrentTime() - clip.startTime)
      if (elapsed >= clip.duration) return
      input = new Input({ source: new BlobSource(clip.file), formats: ALL_FORMATS })
      this.inputs.add(input)
      const track = await input.getPrimaryAudioTrack()
      if (!track || !this.isCurrent(session)) return // Videos without audio are valid.
      if (!(await track.canDecode())) throw new Error('Audio codec is not supported')
      if (!this.isCurrent(session)) return
      const sink = new AudioBufferSink(track)
      if (clip.reversed) {
        await this.streamReversedClip({ clip, sink, elapsed, session })
        return
      }
      const from = clip.trimStart + elapsed * clip.playbackRate
      const to = clip.trimStart + clip.duration * clip.playbackRate
      for await (const { buffer, timestamp } of sink.buffers(from, to)) {
        const time = clip.startTime + (timestamp - clip.trimStart) / clip.playbackRate
        if (!(await this.waitUntilNear(time, session))) break
        this.scheduleBuffer(clip, buffer, timestamp)
      }
    } catch (error) {
      // Disposing an input cancels pending reads/decodes when paused or seeking.
      if (this.isCurrent(session)) console.warn('Failed to play audio:', clip.file.name, error)
    } finally {
      if (input) {
        this.inputs.delete(input)
        input.dispose()
      }
    }
  }

  private async streamReversedClip({
    clip,
    sink,
    elapsed,
    session
  }: {
    clip: DesktopAudioClipSource
    sink: AudioBufferSink
    elapsed: number
    session: number
  }): Promise<void> {
    const sourceStart = clip.trimStart
    const sourceEnd = sourceStart + clip.duration * clip.playbackRate
    const sourceWindow = Math.max(0.25, LOOKAHEAD_SECONDS * clip.playbackRate)
    let cursor = sourceEnd - elapsed * clip.playbackRate

    while (cursor > sourceStart && this.isCurrent(session)) {
      const windowStart = Math.max(sourceStart, cursor - sourceWindow)
      const buffers: Array<{ buffer: AudioBuffer; timestamp: number }> = []
      for await (const decoded of sink.buffers(windowStart, cursor)) {
        if (decoded.timestamp < cursor) buffers.push(decoded)
      }
      if (buffers.length === 0) break

      for (let index = buffers.length - 1; index >= 0; index--) {
        const { buffer, timestamp } = buffers[index]
        const plan = planReversedAudioChunk({
          clip,
          timestamp,
          bufferDuration: buffer.duration,
          timelineTime:
            this.playbackStartTime +
            (this.audioContext?.currentTime ?? this.playbackStartContextTime) -
            this.playbackStartContextTime,
          contextTime: this.audioContext?.currentTime ?? this.playbackStartContextTime
        })
        if (!plan) continue
        if (!(await this.waitUntilNear(plan.timelineStart, session))) return
        this.scheduleReversedBuffer({ clip, buffer, plan })
      }

      const nextCursor = Math.max(sourceStart, buffers[0].timestamp)
      if (nextCursor >= cursor) break
      cursor = nextCursor
    }
  }

  private scheduleBuffer(clip: AudioClipSource, buffer: AudioBuffer, timestamp: number): void {
    const context = this.audioContext
    if (!context || !this.masterGain) return
    const plan = planAudioChunk({
      clip,
      timestamp,
      bufferDuration: buffer.duration,
      // Keep contiguous packets on one audio clock; UI time only updates once per frame.
      timelineTime: this.playbackStartTime + context.currentTime - this.playbackStartContextTime,
      contextTime: context.currentTime
    })
    if (!plan) return
    const node = context.createBufferSource()
    const gain = context.createGain()
    node.buffer = buffer
    node.playbackRate.value = clip.playbackRate
    const fadedClip = clip as AudioClipSource & {
      fadeIn?: number
      fadeOut?: number
      volumeKeyframes?: import('../audio-keyframes').AudioVolumeKeyframe[]
    }
    const chunkTimelineStart =
      clip.startTime + (timestamp + plan.offset - clip.trimStart) / clip.playbackRate
    scheduleAudioEnvelope({
      param: gain.gain,
      baseVolume: clip.volume,
      duration: clip.duration,
      fadeIn: fadedClip.fadeIn,
      fadeOut: fadedClip.fadeOut,
      volumeKeyframes: fadedClip.volumeKeyframes,
      chunkStart: chunkTimelineStart - clip.startTime,
      chunkDuration: plan.duration / clip.playbackRate,
      contextStart: plan.when
    })
    node.connect(gain)
    gain.connect(this.masterGain)
    node.addEventListener('ended', () => {
      node.disconnect()
      gain.disconnect()
      this.queuedSources.delete(node)
    })
    node.start(plan.when, plan.offset, plan.duration)
    this.queuedSources.set(node, gain)
  }

  private scheduleReversedBuffer({
    clip,
    buffer,
    plan
  }: {
    clip: DesktopAudioClipSource
    buffer: AudioBuffer
    plan: NonNullable<ReturnType<typeof planReversedAudioChunk>>
  }): void {
    const context = this.audioContext
    if (!context || !this.masterGain) return
    const reversed = reverseAudioBufferSegment({
      context,
      buffer,
      offset: plan.offset,
      duration: plan.duration
    })
    if (!reversed) return

    const node = context.createBufferSource()
    const gain = context.createGain()
    node.buffer = reversed
    node.playbackRate.value = clip.playbackRate
    const fadedClip = clip as DesktopAudioClipSource & {
      fadeIn?: number
      fadeOut?: number
      volumeKeyframes?: import('../audio-keyframes').AudioVolumeKeyframe[]
    }
    scheduleAudioEnvelope({
      param: gain.gain,
      baseVolume: clip.volume,
      duration: clip.duration,
      fadeIn: fadedClip.fadeIn,
      fadeOut: fadedClip.fadeOut,
      volumeKeyframes: fadedClip.volumeKeyframes,
      chunkStart: plan.timelineStart - clip.startTime,
      chunkDuration: reversed.duration / clip.playbackRate,
      contextStart: plan.when
    })
    node.connect(gain)
    gain.connect(this.masterGain)
    node.addEventListener('ended', () => {
      node.disconnect()
      gain.disconnect()
      this.queuedSources.delete(node)
    })
    node.start(plan.when)
    this.queuedSources.set(node, gain)
  }

  private stopPlayback(): void {
    this.playbackSessionId++
    if (this.timelineChangeTimer !== null) {
      window.clearTimeout(this.timelineChangeTimer)
      this.timelineChangeTimer = null
    }
    for (const [timer, resolve] of this.waits) {
      window.clearTimeout(timer)
      resolve()
    }
    this.waits.clear()
    for (const input of this.inputs) input.dispose()
    this.inputs.clear()
    for (const [node, gain] of this.queuedSources) {
      try {
        node.stop()
      } catch {
        /* The buffer may have already ended. */
      }
      node.disconnect()
      gain.disconnect()
    }
    this.queuedSources.clear()
  }
}
