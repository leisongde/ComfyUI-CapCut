import { useSyncExternalStore } from 'react'

export type SmartCutoutRuntimeStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; backend: 'webgpu' | 'webgl' }
  | { state: 'error'; message: string }

let status: SmartCutoutRuntimeStatus = { state: 'idle' }
const listeners = new Set<() => void>()

export function setSmartCutoutRuntimeStatus(next: SmartCutoutRuntimeStatus): void {
  status = next
  for (const listener of listeners) listener()
}

export function getSmartCutoutRuntimeStatus(): SmartCutoutRuntimeStatus {
  return status
}

export function subscribeSmartCutoutRuntime(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSmartCutoutRuntimeStatus(): SmartCutoutRuntimeStatus {
  return useSyncExternalStore(
    subscribeSmartCutoutRuntime,
    getSmartCutoutRuntimeStatus,
    getSmartCutoutRuntimeStatus
  )
}
