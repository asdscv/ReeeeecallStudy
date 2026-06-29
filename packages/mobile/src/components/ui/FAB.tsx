import { TouchableOpacity, Text, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'
import { haptics } from '../../utils/haptics'

interface FABProps {
  onPress: () => void
  icon?: string
  label?: string
  testID?: string
}

export function FAB({ onPress, icon = '+', label, testID }: FABProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { t } = useTranslation('common')

  const handlePress = () => {
    haptics.tap()
    onPress()
  }

  return (
    <TouchableOpacity
      {...testProps(testID)}
      onPress={handlePress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label ?? t('a11y.add')}
      // Lift above the home indicator on full-screen usage; floor of 24 keeps
      // the original spacing when no inset is consuming the bottom.
      style={[styles.fab, { bottom: Math.max(insets.bottom, 24), backgroundColor: theme.colors.primary }]}
    >
      <Text style={[styles.icon, { color: theme.colors.primaryText }]}>{icon}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.27,
    shadowRadius: 4.65,
  },
  icon: { fontSize: 28, fontWeight: '300', marginTop: -1 },
})
