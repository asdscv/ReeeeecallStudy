import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useNavigation, DrawerActions } from '@react-navigation/native'
import { useTheme } from '../../theme'

/**
 * Hamburger menu header — matches web Layout.tsx mobile header.
 * Shows ☰ button + page title. Tapping ☰ opens the drawer.
 */
export function DrawerHeader({ title }: { title: string }) {
  const theme = useTheme()
  const navigation = useNavigation()

  return (
    <View style={[styles.container, { borderBottomColor: theme.colors.border }]}>
      <TouchableOpacity
        onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        style={styles.hamburger}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel="Open menu"
        accessibilityRole="button"
      >
        <Text style={[styles.hamburgerIcon, { color: theme.colors.text }]}>☰</Text>
      </TouchableOpacity>
      <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.spacer} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  hamburger: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hamburgerIcon: { fontSize: 22 },
  title: { flex: 1, fontSize: 18, fontWeight: '600' },
  spacer: { width: 32 },
})
