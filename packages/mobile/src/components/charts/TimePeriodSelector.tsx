import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'
import type { TimePeriod } from '@reeeeecall/shared/lib/time-period'

const CHIPS: { value: TimePeriod; label: string }[] = [
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: '2y', label: '2Y' },
  { value: '5y', label: '5Y' },
]

interface TimePeriodSelectorProps {
  value: TimePeriod
  onChange: (period: TimePeriod) => void
  testID?: string
}

/**
 * Matches web TimePeriodTabs — rounded pill tabs in a scrollable row.
 * Active: bg-blue-600 + white text. Inactive: white bg + gray text.
 */
export function TimePeriodSelector({ value, onChange, testID }: TimePeriodSelectorProps) {
  const theme = useTheme()

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, { borderColor: theme.colors.border }]}
      testID={testID}
    >
      {CHIPS.map((chip) => {
        const active = chip.value === value
        return (
          <TouchableOpacity
            key={chip.value}
            onPress={() => onChange(chip.value)}
            style={[
              styles.chip,
              { backgroundColor: active ? theme.colors.primary : 'transparent' },
            ]}
            testID={`${testID}-${chip.value}`}
          >
            <Text
              style={[
                theme.typography.labelSmall,
                { color: active ? theme.colors.primaryText : theme.colors.textSecondary },
              ]}
            >
              {chip.label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, overflow: 'hidden', alignSelf: 'flex-start' },
  chip: { paddingHorizontal: 10, paddingVertical: 6 },
})
