// ─────────────────────────────────────────────────────────────────────────
// 이 화면은 2026-04-15 Apple 심사 리젝(Guideline 2.1(b)) 대응으로 한때 스택에서
// 빠져 있었으나, 지금은 **복원되어 도달 가능하다** — SettingsStack.tsx 가 Paywall
// 라우트를 등록하고 SettingsScreen 이 두 곳에서 navigate('Paywall') 한다.
// 남은 게이트는 런타임 하나뿐: SUBSCRIPTION_UI_ENABLED
// (= OWNER_GO_LIVE_SWITCH && RevenueCat SDK 존재). 꺼져 있으면 빈 화면.
//
// 즉 실기기 빌드에서 이 표는 **사용자에게 보이는 가격 고지**다. 여기 숫자가 틀리면
// 결제 화면이 거짓말을 하는 것이므로, 카드 한도와 AI 무료 쿼터는 카피가 아니라
// 서버에서 읽는다(아래 FEATURE_KEYS 주석 참조).
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { View, Text, ScrollView, ActivityIndicator, Alert, StyleSheet, Linking, Platform, Pressable } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Screen, Button, ScreenHeader } from '../components/ui'
import { usePurchases } from '../hooks/usePurchases'
import { purchaseService, SUBSCRIPTION_UI_ENABLED } from '../services/purchases'
import { recordPurchaseConsent, getPlanLimits } from '../services/billing'
import type { BillingProduct, PlanLimits } from '../services/billing'
import { formatProductPrice } from '@reeeeecall/shared/lib/pricing'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'

const PRIVACY_POLICY_URL = 'https://reeeeecallstudy.xyz/privacy-policy.html'
const TERMS_OF_SERVICE_URL = 'https://reeeeecallstudy.xyz/terms-of-service.html'
const MANAGE_SUBSCRIPTIONS_URL = Platform.select({
  ios: 'https://apps.apple.com/account/subscriptions',
  default: 'https://play.google.com/store/account/subscriptions',
})
const REFUND_POLICY_URL = 'https://reeeeecallstudy.xyz/refund-policy.html'
// Where a refund is actually requested. Neither store lets the developer issue one
// from here: Apple decides every App Store refund, and a Play refund outside our
// policy window is Google's call. On iOS we prefer the in-app StoreKit sheet and
// only fall back to this page when it is unavailable (pre-iOS-15, or no active
// entitlement to attach the request to).
const REFUND_REQUEST_URL = Platform.select({
  ios: 'https://reportaproblem.apple.com',
  default: 'https://play.google.com/store/account/orderhistory',
})

// Feature comparison rows. Copy is i18n (paywall.json `features.*`, 8 locales) so the
// paywall is translated; only the emoji + the i18n key live here.
//
// The two NUMERIC rows are interpolated from the server, not written into the copy:
// `cardStorage` from card_limit_settings (free) and the product catalog (pro),
// `aiGeneration` from ai_pricing_settings. Both are admin-settable — mig 154 made the
// AI quota a setting and mig 177 put both behind an admin UI — so a literal in
// paywall.json is a number that goes stale the first time someone uses that panel, on
// the one screen whose job is telling a person what they are buying.
// ONLY rows a paid plan actually changes may appear here.
//
// Four rows were removed on 2026-08-03 — "모든 학습 모드", "프리미엄 TTS", "고급 분석",
// "마켓플레이스 게시" — because nothing in this app gates any of them by plan. Verified, not
// assumed: `billing_products` carries `card_limit` and nothing else, `isPro` appears only on a
// Settings badge, `edge_tts` is a free settings toggle, there is no plan check on deck
// publishing, and no revenue-share exists at all. (`subscriptionLocked` in study-store is about
// a marketplace DECK subscription expiring — a different thing wearing a similar name, which is
// probably how the rows survived this long.)
//
// This is the screen that takes money. A row here is a promise, and a promise the code does not
// keep is not a copy problem — it is the store listing and the refund queue. Before adding a
// row, point at the code that enforces it.
const FEATURE_KEYS = ['cardStorage', 'aiGeneration'] as const
/**
 * The CELLS whose copy carries a server number, and therefore need a `*Unknown` twin to fall
 * back to. Per cell, not per row: `aiGeneration.pro` says "Same as Free", which needs no number
 * and stays true under any quota — so it has nothing to fall back FROM.
 */
const NUMERIC_CELLS = new Set(['cardStorage.free', 'cardStorage.pro', 'aiGeneration.free'])
const FEATURE_ICONS: Record<(typeof FEATURE_KEYS)[number], string> = {
  cardStorage: '🗂️',
  aiGeneration: '🤖',
}

