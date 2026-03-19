import { useEffect, useState } from 'react'
import { View, Image, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { NavigationContainer } from '@react-navigation/native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { I18nextProvider } from 'react-i18next'
import * as Linking from 'expo-linking'
import { initMobilePlatform } from './src/adapters'
import i18n from './src/i18n'
import { RootNavigator } from './src/navigation'
import { ThemeProvider, useAppTheme } from './src/theme'

// Initialize platform adapters (must be before any shared code)
initMobilePlatform()

// Deep linking config for auth callbacks
const linking = {
  prefixes: [Linking.createURL('/'), 'reeeeecall://'],
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

  useEffect(() => {
    setReady(true)
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
      <NavigationContainer linking={linking}>
        <RootNavigator />
      </NavigationContainer>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  )
}

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
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
