import { useState, useEffect } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { getMobileSupabase } from '../adapters'

/**
 * Core auth state hook.
 * Listens to Supabase auth state changes and provides user/session/loading.
 *
 * Enterprise pattern: single source of truth for auth state,
 * any screen/component can subscribe via this hook.
 */
export function useAuthState() {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = getMobileSupabase()

    // 1. Load existing session from SecureStore
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      setLoading(false)
    })

    // 2. Listen to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s)
        setUser(s?.user ?? null)
        setLoading(false)
      },
    )

    return () => subscription.unsubscribe()
  }, [])

  return { user, session, loading }
}
