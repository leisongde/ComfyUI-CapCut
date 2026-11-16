import { useEffect, useState } from 'react'

interface PlaybackClock {
  getCurrentTime(): number
  getIsPlaying(): boolean
  getIsScrubbing(): boolean
  subscribe(listener: () => void): () => void
}

type PlaybackTimeEvent = CustomEvent<{ time?: number }>

function getEventTime(event: Event, playback: PlaybackClock): number {
  const time = (event as PlaybackTimeEvent).detail?.time
  return Number.isFinite(time) ? time! : playback.getCurrentTime()
}

/** Keeps time-dependent controls current without re-rendering the whole editor every animation frame. */
export function usePlaybackTime(playback: PlaybackClock, updatesPerSecond = 15): number {
  const [time, setTime] = useState(() => playback.getCurrentTime())

  useEffect(() => {
    const interval = 1000 / Math.max(1, updatesPerSecond)
    let lastUpdate = 0

    const syncNow = () => {
      lastUpdate = performance.now()
      setTime(playback.getCurrentTime())
    }
    const handlePlaybackUpdate = (event: Event) => {
      const now = performance.now()
      if (now - lastUpdate < interval) return
      lastUpdate = now
      setTime(getEventTime(event, playback))
    }
    const handleSeek = (event: Event) => {
      lastUpdate = performance.now()
      setTime(getEventTime(event, playback))
    }

    const unsubscribe = playback.subscribe(syncNow)
    window.addEventListener('playback-update', handlePlaybackUpdate)
    window.addEventListener('playback-seek', handleSeek)
    syncNow()

    return () => {
      unsubscribe()
      window.removeEventListener('playback-update', handlePlaybackUpdate)
      window.removeEventListener('playback-seek', handleSeek)
    }
  }, [playback, updatesPerSecond])

  return time
}

export function bindTimelinePlayhead({
  element,
  playback,
  zoomLevel,
  pixelsPerSecond,
  rulerViewport,
  tracksViewport
}: {
  element: HTMLDivElement
  playback: PlaybackClock
  zoomLevel: number
  pixelsPerSecond: number
  rulerViewport: HTMLDivElement
  tracksViewport: HTMLDivElement
}): () => void {
  const updatePosition = (time: number, allowAutoScroll: boolean) => {
    const playheadPixels = time * pixelsPerSecond * zoomLevel

    if (allowAutoScroll && playback.getIsPlaying() && !playback.getIsScrubbing()) {
      const viewportWidth = rulerViewport.clientWidth
      const viewportStart = rulerViewport.scrollLeft
      const viewportEnd = viewportStart + viewportWidth
      if (playheadPixels < viewportStart || playheadPixels > viewportEnd) {
        const scrollMaximum = Math.max(0, rulerViewport.scrollWidth - viewportWidth)
        const desiredScroll = Math.max(
          0,
          Math.min(scrollMaximum, playheadPixels - viewportWidth / 2)
        )
        rulerViewport.scrollLeft = desiredScroll
        tracksViewport.scrollLeft = desiredScroll
      }
    }

    element.style.transform = `translate3d(${playheadPixels - tracksViewport.scrollLeft}px, 0, 0)`
    element.setAttribute('aria-valuenow', String(time))
  }

  const handlePlaybackTime = (event: Event) => {
    updatePosition(getEventTime(event, playback), true)
  }
  const handleScroll = () => updatePosition(playback.getCurrentTime(), false)

  window.addEventListener('playback-update', handlePlaybackTime)
  window.addEventListener('playback-seek', handlePlaybackTime)
  tracksViewport.addEventListener('scroll', handleScroll, { passive: true })
  updatePosition(playback.getCurrentTime(), false)

  return () => {
    window.removeEventListener('playback-update', handlePlaybackTime)
    window.removeEventListener('playback-seek', handlePlaybackTime)
    tracksViewport.removeEventListener('scroll', handleScroll)
  }
}
