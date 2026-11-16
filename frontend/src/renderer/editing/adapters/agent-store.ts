import { create } from 'zustand'
import type { AgentMessage } from '@/lib/ai/agent/types'

// Preserve upstream project metadata while AI capabilities are connected to desktop services later.
export const useAgentStore = create<{
  messages: AgentMessage[]
  initMessages(messages: AgentMessage[]): void
  getMessages(): AgentMessage[]
}>((set, get) => ({
  messages: [],
  initMessages: (messages) => set({ messages }),
  getMessages: () => get().messages
}))
