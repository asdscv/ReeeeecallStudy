import { useState, useEffect } from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { AuthStack } from './AuthStack'
import { MainDrawer } from './MainDrawer'
import { useAuthState } from '../hooks/useAuthState'
import { LoadingScreen } from '../components/auth/LoadingScreen'
import { AuthGuardScreen } from '../components/auth/AuthGuardScreen'
import type { RootStackParamList } from './types'

const Stack = createNativeStackNavigator<RootStackParamList>()

const MIN_SPLASH_MS = 2000

export function RootNavigator() {
  const { user, loading } = useAuthState()
  const [splashDone, setSplashDone] = useState(false)
  const [showAuthGuard, setShowAuthGuard] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSplashDone(true), MIN_SPLASH_MS)
    return () => clearTimeout(timer)
  }, [])

  // Show splash while loading or timer not done
  if (loading || !splashDone) {
    return <LoadingScreen />
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
