import { useCallback, useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { NavigationContainer, type InitialState } from '@react-navigation/native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { I18nextProvider } from 'react-i18next'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { initMobilePlatform } from './src/adapters'
import i18n from './src/i18n'
import { RootNavigator } from './src/navigation'
import { ThemeProvider, useAppTheme } from './src/theme'
import { loadNavState, saveNavState } from './src/utils/nav-persistence'
import { tryColdStartOtaSwap, type UpdatesGate } from './src/utils/cold-start-ota'
import { ErrorBoundary } from './src/components/ErrorBoundary'
import { ToastContainer } from './src/components/ui'

// Initialize platform adapters (must be before any shared code)
initMobilePlatform()

// Hold the native splash through the JS boot (OTA cold-start swap + nav-state
// restore) so there's no logo flash between the native splash and the first
// screen. `AppContent` hides it once the first screen has laid out. Without
// this the native splash auto-hides on the first RN frame, exposing a blank/
// mismatched gap — the old 80×80 in-JS splash existed only to paper over it.
void SplashScreen.preventAutoHideAsync().catch(() => {})

// Cold-start OTA budget. Long enough to actually receive a small JS bundle on
// 4G, short enough that nobody ever stares at the splash. Tuned for the median
// EAS Update bundle size (~3-5 MB). Tests bound this aggressively.
const COLD_START_OTA_TIMEOUT_MS = 3000

// Adapter that maps the live `expo-updates` module to our pure `UpdatesGate`
// interface so the swap logic is testable without mocking the module system.
// Getters preserve laziness — `Updates.isEnabled` is read at boot time, not at
// module-evaluation time, so a hot-reloaded dev session sees the current value.
const updatesGate: UpdatesGate = {
  get isEnabled() { return Updates.isEnabled },
  get isEmergencyLaunch() { return Updates.isEmergencyLaunch },
  checkForUpdate: () => Updates.checkForUpdateAsync(),
  fetchUpdate: async () => { await Updates.fetchUpdateAsync() },
  reload: () => Updates.reloadAsync() as Promise<never>,
}

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

  // Boot sequence:
  //   1) Try to swap to the latest OTA while still on the splash. If a swap is
  //      issued, `Updates.reloadAsync` restarts the JS context and this
  //      effect's resolve never fires — the new bundle then re-enters here.
  //      Bounded by `COLD_START_OTA_TIMEOUT_MS` so a slow network can never
  //      block the user. Skipped in dev, on disabled-updates builds, and on
  //      emergency launches.
  //   2) Restore the persisted navigation state so a cold-start after
  //      backgrounding (iOS reclaiming a memory-heavy study screen) returns
  //      the user to where they were. Best-effort: any failure resolves to
  //      `undefined` → default initial route.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      // 1) OTA cold-start swap (may not return — process reloads).
      try {
        await tryColdStartOtaSwap(updatesGate, __DEV__, COLD_START_OTA_TIMEOUT_MS)
      } catch {
        // Swallow: boot must always proceed even if the helper itself throws.
      }
      if (!mounted) return
      // 2) Nav state restore + render the app.
      try {
        const state = await loadNavState()
        if (!mounted) return
        setInitialNavState(state as InitialState | undefined)
      } finally {
        if (mounted) setReady(true)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  // Hide the native splash once the first real screen has laid out, so the
  // hand-off goes native-splash → app with no blank frame in between.
  const onLayoutRootView = useCallback(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  // While booting, render nothing — the held native splash stays on screen.
  if (!ready) return null

  return (
    <ThemeProvider value={theme}>
      <View style={styles.root} onLayout={onLayoutRootView}>
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
      </View>
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
  root: { flex: 1 },
})
