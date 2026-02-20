import { create } from 'zustand'
import type { User, Session, Subscription } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../types/database'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  role: UserRole | null
  initialize: () => Promise<void>
  fetchRole: () => Promise<void>
  isAdmin: () => boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: Error | null }>
  signInWithProvider: (provider: 'google' | 'github' | 'apple') => Promise<{ error: Error | null }>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (password: string) => Promise<{ error: Error | null }>
  checkNicknameAvailability: (nickname: string) => Promise<{ available: boolean; error: Error | null }>
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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,
  role: null,

  fetchRole: async () => {
    const user = get().user
    if (!user) {
      set({ role: null })
      return
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (error || !data) {
        set({ role: 'user' })
      } else {
        set({ role: (data.role as UserRole) ?? 'user' })
      }
    } catch {
      set({ role: 'user' })
    }
  },

  isAdmin: () => get().role === 'admin',

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
        if (session?.user) {
          await useAuthStore.getState().fetchRole()
        }
      } catch {
        set({ session: null, user: null, loading: false })
      }

      if (!_subscription) {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
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

          if (newUser) {
            await useAuthStore.getState().fetchRole()
          } else {
            set({ role: null })
          }
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

  signUp: async (email: string, password: string, displayName: string) => {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: { display_name: displayName },
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

  checkNicknameAvailability: async (nickname: string) => {
    try {
      const { data, error } = await supabase.rpc('check_nickname_available', {
        p_nickname: nickname.trim(),
      })
      if (error) return { available: false, error: new Error(error.message) }
      if (!data) return { available: false, error: new Error('No data returned') }
      return { available: (data as { available: boolean }).available, error: null }
    } catch (e) {
      return { available: false, error: e instanceof Error ? e : new Error(String(e)) }
    }
  },

  signOut: async () => {
    try {
      const { error } = await supabase.auth.signOut()
      set({ user: null, session: null, role: null })
      return { error: error ? new Error(error.message) : null }
    } catch (e) {
      set({ user: null, session: null, role: null })
      return { error: e instanceof Error ? e : new Error(String(e)) }
    }
  },
}))
