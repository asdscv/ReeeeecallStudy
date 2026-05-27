import { create } from 'zustand'

/**
 * Global confirm — imperative, Promise-based replacement for window.confirm().
 *
 * Renders the themed, accessible <ConfirmDialog> (Radix: focus-trap + fade)
 * instead of the OS-native dialog that breaks theming. Call from any event
 * handler:
 *
 *   if (!(await confirm({ message: t('...'), danger: true }))) return
 *
 * A single <GlobalConfirmDialog/> mounted at the app root reads this store.
 */
export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

interface ConfirmState {
  open: boolean
  options: ConfirmOptions | null
  _resolve: ((value: boolean) => void) | null
  confirm: (options: ConfirmOptions) => Promise<boolean>
  handleConfirm: () => void
  handleCancel: () => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  _resolve: null,
  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      // If a prior confirm is somehow still pending, resolve it false first.
      get()._resolve?.(false)
      set({ open: true, options, _resolve: resolve })
    }),
  handleConfirm: () => {
    get()._resolve?.(true)
    set({ open: false, _resolve: null })
  },
  handleCancel: () => {
    get()._resolve?.(false)
    set({ open: false, _resolve: null })
  },
}))

/** Non-hook accessor for use inside event handlers. */
export const confirm = (options: ConfirmOptions) => useConfirmStore.getState().confirm(options)
