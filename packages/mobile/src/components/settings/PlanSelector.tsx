import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import {
  getBillingProducts,
  selectSubscriptions,
  type BillingProduct,
  type MySubscription,
} from '../../services/billing'
import { SUBSCRIPTION_UI_ENABLED } from '../../services/purchases'
import { formatProductPrice } from '@reeeeecall/shared/lib/pricing'

// Card limits at or above this collapse to "unlimited" FOR DISPLAY only — the
// mig-124 sentinel (sub_unlimited_monthly stores card_limit = 2e9). The DB still
// treats it as a plain integer cap; only the presentation layer shows the word.
export const UNLIMITED_CARD_LIMIT = 1_000_000_000

/**
 * Data-driven subscription PLAN SELECTOR for the mobile Settings card-limit
 * section. Mirrors the web plan list: pulls the ACTIVE `subscription` products
 * from get_billing_products (mig 119/124 catalog), ordered by sort_order, and
 * renders each as title + card-limit ("무제한" when >= 1e9, else the number) + ₩
 * price + a Select button. Fully data-driven — no plan is hardcoded, so plans
 * added / edited / retired as catalog rows flow through with no code change.
 *
 * Purchasing stays behind the mobile IAP gate (SUBSCRIPTION_UI_ENABLED, Apple
 * Guideline 2.1(b)): until store IAP products are submitted, each Select button
 * renders a disabled "준비 중" state and never calls a provider. The caller's
 * active plan is highlighted and shows a "현재 플랜" badge instead of a button.
 */
export function PlanSelector({
  subscription,
  onSelect,
}: {
  subscription: MySubscription | null
  onSelect?: (product: BillingProduct) => void
}) {
  const theme = useTheme()
  const { t, i18n } = useTranslation('settings')
  const [plans, setPlans] = useState<BillingProduct[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    getBillingProducts()
      .then((products) => {
        if (cancelled) return
        // Active subscription products only, ordered by sort_order (catalog order).
        setPlans(selectSubscriptions(products).sort((a, b) => a.sortOrder - b.sortOrder))
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Self-gate every call site: while mobile IAP products aren't submitted
  // (Apple Guideline 2.1(b)) NO plan pricing / Select CTA may render anywhere.
  // Returning null here — rather than relying on each caller to wrap the tag —
  // means an ungated call site (e.g. CardUsageModal) can't leak the catalog.
  // Safe after the hooks above (they always run); the flag is a module constant.
  if (!SUBSCRIPTION_UI_ENABLED) return null

  const fmtLimit = (limit: number | null): string =>
    limit != null && limit >= UNLIMITED_CARD_LIMIT
      ? t('plans.unlimited')
      : t('plans.cardLimit', { limit: (limit ?? 0).toLocaleString() })

  // Price follows the buyer's locale: ₩ for Korean, $ for everyone else — matching
  // what the region's payment method (Toss / store IAP) actually charges.
  const fmtPrice = (p: BillingProduct): string => formatProductPrice(p, i18n.language)

  const isCurrent = (p: BillingProduct): boolean =>
    subscription?.status === 'active' &&
    (subscription.productId === p.id || (!!subscription.tier && subscription.tier === p.tier))

  if (state === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    )
  }
  if (state === 'error') {
    return (
      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
        {t('plans.loadError')}
      </Text>
    )
  }
  if (!plans || plans.length === 0) {
    // Nothing to sell yet (catalog empty or the billing backend isn't provisioned).
    return (
      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
        {t('plans.empty')}
      </Text>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.heading, { color: theme.colors.text }]}>{t('plans.title')}</Text>
      {plans.map((p) => {
        const current = isCurrent(p)
        return (
          <View
            key={p.id}
            testID={`settings-plan-${p.id}`}
            style={[
              styles.planRow,
              {
                borderColor: current ? theme.colors.primary : theme.colors.border,
                backgroundColor: current ? theme.colors.primaryLight : theme.colors.surface,
                borderWidth: current ? 2 : 1,
              },
            ]}
          >
            <View style={styles.planInfo}>
              <Text style={[styles.planTitle, { color: theme.colors.text }]}>{p.title}</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {fmtLimit(p.cardLimit)}
              </Text>
            </View>
            <View style={styles.planRight}>
              <Text style={[styles.price, { color: theme.colors.text }]}>
                {fmtPrice(p)}
                {p.period ? t('plans.perMonth') : ''}
              </Text>
              {current ? (
                <View style={[styles.currentBadge, { backgroundColor: theme.colors.primary }]}>
                  <Text style={styles.currentBadgeText}>{t('plans.current')}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  testID={`settings-plan-select-${p.id}`}
                  disabled={!SUBSCRIPTION_UI_ENABLED}
                  onPress={() => {
                    if (SUBSCRIPTION_UI_ENABLED) onSelect?.(p)
                  }}
                  style={[
                    styles.selectBtn,
                    {
                      backgroundColor: SUBSCRIPTION_UI_ENABLED
                        ? theme.colors.primary
                        : theme.colors.border,
                      opacity: SUBSCRIPTION_UI_ENABLED ? 1 : 0.7,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.selectText,
                      { color: SUBSCRIPTION_UI_ENABLED ? '#FFFFFF' : theme.colors.textSecondary },
                    ]}
                  >
                    {SUBSCRIPTION_UI_ENABLED ? t('plans.select') : t('plans.comingSoon')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 10, marginTop: 4 },
  center: { paddingVertical: 16, alignItems: 'center' },
  heading: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    borderRadius: 10,
  },
  planInfo: { flex: 1, gap: 2 },
  planTitle: { fontSize: 15, fontWeight: '600' },
  planRight: { alignItems: 'flex-end', gap: 6 },
  price: { fontSize: 15, fontWeight: '700' },
  selectBtn: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8 },
  selectText: { fontSize: 13, fontWeight: '600' },
  currentBadge: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 8 },
  currentBadgeText: { fontSize: 12, fontWeight: '600', color: '#FFFFFF' },
})
