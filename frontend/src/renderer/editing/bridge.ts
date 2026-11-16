import { generateUUID } from '@/utils/id'
import { EDITING_BRIDGE_CHANNEL } from '../../shared/editing'
import type { EditingBridgeMessage, EditingOperation } from '../../shared/editing'

const params = new URLSearchParams(window.location.hash.slice(1))
export const projectId = params.get('project') ?? ''
const session = params.get('session') ?? ''
export type WorkflowProgress = { status: 'queued' | 'running'; percent?: number; stage: string }
const pending = new Map<
  string,
  { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; onProgress?: (value: WorkflowProgress) => void }
>()
let flushHandler: (() => Promise<void>) | undefined

export function send(
  message: Omit<EditingBridgeMessage, 'channel' | 'session'>,
  transfer: Transferable[] = []
): void {
  window.parent.postMessage({ ...message, channel: EDITING_BRIDGE_CHANNEL, session }, window.location.origin, transfer)
}

export function request<T>(
  operation: EditingOperation,
  payload: unknown = {},
  transfer: Transferable[] = [],
  timeoutMs = 120000,
  onProgress?: (value: WorkflowProgress) => void
): Promise<T> {
  if (!session || window.parent === window)
    return Promise.reject(new Error('请从软件的剪辑首页打开工程'))
  const id = generateUUID()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('剪辑操作超时，请检查保存状态后重试'))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer, onProgress })
    send({ type: 'request', id, operation, payload }, transfer)
  })
}

export function setFlushHandler(handler: () => Promise<void>): void {
  flushHandler = handler
}

window.addEventListener('message', async (event) => {
  const message = event.data as EditingBridgeMessage
  if (
    event.source !== window.parent || event.origin !== window.location.origin ||
    message?.channel !== EDITING_BRIDGE_CHANNEL ||
    message.session !== session
  )
    return
  if (message.type === 'progress' && message.id) {
    pending.get(message.id)?.onProgress?.(message.payload)
  } else if (message.type === 'response' && message.id) {
    const callback = pending.get(message.id)
    if (!callback) return
    clearTimeout(callback.timer)
    pending.delete(message.id)
    if (message.error) callback.reject(new Error(message.error))
    else callback.resolve(message.result)
  } else if (message.type === 'theme') {
    document.documentElement.classList.toggle('dark', message.payload === 'dark')
  } else if (message.type === 'flush') {
    try {
      await flushHandler?.()
      send({ type: 'flushed', id: message.id })
    } catch (error) {
      send({
        type: 'flushed',
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
})

export function announceReady(): void {
  send({ type: 'ready' })
}

export function reportDiagnostic(event: string, detail = ''): void {
  send({ type: 'diagnostic', payload: { event, detail } })
}
