import { View, Text, TouchableOpacity, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import {
  refusalFrom, refusalMessageKey, refusalFallbackKey, isWalletRefusal,
  type PaidActionId,
} from '@reeeeecall/shared/lib/ai/refusal'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'

/** iOS HIG minimum; Material's 48dp is larger but this is a text link, not a primary action. */
const MIN_TOUCH = 44

/**
 * The one way this app says "that cost money and it did not happen" — same rule as web, from
 * the same pure module, so the two platforms cannot drift into telling a learner different
 * things about one server condition.
 *
 * Mobile has the harder version of the problem this fixes. The quiz run screen sets
 * `gestureEnabled: false` and has no header, so its only exit is 나가기 — and 나가기 goes to the
 * quiz home, whose only way back into a quiz mints a NEW attempt. A learner who ran out of
 * credit at question six and went to top up could not return to the run they had already paid
 * to have graded. Putting the route out ON the refusal is what makes leaving unnecessary.
 */
export function AiRefusalNotice({ code, actionId, onRetry, style }: {
  code: string | null | undefined
  actionId?: PaidActionId
  onRetry?: () => void
  style?: ViewStyle
}) {
  const { t } = useTranslation('ai-generate')
  const theme = useTheme()
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>()
  if (!code) return null

  const refusal = refusalFrom(code)
  const fallbackKey = refusalFallbackKey(refusal, actionId)
  const wallet = isWalletRefusal(refusal)

  return (
    <View
      accessibilityRole="alert"
      style={[{
        borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
        backgroundColor: theme.colors.surface,
        borderColor: wallet ? theme.colors.warning : theme.colors.error,
      }, style]}
      {...testProps('ai-refusal', true)}
    >
      <Text style={[theme.typography.bodySmall, {
        color: wallet ? theme.colors.text : theme.colors.error,
      }]}>
        {t(refusalMessageKey(refusal))}
      </Text>

      {refusal.topUp && (
        <TouchableOpacity
          onPress={() => navigation.navigate('SettingsTab' as never)}
          accessibilityRole="button"
          style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
          {...testProps('ai-refusal-topup')}
        >
          <Text style={[theme.typography.caption, {
            color: theme.colors.primary, fontWeight: '600',
          }]}>
            {t('wallet.topUp')}
          </Text>
        </TouchableOpacity>
      )}

      {fallbackKey && (
        <Text
          style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 6 }]}
          {...testProps('ai-refusal-fallback')}
        >
          {t(fallbackKey)}
        </Text>
      )}

      {onRetry && refusal.retryable && (
        <TouchableOpacity
          onPress={onRetry}
          accessibilityRole="button"
          style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
          {...testProps('ai-refusal-retry')}
        >
          <Text style={[theme.typography.caption, {
            color: theme.colors.primary, fontWeight: '600',
          }]}>
            {t('wallet.refusal.retry')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  )
}
