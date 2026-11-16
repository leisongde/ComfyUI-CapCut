import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny'
import type { MediaAsset } from '@/types/assets'
import { reportDiagnostic } from './bridge'

/** Decode metadata/one thumbnail with a deadline; the saved video remains usable on failure. */
export async function inspectGeneratedDirectorMedia(asset: MediaAsset): Promise<MediaAsset> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(asset.file) })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      (async () => {
        const duration = await input.computeDuration()
        const track = await input.getPrimaryVideoTrack()
        if (Number.isFinite(duration) && duration > 0) asset.duration = duration
        if (!track) return
        asset.width = track.displayWidth
        asset.height = track.displayHeight
        if (!await track.canDecode()) return
        const frame = await new VideoSampleSink(track).getSample(0)
        if (!frame) return
        try {
          const scale = Math.min(1, 640 / track.displayWidth, 360 / track.displayHeight)
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(track.displayWidth * scale))
          canvas.height = Math.max(1, Math.round(track.displayHeight * scale))
          const context = canvas.getContext('2d')
          if (context) {
            frame.draw(context, 0, 0, canvas.width, canvas.height)
            asset.thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8)
          }
        } finally { frame.close() }
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('生成视频预览读取超时，使用已保存的视频信息')), 12000)
      })
    ])
  } catch (failure) {
    reportDiagnostic('director-output-preview-fallback', String(failure))
  } finally {
    clearTimeout(timer)
    input.dispose()
  }
  return asset
}
