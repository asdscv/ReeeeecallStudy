import { useState, useCallback } from 'react'
import { Platform } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import * as AuthSession from 'expo-auth-session'
import * as AppleAuthentication from 'expo-apple-authentication'
import { getMobileSupabase } from '../adapters'
import { validatePassword } from '@reeeeecall/shared/lib/password-validation'
import { localizeAuthError } from '@reeeeecall/shared/lib/auth-errors'

// Dismiss browser on redirect
WebBrowser.maybeCompleteAuthSession()

export interface AuthActions {
  // Email auth
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signUp: (email: string, password: string, displayName: string) => Promise<{ error?: string }>
  resetPassword: (email: string) => Promise<{ error?: string }>
  signOut: () => Promise<void>
  // OAuth
  signInWithGoogle: () => Promise<{ error?: string }>
  signInWithApple: () => Promise<{ error?: string }>
  // State
  loading: boolean
}

/**
 * Auth actions hook — imperative auth operations.
 * Separated from useAuthState for clean separation of concerns:
 * - useAuthState = reactive (subscribe to changes)
 * - useAuth = imperative (trigger actions)
 */
export function useAuth(): AuthActions {
  const [loading, setLoading] = useState(false)

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true)
    try {
      const supabase = getMobileSupabase()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { error: localizeAuthError(error.message) }
      return {}
    } catch (e) {
      return { error: 'An unexpected error occurred' }
    } finally {
      setLoading(false)
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    // Validate password client-side
    const validation = validatePassword(password)
    if (!validation.valid) {
      return { error: validation.errors[0] }
    }

    setLoading(true)
    try {
      const supabase = getMobileSupabase()
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
        },
      })
      if (error) return { error: localizeAuthError(error.message) }
      return {}
    } catch (e) {
      return { error: 'An unexpected error occurred' }
    } finally {
      setLoading(false)
    }
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    setLoading(true)
    try {
      const supabase = getMobileSupabase()
      const { error } = await supabase.auth.resetPasswordForEmail(email)
      if (error) return { error: localizeAuthError(error.message) }
      return {}
    } catch (e) {
      return { error: 'An unexpected error occurred' }
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    const supabase = getMobileSupabase()
    await supabase.auth.signOut()
  }, [])

  const signInWithGoogle = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = getMobileSupabase()
      const redirectTo = AuthSession.makeRedirectUri()

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      })

      if (error) return { error: localizeAuthError(error.message) }

      if (data.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
        if (result.type !== 'success') {
          return { error: 'Login was cancelled' }
        }
      }

      return {}
    } catch (e) {
      return { error: 'Google login failed' }
    } finally {
      setLoading(false)
    }
  }, [])

  const signInWithApple = useCallback(async () => {
    setLoading(true)
    try {
      if (Platform.OS === 'ios') {
        // Native Apple Sign-In on iOS
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        })

        if (!credential.identityToken) {
          return { error: 'Apple Sign-In failed: no identity token' }
        }

        const supabase = getMobileSupabase()
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        })

        if (error) return { error: localizeAuthError(error.message) }
        return {}
      } else {
        // Android: OAuth web flow (same pattern as Google)
        const supabase = getMobileSupabase()
        const redirectTo = AuthSession.makeRedirectUri()

        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'apple',
          options: { redirectTo },
        })

        if (error) return { error: localizeAuthError(error.message) }

        if (data.url) {
          const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
          if (result.type !== 'success') {
            return { error: 'Login was cancelled' }
          }
        }

        return {}
      }
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') {
        return { error: 'Login was cancelled' }
      }
      return { error: 'Apple login failed' }
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    signIn,
    signUp,
    resetPassword,
    signOut,
    signInWithGoogle,
    signInWithApple,
    loading,
  }
}
