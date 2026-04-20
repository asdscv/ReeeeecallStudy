import { useState, useEffect, useCallback } from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { AuthStack } from './AuthStack'
import { MainDrawer } from './MainDrawer'
import { useAuthState } from '../hooks/useAuthState'
import { LoadingScreen } from '../components/auth/LoadingScreen'
import { AuthGuardScreen } from '../components/auth/AuthGuardScreen'
import { SessionKickedScreen } from '../components/auth/SessionKickedScreen'
import { useSubscriptionStore } from '@reeeeecall/shared/stores/subscription-store'
import { prefetch } from '../services/prefetch'
import type { RootStackParamList } from './types'

const Stack = createNativeStackNavigator<RootStackParamList>()

// 프리로드 최대 대기 — 이 시간 지나면 불완전해도 메인 화면 진입
const MAX_SPLASH_MS = 5000

export function RootNavigator() {
  const { user, loading } = useAuthState()
  const [appReady, setAppReady] = useState(false)
  const [prefetchProgress, setPrefetchProgress] = useState(0)
  const [showAuthGuard, setShowAuthGuard] = useState(false)

  const registerSession = useSubscriptionStore((s) => s.registerSession)
  const startHeartbeat = useSubscriptionStore((s) => s.startHeartbeat)
  const sessionValid = useSubscriptionStore((s) => s.sessionValid)

  // 최대 대기 타임아웃 — 네트워크 느려도 앱은 반드시 열림
  useEffect(() => {
    const timer = setTimeout(() => setAppReady(true), MAX_SPLASH_MS)
    return () => clearTimeout(timer)
  }, [])

  // Auth 확인 후 프리로드 시작
  useEffect(() => {
    if (!user) return

    // Progress 구독
    const unsub = prefetch.subscribe((state) => {
      setPrefetchProgress(state.progress)
      if (state.status === 'ready') setAppReady(true)
    })

    // 프리로드 실행 — decks, stats, templates, profile 병렬 로드
    prefetch.run(user.id)

    return unsub
  }, [user])

  // 테마는 prefetch 'profile' 태스크에서 Appearance.setColorScheme() 직접 호출.
  // 스플래시 중에 적용되므로 메인 화면 진입 전 반영 완료.

  // Register session + start heartbeat when user is logged in
  useEffect(() => {
    if (!user) return
    registerSession()
    const cleanup = startHeartbeat()
    return cleanup
  }, [user, registerSession, startHeartbeat])

  const handleReclaim = useCallback(async () => {
    await registerSession()
  }, [registerSession])

  const handleLogout = useCallback(async () => {
    prefetch.reset()
    const { getSupabase } = await import('@reeeeecall/shared/lib/supabase')
    await getSupabase().auth.signOut()
  }, [])

  // 스플래시: auth 로딩 중이거나 prefetch 미완료
  if (loading || !appReady) {
    return <LoadingScreen progress={prefetchProgress} />
  }

  // Session kicked → full screen overlay
  if (user && !sessionValid) {
    return <SessionKickedScreen onReclaim={handleReclaim} onLogout={handleLogout} />
  }

  // Not logged in → show AuthGuard
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
