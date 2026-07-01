import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Button } from './ui'
import { useTheme } from '../theme'

/**
 * Inline notice for card-creation screens when the owned-card limit is reached/would
 * be exceeded. Server (mig 116) is the authority; this is pre-flight UX. The Subscribe
 * CTA is a disabled placeholder until payment (Phase 2).
 */
export function CardLimitNotice() {
  const { t } = useTranslation(['errors', 'settings'])
  const theme = useTheme()
  return (
    <View style={{
      padding: 12, borderRadius: 10, gap: 8,
      backgroundColor: theme.colors.error + '1A', // ~10% alpha
    }}>
      <Text style={[theme.typography.body, { color: theme.colors.error, fontWeight: '600' }]}>
        {t('errors:card.limitReached')}
      </Text>
      <Text style={[theme.typography.caption, { color: theme.colors.error }]}>
        {t('settings:cardUsage.reached')}
      </Text>
      <Button title={t('settings:cardUsage.subscribe')} onPress={() => {}} disabled variant="outline" />
    </View>
  )
}
