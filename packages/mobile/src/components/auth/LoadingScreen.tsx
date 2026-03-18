import { View, Image, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'

/**
 * Loading screen with logo — matches web ProtectedRoute loading state.
 * Shows the app logo with a pulse-like opacity while auth resolves.
 */
export function LoadingScreen() {
  const theme = useTheme()

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
      <Image source={require('../../../assets/splash-icon.png')} style={styles.logo} resizeMode="contain" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 80, height: 80 },
})
