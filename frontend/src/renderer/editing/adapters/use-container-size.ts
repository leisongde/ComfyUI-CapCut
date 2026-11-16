import { useEffect, useState } from 'react'

type ContainerSize = { width: number; height: number }

export function useContainerSize({
  containerRef
}: {
  containerRef: React.RefObject<HTMLElement | null>
}): ContainerSize {
  const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const ownerWindow = container.ownerDocument.defaultView ?? window
    const ResizeObserverConstructor = ownerWindow.ResizeObserver ?? ResizeObserver
    const update = () => {
      const rect = container.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    }
    const observer = new ResizeObserverConstructor(updateEntries => {
      const rect = updateEntries[0]?.contentRect
      if (rect) setSize({ width: rect.width, height: rect.height })
      else update()
    })

    observer.observe(container)
    update()
    ownerWindow.addEventListener('resize', update)

    return () => {
      observer.disconnect()
      ownerWindow.removeEventListener('resize', update)
    }
  }, [containerRef])

  return size
}
