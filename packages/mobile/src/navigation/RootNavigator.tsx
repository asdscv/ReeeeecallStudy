import { useState, useEffect, useCallback } from 'react'
import { Appearance } from 'react-native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { AuthStack } from './AuthStack'
import { MainDrawer } from './MainDrawer'
import { useAuthState } from '../hooks/useAuthState'
import { LoadingScreen } from '../components/auth/LoadingScreen'
import { AuthGuardScreen } from '../components/auth/AuthGuardScreen'
import { SessionKickedScreen } from '../components/auth/SessionKickedScreen'
import { useSubscriptionStore } from '@reeeeecall/shared/stores/subscription-store'
import { getMobileSupabase } from '../adapters'
import type { RootStackParamList } from './types'

const Stack = createNativeStackNavigator<RootStackParamList>()

const MIN_SPLASH_MS = 2000

export function RootNavigator() {
  const { user, loading } = useAuthState()
  const [splashDone, setSplashDone] = useState(false)
  const [showAuthGuard, setShowAuthGuard] = useState(false)

  const registerSession = useSubscriptionStore((s) => s.registerSession)
  const startHeartbeat = useSubscriptionStore((s) => s.startHeartbeat)
  const sessionValid = useSubscriptionStore((s) => s.sessionValid)

  useEffect(() => {
    const timer = setTimeout(() => setSplashDone(true), MIN_SPLASH_MS)
    return () => clearTimeout(timer)
  }, [])

  // Register session + start heartbeat when user is logged in
  useEffect(() => {
    if (!user) return
    registerSession()
    const cleanup = startHeartbeat()
    return cleanup
  }, [user, registerSession, startHeartbeat])

  // Load saved theme preference on login (so it applies before visiting Settings)
  useEffect(() => {
    if (!user) return
    const supabase = getMobileSupabase()
    Promise.resolve(
      supabase.from('profiles').select('theme').eq('id', user.id).single()
    ).then(({ data }) => {
      const saved = (data as Record<string, unknown> | null)?.theme as 'light' | 'dark' | 'system' | undefined
      if (saved && saved !== 'system') {
        Appearance.setColorScheme(saved)
      }
    }).catch(() => {})
  }, [user])

  const handleReclaim = useCallback(async () => {
    await registerSession()
  }, [registerSession])

  const handleLogout = useCallback(async () => {
    const supabase = getMobileSupabase()
    await supabase.auth.signOut()
  }, [])

  // Show splash while loading or timer not done
  if (loading || !splashDone) {
    return <LoadingScreen />
  }

  // Session kicked → full screen overlay (matches web SessionKickedOverlay)
  if (user && !sessionValid) {
    return <SessionKickedScreen onReclaim={handleReclaim} onLogout={handleLogout} />
  }

  // Not logged in → show AuthGuard (card flip bg + CTA), then navigate to login
  if (!user && !showAuthGuard) {
    return <AuthGuardScreen onLogin={() => setShowAuthGuard(true)} />
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {user ? (
        <Stack.Screen name="Main" component={MainDrawer} />
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  )
}
