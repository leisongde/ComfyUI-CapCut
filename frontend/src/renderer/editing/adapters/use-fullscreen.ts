import { useCallback, useEffect, useState } from 'react'

/**
 * Fullscreen support for both the embedded editor and the detached monitor.
 *
 * A detached monitor is rendered through a React portal into another window.
 * The global `document` still points at the editor iframe in that case, while
 * the fullscreen element belongs to the monitor window's document. Resolve
 * the document from the container so both states and API calls target the
 * same browsing context.
 */
export function useFullscreen({
  containerRef
}: {
  containerRef: React.RefObject<HTMLElement | null>
}) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const ownerDocument = containerRef.current?.ownerDocument ?? document
    const handleChange = () => {
      setIsFullscreen(ownerDocument.fullscreenElement !== null)
    }

    handleChange()
    ownerDocument.addEventListener('fullscreenchange', handleChange)
    return () => {
      ownerDocument.removeEventListener('fullscreenchange', handleChange)
    }
  }, [containerRef])

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const ownerDocument = container.ownerDocument
    if (ownerDocument.fullscreenElement) {
      void ownerDocument.exitFullscreen().catch(() => undefined)
      return
    }

    void container.requestFullscreen().catch(() => undefined)
  }, [containerRef])

  return { isFullscreen, toggleFullscreen }
}
