import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

export const TIMELINE_VIEWPORT_EVENT = 'raccoon:timeline-viewport-updated'
export const TIMELINE_PIXELS_PER_SECOND = 50
export const TIMELINE_END_PADDING_PIXELS = 120

export function getTimelineContentWidth(options: {
  duration: number
  pixelsPerSecond: number
  scrollLeft: number
  viewportWidth: number
  originOffset: number
  endPadding?: number
}): number {
  const durationWidth =
    Math.max(0, Number(options.duration) || 0) *
      Math.max(0, Number(options.pixelsPerSecond) || 0) +
    Math.max(0, Number(options.endPadding ?? TIMELINE_END_PADDING_PIXELS) || 0)
  const visibleWidth =
    Math.max(0, Number(options.scrollLeft) || 0) +
    Math.max(0, Number(options.viewportWidth) || 0) -
    Math.max(0, Number(options.originOffset) || 0)

  return Math.max(1, durationWidth, visibleWidth)
}

export interface TimelineViewportState {
  zoomLevel: number
  scrollLeft: number
  viewportLeft: number
  viewportWidth: number
  duration: number
}

const DEFAULT_VIEWPORT: TimelineViewportState = {
  zoomLevel: 1,
  scrollLeft: 0,
  viewportLeft: 0,
  viewportWidth: 0,
  duration: 0
}

let viewportState = DEFAULT_VIEWPORT
let scrollRequest: ((scrollLeft: number) => void) | null = null

export function getTimelineViewport(): TimelineViewportState {
  return viewportState
}

export function publishTimelineViewport(next: TimelineViewportState): void {
  const normalized: TimelineViewportState = {
    zoomLevel: Number.isFinite(next.zoomLevel) && next.zoomLevel > 0 ? next.zoomLevel : 1,
    scrollLeft: Math.max(0, Number(next.scrollLeft) || 0),
    viewportLeft: Number(next.viewportLeft) || 0,
    viewportWidth: Math.max(0, Number(next.viewportWidth) || 0),
    duration: Math.max(0, Number(next.duration) || 0)
  }
  if (
    viewportState.zoomLevel === normalized.zoomLevel &&
    viewportState.scrollLeft === normalized.scrollLeft &&
    viewportState.viewportLeft === normalized.viewportLeft &&
    viewportState.viewportWidth === normalized.viewportWidth &&
    viewportState.duration === normalized.duration
  ) return
  viewportState = normalized
  window.dispatchEvent(new CustomEvent(TIMELINE_VIEWPORT_EVENT, { detail: normalized }))
}

export function requestTimelineScroll(scrollLeft: number): void {
  scrollRequest?.(Math.max(0, Number(scrollLeft) || 0))
}

export function useTimelineViewport(): TimelineViewportState {
  const [state, setState] = useState(viewportState)

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const next = (event as CustomEvent<TimelineViewportState>).detail
      if (next) setState(next)
    }
    window.addEventListener(TIMELINE_VIEWPORT_EVENT, handleUpdate)
    setState(viewportState)
    return () => window.removeEventListener(TIMELINE_VIEWPORT_EVENT, handleUpdate)
  }, [])

  return state
}

/** Publishes the native Cutia timeline viewport without modifying its source files. */
export function useTimelineViewportSync(
  zoomLevel: number,
  scrollRef: RefObject<HTMLDivElement | null>,
  duration: number
): void {
  useEffect(() => {
    const scrollElement = scrollRef.current
    const publish = () => {
      const rect = scrollElement?.getBoundingClientRect()
      publishTimelineViewport({
        zoomLevel,
        scrollLeft: scrollElement?.scrollLeft ?? 0,
        viewportLeft: rect?.left ?? 0,
        viewportWidth: scrollElement?.clientWidth ?? 0,
        duration
      })
    }

    scrollRequest = (nextScrollLeft) => {
      if (!scrollElement) return
      const maximumScroll = Math.max(0, scrollElement.scrollWidth - scrollElement.clientWidth)
      scrollElement.scrollLeft = Math.max(0, Math.min(maximumScroll, nextScrollLeft))
    }
    publish()
    scrollElement?.addEventListener('scroll', publish, { passive: true })
    window.addEventListener('resize', publish)
    const resizeObserver = scrollElement && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(publish)
      : null
    if (resizeObserver && scrollElement) resizeObserver.observe(scrollElement)
    return () => {
      scrollElement?.removeEventListener('scroll', publish)
      window.removeEventListener('resize', publish)
      resizeObserver?.disconnect()
      scrollRequest = null
    }
  }, [scrollRef, zoomLevel, duration])
}