export function PaywallScreen() {
  const theme = useTheme()
  const { t } = useTranslation('paywall')
  const navigation = useNavigation()
  const { isPro, offering, products, loading, purchasing, purchase, restore } = usePurchases()
  // Withdrawal-right disclosure — ticked before any purchase button is enabled.
  // KR 전자상거래법 / EU-UK both require this to be shown BEFORE the charge for the
  // "used ⇒ non-refundable" rule to hold; see recordPurchaseConsent.
  const [consented, setConsented] = useState(false)

  /**
   * The free-tier numbers the comparison table quotes (mig 179).
   *
   * `undefined` = still reading, `null` = could not be read. The distinction matters: the
   * screen already blocks on a spinner while the catalog loads, so folding this read into
   * that same gate means the table is never painted with a number it is about to replace.
   * A failed read falls through to the number-free copy, never to a guess.
   */
  const [planLimits, setPlanLimits] = useState<PlanLimits | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    void getPlanLimits().then((limits) => { if (!cancelled) setPlanLimits(limits) })
    return () => { cancelled = true }
  }, [])

  // Start a store refund REQUEST. Deliberately never phrased as "refund issued":
  // Apple and Google decide, and our side only reconciles afterwards when their
  // webhook arrives.
  const handleRefundRequest = async () => {
    if (Platform.OS === 'ios') {
      const r = await purchaseService.beginRefundRequest()
      if (r.status === 'success') {
        Alert.alert(t('refund.title'), t('refund.submitted'))
        return
      }
      if (r.status === 'userCancelled') return
      // 'unavailable' (pre-iOS-15 / no active entitlement) or an error → web fallback.
    }
    void Linking.openURL(REFUND_REQUEST_URL)
  }

  // The route IS reachable, so this gate is the only thing standing between a reviewer and
  // a purchase surface while the store side is not live. Render nothing rather than a table.
  if (!SUBSCRIPTION_UI_ENABLED) {
    return <Screen testID="paywall-screen"><View style={styles.center} /></Screen>
  }

  // One gate for both reads: a table painted with a placeholder that swaps to a real cap a
  // moment later is a worse first impression than a spinner that resolves once.
  if (loading || planLimits === undefined) {
    return (
      <Screen testID="paywall-screen">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </Screen>
    )
  }

  if (isPro) {
    return (
      <Screen testID="paywall-screen">
        <ScreenHeader title={t('youArePro')} mode="back" />
        <View style={styles.center}>
          <Text style={styles.emoji}>✅</Text>
          <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{t('youArePro')}</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            {t('proDesc')}
          </Text>
          {/* An active subscriber is exactly who needs the refund route, and this
              screen is otherwise a dead end for them. */}
          <Text
            testID="paywall-request-refund-pro"
            style={[theme.typography.caption, { color: theme.colors.primary }]}
            onPress={handleRefundRequest}
          >
            {t('refund.request')}
          </Text>
        </View>
      </Screen>
    )
  }

  // Server catalog (get_billing_products) is the source of truth for what
  // products exist + their display metadata. Subscriptions render as pricing
  // buttons; the actual store charge is matched to a RevenueCat package by id.
  const subscriptionProducts = products.filter((p) => p.kind === 'subscription')

  /**
   * The Pro card cap = the highest cap any active subscription grants, which is what the
   * "Pro" column of a Free-vs-Pro table means. Read from the catalog already in hand, so
   * this costs no extra round trip and cannot disagree with the plan buttons below.
   *
   * `null` when the catalog did not load — the row then says what Pro does without
   * naming a number, rather than inventing one.
   */
  const proCardLimit = subscriptionProducts.reduce<number | null>(
    (best, p) => (p.cardLimit != null && (best === null || p.cardLimit > best) ? p.cardLimit : best),
    null,
  )

  /**
   * The interpolation values for the numeric CELLS, keyed by `<feature>.<column>`.
   *
   * A cell with no entry is called as `t(key, undefined)`, which is just `t(key)` — every
   * static cell is untouched.
   *
   * `count` stays a real `number`: src/i18n registers an Intl-free `number` formatter
   * (`formatCount`) because an ICU-less Hermes build has no `Intl`, and handing it a
   * pre-formatted string would silently skip the grouping and render "100000".
   *
   * **The AI row's Pro cell carries no number.** A paid plan does not raise the AI quota —
   * `_ai_free_cards_per_day()` takes no user argument, and a subscription grants `card_limit`
   * only — so it says "Same as Free", which needs no interpolation and cannot go stale. Both
   * cells also name credits, because credit packs are NOT plan-gated (`create_payment_intent`
   * checks auth and an active product, nothing else): naming them under Pro alone would
   * advertise an exclusivity that does not exist, which is the defect this row had.
   */
  type FeatureKey = (typeof FEATURE_KEYS)[number]
  const counts: Record<string, { count: number }> = {}
  if (planLimits) {
    counts['cardStorage.free'] = { count: planLimits.freeCardLimit }
    counts['aiGeneration.free'] = { count: planLimits.freeAiCardsPerDay }
  }
  if (proCardLimit !== null) counts['cardStorage.pro'] = { count: proCardLimit }

  /**
   * `features.<key>.<column>` interpolated when the number is known, `...Unknown` when it is
   * not. The fallback copy is deliberately number-free ("Limited storage") rather than a
   * hardcoded default: a stale-but-plausible figure on a purchase screen is the exact failure
   * this screen's copy exists to avoid, and re-adding it as an error path would keep it.
   *
   * Static cells never take that branch — their copy has no placeholder and no `*Unknown`
   * twin, so they render exactly as written.
   */
  const featureValue = (key: FeatureKey, column: 'free' | 'pro'): string => {
    const cell = `${key}.${column}`
    const opts = counts[cell]
    if (opts) return t(`features.${cell}`, opts)
    if (NUMERIC_CELLS.has(cell)) return t(`features.${cell}Unknown`)
    return t(`features.${cell}`)
  }

  const formatPrice = (product: BillingProduct, pkg: any): string => {
    // Prefer the store-localized price string when the IAP package is loaded
    // (Apple/Google want the store price shown); fall back to the catalog USD price.
    if (pkg?.product?.priceString) return pkg.product.priceString
    const price = formatProductPrice(product)
    return product.period === 'month' ? `${price}${t('catalog.perMonth')}` : price
  }

  // The store IAP id to purchase for this platform (billing_product_skus, mig 151);
  // fall back to the internal id when no SKU row is registered yet.
  const storeSku = (product: BillingProduct): string => product.storeProductId ?? product.id

  const handlePurchaseProduct = async (product: BillingProduct) => {
    // Map the backend product -> the store package (by its store SKU) to actually charge.
    const pkg = purchaseService.findPackageForProduct(offering, storeSku(product))
    if (!pkg) {
      Alert.alert(t('title'), t('catalog.purchaseUnavailable'))
      return
    }
    // Record the disclosure the buyer just ticked BEFORE the store charge, so the
    // evidence predates the payment (mig 157 only counts a consent stamped before
    // the purchase — a record written afterwards proves nothing).
    await recordPurchaseConsent(product.id)
    // Pass the backend product so usePurchases opens a server-side payment
    // intent (create_payment_intent) before charging — the merchantUid it
    // returns is what the payment-webhook later reconciles the grant against.
    const result = await purchase(pkg, product)
    if (result.success) {
      // NOTE: the DB entitlement is granted server-side by the payment-webhook
      // (store receipt -> RevenueCat -> confirm_payment(merchantUid)). The
      // grant is async, so tell the user it's confirming; usePurchases already
      // re-fetches getMySubscription() and will reflect it once it lands.
      Alert.alert(t('welcomePro'), t('checkout.confirming'), [
        { text: t('done'), onPress: () => navigation.goBack() },
      ])
    } else if (result.error === 'intent_failed') {
      Alert.alert(t('title'), t('checkout.startFailed'))
    } else if (result.error && result.error !== 'cancelled' && result.error !== 'disabled') {
      // Show a friendly, localized message; keep the raw store/RC error for dev logs.
      if (__DEV__) console.warn('[paywall] purchase failed:', result.error)
      Alert.alert(t('checkout.errorTitle'), t('checkout.errorGeneric'))
    }
  }

  const handleRestore = async () => {
    const result = await restore()
    if (result.success) {
      Alert.alert(t('welcomePro'), t('restored'), [
        { text: t('done'), onPress: () => navigation.goBack() },
      ])
    } else {
      Alert.alert(t('restorePurchase'), t('noRestoreFound'))
    }
  }

  return (
    <Screen safeArea padding={false} testID="paywall-screen">
      <ScreenHeader title={t('title')} mode="back" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.crown}>👑</Text>
          <Text style={[theme.typography.h1, { color: theme.colors.text, textAlign: 'center' }]}>
            {t('title')}
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            {t('subtitle')}
          </Text>
        </View>

        {/* Feature Comparison. "Free" / "Pro" column labels stay literal (plan names are
            proper nouns, not translated); the feature copy is i18n. */}
        <View style={styles.features}>
          {FEATURE_KEYS.map((key) => (
            <View key={key} style={[styles.featureRow, { borderColor: theme.colors.border }]}>
              <Text style={styles.featureIcon}>{FEATURE_ICONS[key]}</Text>
              <View style={styles.featureInfo}>
                <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t(`features.${key}.title`)}</Text>
                <View style={styles.comparisonRow}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                    Free: {featureValue(key, 'free')}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>
                    Pro: {featureValue(key, 'pro')}
                  </Text>
                </View>
              </View>
            </View>
          ))}

          {/* Says what the removed rows used to imply, but truthfully. Without this a
              two-row table reads as "this is all you get", when in fact everything absent
              from the table is already free — which is the better story and the true one. */}
          <Text
            testID="paywall-everything-else-free"
            style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 12 }]}
          >
            {t('everythingElseFree')}
          </Text>
        </View>

        {/* Pre-purchase withdrawal-right disclosure. Required before the buy buttons
            unlock: KR 전자상거래법 and the EU/UK cooling-off rules only let us treat a
            used purchase as non-refundable if the buyer saw this BEFOREHAND. */}
        {subscriptionProducts.length > 0 && (
          <Pressable
            testID="paywall-consent"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consented }}
            onPress={() => setConsented((v) => !v)}
            style={[styles.consent, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
          >
            <Text style={[styles.consentBox, { color: consented ? theme.colors.primary : theme.colors.textTertiary }]}>
              {consented ? '☑' : '☐'}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, flex: 1 }]}>
              {t('consent.subscription')}{' '}
              <Text
                style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
                onPress={() => Linking.openURL(REFUND_POLICY_URL)}
              >
                {t('consent.policyLink')}
              </Text>
            </Text>
          </Pressable>
        )}

        {/* Pricing — driven by the server catalog (get_billing_products) */}
        <View style={styles.pricing}>
          {subscriptionProducts.map((product, i) => {
            const pkg = purchaseService.findPackageForProduct(offering, storeSku(product))
            return (
              <Button
                key={product.id}
                testID={`paywall-product-${product.id}`}
                title={`${product.title} — ${formatPrice(product, pkg)}`}
                variant={i === 0 ? 'primary' : 'outline'}
                onPress={() => handlePurchaseProduct(product)}
                loading={purchasing}
                disabled={!consented}
              />
            )
          })}
          {subscriptionProducts.length === 0 && (
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: 16 }]}>
              {t('productsUnavailable')}
            </Text>
          )}
        </View>

        {/* Restore + Terms */}
        <View style={styles.footer}>
          <Button
            testID="paywall-restore"
            title={t('restorePurchase')}
            variant="ghost"
            size="sm"
            onPress={handleRestore}
            loading={purchasing}
          />
          {/* Apple/Google-mandated auto-renewal disclosure. i18n (paywall.legalDisclaimer,
              8 locales); the store proper nouns are interpolated, not translated. */}
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]}>
            {t('legalDisclaimer', {
              account: Platform.OS === 'ios' ? 'Apple ID' : 'Google',
              store: Platform.OS === 'ios' ? 'App Store' : 'Play Store',
            })}
          </Text>
          <View style={styles.legalLinks}>
            <Text
              testID="paywall-privacy-policy"
              style={[theme.typography.caption, { color: theme.colors.primary }]}
              onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
            >
              {t('privacyPolicy')}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}> | </Text>
            <Text
              testID="paywall-terms"
              style={[theme.typography.caption, { color: theme.colors.primary }]}
              onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)}
            >
              {t('termsOfService')}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}> | </Text>
            <Text
              testID="paywall-manage-subscription"
              style={[theme.typography.caption, { color: theme.colors.primary }]}
              onPress={() => Linking.openURL(MANAGE_SUBSCRIPTIONS_URL)}
            >
              {t('manageSubscription')}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}> | </Text>
            {/* Store refunds are requested, not granted, from here — see
                handleRefundRequest. Giving the user this route directly is the only
                lever we have on iOS, and it takes the CS load off support email. */}
            <Text
              testID="paywall-request-refund"
              style={[theme.typography.caption, { color: theme.colors.primary }]}
              onPress={handleRefundRequest}
            >
              {t('refund.request')}
            </Text>
          </View>
        </View>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  emoji: { fontSize: 56 },
  header: { alignItems: 'center', gap: 8, paddingTop: 8, paddingBottom: 16 },
  crown: { fontSize: 56, marginBottom: 8 },
  features: { gap: 1 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1 },
  featureIcon: { fontSize: 24, width: 36, textAlign: 'center' },
  featureInfo: { flex: 1, gap: 4 },
  comparisonRow: { flexDirection: 'row', gap: 12 },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 24, padding: 12, borderWidth: 1, borderRadius: 12 },
  consentBox: { fontSize: 18, lineHeight: 20 },
  pricing: { gap: 10, marginTop: 12 },
  footer: { gap: 12, marginTop: 24, alignItems: 'center' },
  legalLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' },
})
