import { Text, TouchableOpacity, View, StyleSheet } from 'react-native'
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useToastStore, type ToastType } from '../../stores/toast-store'
import { useTheme } from '../../theme'

/**
 * ToastContainer — renders the toast queue at the top of the screen, below the
 * notch. Mount once near the app root, above navigation. Tap to dismiss.
 */
export function ToastContainer() {
  const insets = useSafeAreaInsets()
  const theme = useTheme()
  const { toasts, dismiss } = useToastStore()

  if (toasts.length === 0) return null

  const accentFor = (type: ToastType) =>
    type === 'success' ? theme.colors.success
    : type === 'error' ? theme.colors.error
    : theme.colors.primary

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      {toasts.map((item) => (
        <Animated.View key={item.id} entering={FadeInUp.duration(220)} exiting={FadeOutUp.duration(180)}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => dismiss(item.id)}
            accessibilityRole="alert"
            accessibilityLabel={item.message}
            style={[
              styles.toast,
              { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.accent, { backgroundColor: accentFor(item.type) }]} />
            <Text style={[theme.typography.body, styles.text, { color: theme.colors.text }]} numberOfLines={3}>
              {item.message}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    gap: 8,
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingRight: 14,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
  },
  accent: { width: 4, alignSelf: 'stretch', marginRight: 12 },
  text: { flex: 1 },
})
