import { useEffect, useState } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { NavigationContainer } from '@react-navigation/native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import * as Linking from 'expo-linking'
import { initMobilePlatform } from './src/adapters'
import { RootNavigator } from './src/navigation'
import { ThemeProvider, useAppTheme, palette } from './src/theme'

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
    // Any async init that needs to happen before first render
    setReady(true)
  }, [])

  if (!ready) {
    return (
      <View style={[styles.splash, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={palette.blue[600]} />
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
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
