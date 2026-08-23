import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { usePurchases } from '../../hooks/usePurchases'
import { useTheme } from '../../theme'
import {
  getBillingProducts,
  selectSubscriptions,
  type BillingProduct,
  type MySubscription,
} from '../../services/billing'
import { purchaseService, SUBSCRIPTION_UI_ENABLED } from '../../services/purchases'
import { formatProductPrice } from '@reeeeecall/shared/lib/pricing'
import { formatCount } from '@reeeeecall/shared/lib/ai/server-client'

// Card limits at or above this collapse to "unlimited" FOR DISPLAY only. As of mig 148
// NO plan is unlimited (the top plan caps at 100,000); this now only fires for admins,
// whose effective limit stays 2e9 (mig 139). Presentation-only — never gate server-side.
export const UNLIMITED_CARD_LIMIT = 1_000_000_000

/**
 * Data-driven subscription PLAN SELECTOR for the mobile Settings card-limit
 * section. Mirrors the web plan list: pulls the ACTIVE `subscription` products
 * from get_billing_products (mig 119/124 catalog), ordered by sort_order, and
 * renders each as title + card-limit ("무제한" when >= 1e9, else the number) + $
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
  /**
   * 필수다. 옵셔널이던 시절, CardUsageModal 이 이걸 안 넘긴 채 가격표를 그렸고 그
   * 화면의 "선택" 버튼은 눌러도 아무 일도 하지 않았다 — 대시보드가 첫 화면이므로
   * 앱을 켜자마자 닿는 곳이었다. 가격을 띄우는 쪽은 갈 곳도 함께 대야 한다.
   */
  onSelect: (product: BillingProduct) => void
}) {
  const theme = useTheme()
  const { t } = useTranslation('settings')
  const { offering, isPro } = usePurchases()
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
      : t('plans.cardLimit', { limit: formatCount(limit ?? 0) })  // "카드 100,000장 저장" 

  /**
   * 스토어가 실제로 청구할 금액을 보여준다.
   *
   * 여기는 카탈로그의 USD 를 그대로 찍고 있었다. 그래서 한국 사용자가 설정에서는
   * "$3.99/월" 을 보고 결제 화면에서는 "₩5,900" 을 보는 상태였다 — 같은 상품인데
   * 한 앱 안에서 값이 두 개다. 스토어 패키지가 잡혀 있으면 그쪽(현지 통화·현지 세금
   * 반영)을 쓰고, 아직 못 읽었을 때만 카탈로그로 물러난다. 이게 애플·구글이 요구하는
   * 표기이기도 하다.
   */
  const fmtPrice = (p: BillingProduct): string => {
    const pkg = purchaseService.findPackageForProduct(offering, p.storeProductId ?? p.id)
    return pkg?.product?.priceString ?? formatProductPrice(p)
  }

  const isCurrent = (p: BillingProduct): boolean =>
    subscription?.status === 'active' &&
    (subscription.productId === p.id || (!!subscription.tier && subscription.tier === p.tier))

  /**
   * 스토어는 "샀다"는데 서버는 아직 모르는 구간.
   *
   * 이 목록은 서버(billing_subscriptions)만 보고, 결제 화면은 isPro(스토어 엔타이틀먼트
   * 포함)를 봤다. 그래서 한 앱 안에서 목록은 "선택", 그 화면에 들어가면 "플랜이 적용
   * 중입니다" 가 뜨는 상태가 됐다.
   *
   * 둘 중 서버가 최종 권한인 것은 맞다 — 카드 한도를 정하는 것은 서버다. 하지만 결제
   * 직후에는 웹훅이 도착하기 전이라 스토어가 먼저 안다. 그 창에서 "선택" 을 그대로
   * 보여주면 **같은 구독을 한 번 더 사게 된다**(스토어가 다르면 이중 청구까지 간다).
   *
   * 그래서 스토어가 이미 권한을 인정하는 동안에는 구매 버튼을 내리고 확인 중임을
   * 알린다. 서버가 따라잡으면 자연스럽게 '현재 플랜' 으로 바뀐다.
   */
  const settlingAtStore = !!isPro && subscription?.status !== 'active'

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

  // Highlight the highest-tier plan (largest card allowance) as "popular".
  const topLimit = Math.max(...plans.map((p) => p.cardLimit ?? 0))

  return (
    <View style={styles.container}>
      {/* 값과 숫자만 있고 그게 무슨 뜻인지가 없었다. "Standard / 100,000장 / $3.99" 를
          처음 보는 사람은 무엇을 사는지 알 수 없다.
          무료로 이미 되는 것까지 함께 적는 이유: 이 구독이 늘리는 것은 저장 한도뿐이고
          AI 생성량은 그대로다. 그걸 감추면 결제 후에 알게 되고, 그때는 환불 문의가 된다. */}
      <Text style={[theme.typography.caption, styles.blurb, { color: theme.colors.textSecondary }]}>
        {t('plans.blurb')}
      </Text>
      {plans.map((p) => {
        const current = isCurrent(p)
        const popular = !current && (p.cardLimit ?? 0) === topLimit && plans.length > 1
        const accent = current || popular
        return (
          <View
            key={p.id}
            testID={`settings-plan-${p.id}`}
            style={[
              styles.planRow,
              {
                borderColor: accent ? theme.colors.primary : theme.colors.border,
                backgroundColor: current ? theme.colors.primaryLight : theme.colors.surface,
                borderWidth: accent ? 1.5 : StyleSheet.hairlineWidth,
              },
            ]}
          >
            <View style={styles.planInfo}>
              <View style={styles.planTitleRow}>
                <Text style={[styles.planTitle, { color: theme.colors.text }]}>{p.title}</Text>
                {popular && (
                  <View style={[styles.popularPill, { backgroundColor: theme.colors.primary }]}>
                    <Text style={styles.popularText}>{t('plans.popular', 'POPULAR')}</Text>
                  </View>
                )}
              </View>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {fmtLimit(p.cardLimit)}
              </Text>
            </View>
            <View style={styles.planRight}>
              <Text style={[styles.price, { color: theme.colors.text }]}>
                {fmtPrice(p)}
                <Text style={[styles.pricePeriod, { color: theme.colors.textSecondary }]}>
                  {p.period ? t('plans.perMonth') : ''}
                </Text>
              </Text>
              {current ? (
                <View style={[styles.currentBadge, { backgroundColor: theme.colors.primary }]}>
                  <Text style={styles.currentBadgeText}>{t('plans.current')}</Text>
                </View>
              ) : settlingAtStore ? (
                // 스토어는 인정했고 서버는 아직인 구간 — 구매 버튼을 내려 재구매를 막는다.
                <View style={[styles.currentBadge, { backgroundColor: theme.colors.border }]}>
                  <Text style={[styles.currentBadgeText, { color: theme.colors.textSecondary }]}>
                    {t('plans.settling')}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  testID={`settings-plan-select-${p.id}`}
                  disabled={!SUBSCRIPTION_UI_ENABLED}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (SUBSCRIPTION_UI_ENABLED) onSelect(p)
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
  blurb: { marginBottom: 10, lineHeight: 18 },
  container: { gap: 10, marginTop: 2 },
  center: { paddingVertical: 16, alignItems: 'center' },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  planInfo: { flex: 1, gap: 3 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planTitle: { fontSize: 15.5, fontWeight: '700', letterSpacing: -0.2 },
  popularPill: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 6 },
  popularText: { fontSize: 9.5, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.4 },
  planRight: { alignItems: 'flex-end', gap: 7 },
  price: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  pricePeriod: { fontSize: 12, fontWeight: '500' },
  selectBtn: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10, minWidth: 78, alignItems: 'center' },
  selectText: { fontSize: 13.5, fontWeight: '700' },
  currentBadge: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 8 },
  currentBadgeText: { fontSize: 12, fontWeight: '600', color: '#FFFFFF' },
})
