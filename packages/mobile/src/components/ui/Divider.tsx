import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'

interface DividerProps {
  text?: string
}

export function Divider({ text }: DividerProps) {
  const theme = useTheme()

  if (!text) {
    return (
      <View
        style={[styles.line, { backgroundColor: theme.colors.border }]}
      />
    )
  }

  return (
    <View style={styles.container}>
      <View style={[styles.line, styles.flex, { backgroundColor: theme.colors.border }]} />
      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginHorizontal: theme.spacing.md }]}>
        {text}
      </Text>
      <View style={[styles.line, styles.flex, { backgroundColor: theme.colors.border }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  line: { height: 1 },
  flex: { flex: 1 },
})
