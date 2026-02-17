import { create } from 'zustand'
import type { User, Session, Subscription } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>
  signInWithProvider: (provider: 'google' | 'github' | 'apple') => Promise<{ error: Error | null }>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<{ error: Error | null }>
}

// Module-level guards — prevent duplicate subscriptions across multiple initialize() calls
let _initializePromise: Promise<void> | null = null
let _subscription: Subscription | null = null

/** Reset module-level internals — for tests only */
export function _resetAuthStoreInternals() {
  _initializePromise = null
  if (_subscription) {
    _subscription.unsubscribe()
    _subscription = null
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,

  initialize: () => {
    if (_initializePromise) return _initializePromise

    _initializePromise = (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        set({
          session,
          user: session?.user ?? null,
          loading: false,
        })
      } catch {
        set({ session: null, user: null, loading: false })
      }

      if (!_subscription) {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          const currentUser = useAuthStore.getState().user
          const newUser = session?.user ?? null

          // Skip update if the user hasn't actually changed — prevents
          // unnecessary re-renders when Supabase refreshes the session on
          // tab focus.
          if (currentUser?.id === newUser?.id && !useAuthStore.getState().loading) {
            return
          }

          set({
            session,
            user: newUser,
            loading: false,
          })
        })
        _subscription = subscription
      }
    })()

    return _initializePromise
  },

  signIn: async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error ? new Error(error.message) : null }
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) }
    }
  },

  signUp: async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      return { error: error ? new Error(error.message) : null }
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) }
    }
  },

  signInWithProvider: async (provider: 'google' | 'github' | 'apple') => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      return { error: error ? new Error(error.message) : null }
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) }
    }
  },

  resetPassword: async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback`,
      })
      return { error: error ? new Error(error.message) : null }
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) }
    }
  },

  updatePassword: async (password: string) => {
    try {
      const { error } = await supabase.auth.updateUser({ password })
      return { error: error ? new Error(error.message) : null }
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) }
    }
  },

  signOut: async () => {
    try {
      const { error } = await supabase.auth.signOut()
      set({ user: null, session: null })
      return { error: error ? new Error(error.message) : null }
    } catch (e) {
      set({ user: null, session: null })
      return { error: e instanceof Error ? e : new Error(String(e)) }
    }
  },
}))
