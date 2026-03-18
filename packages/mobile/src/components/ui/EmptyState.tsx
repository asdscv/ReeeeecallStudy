import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'
import { Button } from './Button'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  actionTitle?: string
  onAction?: () => void
  testID?: string
}

export function EmptyState({ icon = '📭', title, description, actionTitle, onAction, testID }: EmptyStateProps) {
  const theme = useTheme()

  return (
    <View style={styles.container} {...testProps(testID, true)}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={[theme.typography.h3, { color: theme.colors.text, textAlign: 'center' }]}>{title}</Text>
      {description && (
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', marginTop: 8 }]}>
          {description}
        </Text>
      )}
      {actionTitle && onAction && (
        <View style={styles.action}>
          <Button title={actionTitle} onPress={onAction} size="sm" fullWidth={false} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  icon: { fontSize: 48, marginBottom: 8 },
  action: { marginTop: 16 },
})
