import { View, Text, StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../../theme'
import { testProps } from '../../utils/testProps'

type BadgeVariant = 'primary' | 'success' | 'warning' | 'error' | 'neutral'

interface BadgeProps {
  label: string
  variant?: BadgeVariant
  testID?: string
}

export function Badge({ label, variant = 'neutral', testID }: BadgeProps) {
  const theme = useTheme()
  const { bg, text } = getVariantColors(theme, variant)

  return (
    <View style={[styles.badge, { backgroundColor: bg }]} {...testProps(testID)}>
      <Text style={[theme.typography.caption, { color: text, fontWeight: '600' }]}>{label}</Text>
    </View>
  )
}

function getVariantColors(theme: Theme, variant: BadgeVariant) {
  const { colors } = theme
  const map: Record<BadgeVariant, { bg: string; text: string }> = {
    primary: { bg: colors.primaryLight, text: colors.primary },
    success: { bg: colors.successLight, text: colors.success },
    warning: { bg: '#FEF9C3', text: colors.warning },
    error: { bg: colors.errorLight, text: colors.error },
    neutral: { bg: colors.surface, text: colors.textSecondary },
  }
  return map[variant]
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
})
