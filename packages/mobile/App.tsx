import { useEffect, useState } from 'react'
import { View, Image, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { NavigationContainer, type InitialState } from '@react-navigation/native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { I18nextProvider } from 'react-i18next'
import Constants from 'expo-constants'
import { initMobilePlatform } from './src/adapters'
import i18n from './src/i18n'
import { RootNavigator } from './src/navigation'
import { ThemeProvider, useAppTheme } from './src/theme'
import { loadNavState, saveNavState } from './src/utils/nav-persistence'
import { ErrorBoundary } from './src/components/ErrorBoundary'
import { ToastContainer } from './src/components/ui'

// Initialize platform adapters (must be before any shared code)
initMobilePlatform()

// Deep linking config — Constants.expoConfig.scheme은 빌드 시점에 앱 바이너리에 임베드되므로
// 어떤 빌드 방식(eas remote, eas local, expo run)이든 항상 사용 가능.
// Linking.createURL()은 eas build --local에서 "no custom scheme" 에러를 던지므로 사용 금지.
const APP_SCHEME = Constants.expoConfig?.scheme ?? 'reeeeecall'
const linking = {
  prefixes: [`${APP_SCHEME}://`],
  config: {
    screens: {
      Auth: 'auth',
      Main: 'main',
    },
  },
}

function AppContent() {
  const theme = useAppTheme()
  const [ready, setReady] = useState(false)
  const [initialNavState, setInitialNavState] = useState<InitialState | undefined>(undefined)

  // Restore persisted navigation state so a cold-start after backgrounding
  // (iOS reclaiming a memory-heavy study screen) returns the user to where
  // they were instead of resetting to the dashboard. Best-effort: any failure
  // resolves to `undefined` → default initial route.
  useEffect(() => {
    let mounted = true
    loadNavState()
      .then((state) => {
        if (!mounted) return
        setInitialNavState(state as InitialState | undefined)
      })
      .finally(() => {
        if (mounted) setReady(true)
      })
    return () => {
      mounted = false
    }
  }, [])

  if (!ready) {
    return (
      <View style={[styles.splash, { backgroundColor: theme.colors.background }]}>
        {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
        <Image source={require('./assets/splash-icon.png')} style={styles.logo} resizeMode="contain" />
      </View>
    )
  }

  return (
    <ThemeProvider value={theme}>
      <NavigationContainer
        linking={linking}
        initialState={initialNavState}
        onStateChange={(state) => {
          if (state) void saveNavState(state)
        }}
      >
        <ErrorBoundary>
          <RootNavigator />
        </ErrorBoundary>
      </NavigationContainer>
      <ToastContainer />
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  )
}

export default function App() {
  return (
    // node_modules carries two copies of i18next types (root vs react-i18next's
    // nested dep); the runtime instance is the same one used everywhere, so we
    // assert compatibility rather than fail the build on a type-dedup artifact.
    <I18nextProvider i18n={i18n as never}>
      <SafeAreaProvider>
        <AppContent />
      </SafeAreaProvider>
    </I18nextProvider>
  )
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 80, height: 80 },
})
