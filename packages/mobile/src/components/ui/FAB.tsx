import { TouchableOpacity, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'

interface FABProps {
  onPress: () => void
  icon?: string
  testID?: string
}

export function FAB({ onPress, icon = '+', testID }: FABProps) {
  const theme = useTheme()

  return (
    <TouchableOpacity
      {...testProps(testID)}
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.fab, { backgroundColor: theme.colors.primary }]}
    >
      <Text style={[styles.icon, { color: theme.colors.primaryText }]}>{icon}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 24,
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
