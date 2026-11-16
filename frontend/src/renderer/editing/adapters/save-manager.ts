import type { EditorCore } from '@/core'
import { useAgentStore } from './agent-store'

/** Serialize saves and make flush wait for the latest edits before navigating or closing. */
export class SaveManager {
  private paused = false
  private pending = false
  private inFlight: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private subscriptions: Array<() => void> = []
  private listeners = new Set<() => void>()
  private snapshot = { dirty: false, saving: false, error: '' }
  private beforeSave: () => Promise<void> = () => Promise.resolve()
  constructor(private editor: EditorCore) {}
  setBeforeSave(handler: () => Promise<void>): void {
    this.beforeSave = handler
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.snapshot
  private notify(error = this.snapshot.error): void {
    this.snapshot = {
      dirty: this.pending || Boolean(this.inFlight),
      saving: Boolean(this.inFlight),
      error
    }
    this.listeners.forEach((listener) => listener())
  }
  start(): void {
    if (this.subscriptions.length) return
    this.subscriptions = [
      this.editor.scenes.subscribe(() => this.markDirty()),
      this.editor.timeline.subscribe(() => this.markDirty()),
      useAgentStore.subscribe((state, old) => {
        if (state.messages !== old.messages) this.markDirty()
      })
    ]
  }
  stop(): void {
    this.subscriptions.forEach((unsubscribe) => unsubscribe())
    this.subscriptions = []
    this.clearTimer()
  }
  pause(): void {
    this.paused = true
    this.clearTimer()
  }
  resume(): void {
    this.paused = false
    if (this.pending) this.queue()
  }
  getIsDirty(): boolean {
    return this.pending || Boolean(this.inFlight)
  }
  markDirty({ force = false }: { force?: boolean } = {}): void {
    if (this.paused && !force) return
    this.pending = true
    this.notify()
    this.queue()
  }
  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
  private queue(): void {
    if (this.paused || this.inFlight) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      void this.saveNow().catch(() => {})
    }, 800)
  }
  private async saveNow(): Promise<void> {
    if (this.inFlight) return this.inFlight
    if (
      !this.pending ||
      this.paused ||
      !this.editor.project.getActiveOrNull() ||
      this.editor.project.getIsLoading()
    )
      return
    this.clearTimer()
    this.pending = false
    this.inFlight = (async () => {
      await this.beforeSave()
      await this.editor.project.saveCurrentProject()
    })()
    this.notify('')
    let succeeded = false
    try {
      await this.inFlight
      succeeded = true
    } catch (error) {
      this.pending = true
      this.notify(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      this.inFlight = null
      this.notify(succeeded ? '' : this.snapshot.error)
      if (succeeded && this.pending) this.queue()
    }
  }
  async flush(): Promise<void> {
    if (!this.editor.project.getActiveOrNull()) return
    if (this.paused) throw new Error('工程仍在加载，请稍后再保存')
    this.pending = true
    this.clearTimer()
    while (this.pending || this.inFlight) {
      if (this.inFlight) await this.inFlight
      else await this.saveNow()
      if (this.editor.project.getIsLoading()) throw new Error('工程仍在加载，请稍后再保存')
    }
  }
}
