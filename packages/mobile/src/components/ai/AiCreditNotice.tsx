import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import {
  getAiWalletSummary, formatUsdMicro, type AiWalletSummary,
} from '@reeeeecall/shared/lib/ai/server-client'
import {
  creditNotice, aiFeatureRequiresCredits,
} from '@reeeeecall/shared/lib/ai/credit-notice'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'

/**
 * The one notice every AI screen shows: what there is to spend.
 *
 * Same rule as the web component, from the same pure module — placed by feature id, so
 * registering a fourth AI feature with `poweredBy: 'model'` in `hub/catalog.ts` is the whole
 * edit. A feature that spends nothing renders nothing rather than a reassuring line about
 * credits it never touches.
 *
 * Deliberately not a price: amounts were removed from the flow on purpose. What is left is the
 * fact a learner cannot act around — whether they have anything at all.
 */
export function AiCreditNotice({ featureId, style }: {
  featureId: string
  style?: ViewStyle
}) {
  const { t } = useTranslation('ai-generate')
  const theme = useTheme()
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>()
  // `undefined` is "not read yet", `null` is "read failed" — different screens, both handled
  // by `creditNotice`. Collapsing them would show "잔액 없음" during every load.
  const [wallet, setWallet] = useState<AiWalletSummary | null | undefined>(undefined)
  const needed = aiFeatureRequiresCredits(featureId)

  useEffect(() => {
    if (!needed) return
    let cancelled = false
    void getAiWalletSummary()
      .then((w) => { if (!cancelled) setWallet(w) })
      .catch(() => { if (!cancelled) setWallet(null) })
    return () => { cancelled = true }
  }, [needed, featureId])

  if (!needed) return null

  const notice = creditNotice(wallet, formatUsdMicro)
  // Nothing while the read is in flight. A phone row that appears and then changes its mind is
  // worse than one that appears once.
  if (!notice) return null

  const line = notice.secondKey
    ? `${t(notice.key, notice.params)} · ${t(notice.secondKey, notice.secondParams)}`
    : t(notice.key, notice.params)
  const empty = notice.tone === 'empty'

  return (
    <View
      style={[{
        borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
        backgroundColor: theme.colors.surface,
        borderColor: empty ? theme.colors.warning : theme.colors.border,
      }, style]}
      {...testProps('ai-credit-notice')}
    >
      <Text style={[theme.typography.caption, {
        color: empty ? theme.colors.text : theme.colors.textSecondary,
      }]}>
        {line}
      </Text>
      {/* Only when there is nothing left. A charge link beside a healthy balance is an advert;
          beside an empty one it is the answer to the sentence above it. */}
      {empty && (
        <TouchableOpacity
          onPress={() => navigation.navigate('SettingsTab' as never)}
          accessibilityRole="button"
          {...testProps('ai-credit-topup')}
        >
          <Text style={[theme.typography.caption, {
            color: theme.colors.primary, marginTop: 4, fontWeight: '600',
          }]}>
            {t('wallet.topUp')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  )
}
