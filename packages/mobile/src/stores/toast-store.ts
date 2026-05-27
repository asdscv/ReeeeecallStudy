import { create } from 'zustand'

/**
 * Toast — transient, non-blocking feedback for successes and recoverable
 * errors. Replaces Alert.alert() for anything that isn't a destructive
 * confirmation, matching native HIG/Material guidance (snackbar/banner).
 *
 * Usage (outside React):  toast.success(t('decks.created'))
 */
export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
}

const MAX_VISIBLE = 3
const DEFAULT_DURATION = 3000

interface ToastState {
  toasts: ToastItem[]
  show: (message: string, type?: ToastType, duration?: number) => void
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, type = 'info', duration = DEFAULT_DURATION) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((s) => ({ toasts: [...s.toasts, { id, type, message }].slice(-MAX_VISIBLE) }))
    setTimeout(() => get().dismiss(id), duration)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Non-hook accessor for event handlers / stores. */
export const toast = {
  success: (message: string) => useToastStore.getState().show(message, 'success'),
  error: (message: string) => useToastStore.getState().show(message, 'error'),
  info: (message: string) => useToastStore.getState().show(message, 'info'),
}
