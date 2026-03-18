import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'

interface ProgressBarProps {
  /** 0–100 */
  percentage: number
  label?: string
  height?: number
  color?: string
  testID?: string
}

export function ProgressBar({ percentage, label, height = 8, color, testID }: ProgressBarProps) {
  const theme = useTheme()
  const fillColor = color ?? theme.colors.primary
  const clamped = Math.max(0, Math.min(100, percentage))

  return (
    <View testID={testID}>
      {label && (
        <View style={styles.labelRow}>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{label}</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{clamped}%</Text>
        </View>
      )}
      <View style={[styles.track, { height, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : '#F3F4F6' }]}>
        <View style={[styles.fill, { width: `${clamped}%`, height, backgroundColor: fillColor }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  track: { borderRadius: 4, overflow: 'hidden' },
  fill: { borderRadius: 4 },
})
