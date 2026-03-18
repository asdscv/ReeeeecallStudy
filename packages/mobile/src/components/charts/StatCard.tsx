import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'

interface StatCardProps {
  label: string
  value: string | number
  /** Color for value text — matches web: text-gray-900 / text-amber-600 / text-green-600 / text-blue-600 */
  valueColor?: string
  testID?: string
}

/**
 * Matches web StatsSummaryCards: bg-white rounded-xl border p-3
 * label on top, large value below
 */
export function StatCard({ label, value, valueColor, testID }: StatCardProps) {
  const theme = useTheme()
  const color = valueColor ?? theme.colors.text

  return (
    <View
      style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
      testID={testID}
    >
      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, { color }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 2,
  },
  value: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
  },
})
