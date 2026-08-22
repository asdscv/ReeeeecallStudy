import { useState, useEffect, useCallback } from 'react'
import { AppState } from 'react-native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { AuthStack } from './AuthStack'
import { MainDrawer } from './MainDrawer'
import { useAuthState } from '../hooks/useAuthState'
import { LoadingScreen } from '../components/auth/LoadingScreen'
import { AuthGuardScreen } from '../components/auth/AuthGuardScreen'
import { SessionKickedScreen } from '../components/auth/SessionKickedScreen'
import { useSubscriptionStore } from '@reeeeecall/shared/stores/subscription-store'
import { useAppUpdateStore } from '../services/app-update'
import { ForceUpdateScreen } from '../components/update/ForceUpdateScreen'
import { OptionalUpdateModal } from '../components/update/OptionalUpdateModal'
import { prefetch } from '../services/prefetch'
import { clearNavState } from '../utils/nav-persistence'
import type { RootStackParamList } from './types'

const Stack = createNativeStackNavigator<RootStackParamList>()

// 프리로드 최대 대기 — 이 시간 지나면 불완전해도 메인 화면 진입
const MAX_SPLASH_MS = 5000

export function RootNavigator() {
  const { user, loading } = useAuthState()
  const [appReady, setAppReady] = useState(false)
  const [prefetchProgress, setPrefetchProgress] = useState(0)
  const [showAuthGuard, setShowAuthGuard] = useState(false)

  // Key session effects on the user ID, not the `user` object. `useAuthState`
  // does `setUser(s?.user ?? null)` on EVERY auth event, and a TOKEN_REFRESHED
  // hands back a freshly parsed session — a new object with the same id. Keyed on
  // `user`, the register effect below therefore re-ran on every token refresh and
  // silently evicted the other device. Registering must mean "the user opened the
  // app / logged in", not "supabase-js rotated a JWT".
  const userId = user?.id ?? null

  const registerSession = useSubscriptionStore((s) => s.registerSession)
  const revalidateSession = useSubscriptionStore((s) => s.revalidateSession)
  const startHeartbeat = useSubscriptionStore((s) => s.startHeartbeat)
  const sessionValid = useSubscriptionStore((s) => s.sessionValid)

  // Backend-driven version gate. Runs once on mount, independent of auth so a
  // hard block applies even before login. Fail-open: status stays 'ok' until
  // (and unless) the check resolves to 'blocked', so the app never stalls here.
  const updateStatus = useAppUpdateStore((s) => s.status)
  const checkAppUpdate = useAppUpdateStore((s) => s.check)
  useEffect(() => {
    void checkAppUpdate()
  }, [checkAppUpdate])

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

  // Register session + start heartbeat when user is logged in.
  // register가 행을 INSERT하기 전에 heartbeat가 UPDATE를 실행하면 0행 → 오인 킥.
  // → 반드시 register 완료를 await한 뒤 heartbeat 시작.
  useEffect(() => {
    if (!userId) return
    let cleanup: (() => void) | undefined
    let cancelled = false
    ;(async () => {
      await registerSession()
      if (cancelled) return
      cleanup = startHeartbeat()
    })()
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [userId, registerSession, startHeartbeat])

  // On return to foreground, REVALIDATE — never re-register. `registerSession`
  // evicts the other device of this platform, so re-registering on every resume
  // made "coming back" mean "taking the session away", and the two phones
  // ping-ponged: the phone you are actually using is already 'active' and so
  // never fires a resume event to steal back, while the idle phone in your pocket
  // fires one every time its screen wakes. Net effect was exactly backwards — the
  // device in your hand got the "logged in on another device" screen.
  //
  // A heartbeat answers "is my row still there?" without touching anyone else's.
  // Claiming the session stays where the user actually meant it: an explicit
  // login, a cold start, or the SessionKicked screen's reclaim button.
  //
  // Only a REAL background→foreground counts. iOS (and only iOS — see
  // AppState's `@platform ios` note) reports 'inactive' for the multitasking
  // view, Notification Center and incoming calls, and a resume reads
  // background→inactive→active, so we latch on 'background' rather than
  // matching whatever state happened to precede 'active'.
  useEffect(() => {
    if (!userId) return
    let wasBackgrounded = AppState.currentState === 'background'
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        wasBackgrounded = true
      } else if (next === 'active' && wasBackgrounded) {
        wasBackgrounded = false
        void revalidateSession()
      }
    })
    return () => sub.remove()
  }, [userId, revalidateSession])

  const handleReclaim = useCallback(async () => {
    await registerSession()
  }, [registerSession])

  const handleLogout = useCallback(async () => {
    prefetch.reset()
    await clearNavState()
    const { getSupabase } = await import('@reeeeecall/shared/lib/supabase')
    const auth = getSupabase().auth
    // A global sign-out asks the server to revoke the session, and that call can fail — an
    // expired refresh token, no network, or a user row that no longer exists. This is the
    // single-device screen's ONLY escape: there is no drawer, no tab bar and no back gesture
    // behind it, so a failed sign-out leaves the app permanently on it and deleting the app
    // is the only way out. Observed on a simulator holding a session for a deleted account.
    //
    // `scope: 'local'` needs no server and always clears the stored session, which is what
    // makes `user` null and lets the navigator move on.
    try {
      const { error } = await auth.signOut()
      if (error) throw error
    } catch {
      await auth.signOut({ scope: 'local' }).catch(() => {})
    }
  }, [])

  // Hard version gate takes priority over everything — a build below the
  // minimum supported version is unusable regardless of auth/session/splash.
  if (updateStatus === 'blocked') {
    return <ForceUpdateScreen />
  }

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
    <>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        {user ? (
          <Stack.Screen name="Main" component={MainDrawer} />
        ) : (
          <Stack.Screen name="Auth" component={AuthStack} />
        )}
      </Stack.Navigator>
      {/* Soft update nudge (dismissable) — only renders when status==='optional' */}
      <OptionalUpdateModal />
    </>
  )
}
