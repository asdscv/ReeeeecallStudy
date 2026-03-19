import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'
import type { BadgeType } from '@reeeeecall/shared/types/database'

interface OfficialBadgeProps {
  badgeType?: BadgeType
  badgeColor?: string
  size?: 'sm' | 'md'
  testID?: string
}

const BADGE_CONFIG: Record<BadgeType, { label: string; defaultColor: string }> = {
  verified: { label: 'Verified', defaultColor: '#3B82F6' },
  official: { label: 'Official', defaultColor: '#7C3AED' },
  educator: { label: 'Educator', defaultColor: '#059669' },
  publisher: { label: 'Publisher', defaultColor: '#D97706' },
  partner: { label: 'Partner', defaultColor: '#DC2626' },
}

export function OfficialBadge({
  badgeType = 'verified',
  badgeColor,
  size = 'sm',
  testID = 'official-badge',
}: OfficialBadgeProps) {
  const theme = useTheme()
  const config = BADGE_CONFIG[badgeType] || BADGE_CONFIG.verified
  const color = badgeColor || config.defaultColor

  const isSmall = size === 'sm'

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: color + '1A', // 10% opacity
          paddingHorizontal: isSmall ? 6 : 8,
          paddingVertical: isSmall ? 2 : 3,
        },
      ]}
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={`${config.label} account`}
    >
      <Text style={[styles.checkmark, { color, fontSize: isSmall ? 10 : 12 }]}>
        {'\u2713'}
      </Text>
      <Text
        style={[
          isSmall ? theme.typography.caption : theme.typography.bodySmall,
          { color, fontWeight: '600' },
        ]}
      >
        {config.label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 10,
  },
  checkmark: {
    fontWeight: '700',
  },
})
