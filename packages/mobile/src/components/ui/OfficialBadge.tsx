import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../../theme'
import type { BadgeType } from '@reeeeecall/shared/types/database'

interface OfficialBadgeProps {
  badgeType?: BadgeType
  badgeColor?: string
  size?: 'sm' | 'md'
  testID?: string
}

const BADGE_CONFIG: Record<BadgeType, { labelKey: string; defaultColor: string }> = {
  verified: { labelKey: 'verified', defaultColor: palette.blue[500] },
  official: { labelKey: 'official', defaultColor: palette.purple[700] },
  educator: { labelKey: 'educator', defaultColor: palette.green[600] },
  publisher: { labelKey: 'publisher', defaultColor: palette.yellow[600] },
  partner: { labelKey: 'partner', defaultColor: palette.red[600] },
}

export function OfficialBadge({
  badgeType = 'verified',
  badgeColor,
  size = 'sm',
  testID = 'official-badge',
}: OfficialBadgeProps) {
  const theme = useTheme()
  const { t } = useTranslation('common')
  const config = BADGE_CONFIG[badgeType] || BADGE_CONFIG.verified
  const color = badgeColor || config.defaultColor
  const label = t(`badge.${config.labelKey}`)

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
      accessibilityLabel={t('badge.accountA11y', { label })}
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
        {label}
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
