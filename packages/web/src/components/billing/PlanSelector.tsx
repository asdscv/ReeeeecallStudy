import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Check } from 'lucide-react'
import { toIntlLocale } from '../../lib/locale-utils'
import { useBillingStore, PAYMENTS_ACTIVE } from '../../stores/billing-store'

// A card_limit at or above this sentinel means "unlimited" for DISPLAY only. The DB
// stores/uses card_limit as a normal integer cap (e.g. sub_unlimited_monthly = 2e9,
// mig 124); ONLY the presentation layer collapses big caps to the word
// "무제한 / Unlimited". Never special-case this server-side.
export const UNLIMITED_CARD_LIMIT = 1_000_000_000 // 1e9

export function isUnlimitedCardLimit(limit: number | null | undefined): boolean {
  return limit != null && limit >= UNLIMITED_CARD_LIMIT
}

/**
 * Data-driven subscription plan selector for the card-storage Settings section.
 *
 * Reads the subscription catalog from the billing store (`get_billing_products`),
 * filtered to `kind === 'subscription' && isActive` and sorted by `sortOrder`, so a
 * new/edited/removed plan is a catalog row change alone — no code edit here. Each row
 * shows title, card limit ("무제한" when >= 1e9, else the formatted number), the ₩
 * price, and a Select button → `startCheckout(plan.id)`. The user's current plan
 * (matched by `subscription.productId`) is highlighted and its button disabled.
 *
 * When payments have no provider wired (`PAYMENTS_ACTIVE === false`), the buttons
 * reuse the store's coming-soon gating (startCheckout flips `comingSoon`, never calls
 * a provider) and a short coming-soon note is shown.
 */
export function PlanSelector() {
  const { t, i18n } = useTranslation('billing')
  const products = useBillingStore((s) => s.products)
  const subscription = useBillingStore((s) => s.subscription)
  const loading = useBillingStore((s) => s.loading)
  const comingSoon = useBillingStore((s) => s.comingSoon)
  const checkoutProductId = useBillingStore((s) => s.checkoutProductId)
  const checkoutStatus = useBillingStore((s) => s.checkoutStatus)
  const error = useBillingStore((s) => s.error)
  const fetchProducts = useBillingStore((s) => s.fetchProducts)
  const fetchSubscription = useBillingStore((s) => s.fetchSubscription)
  const startCheckout = useBillingStore((s) => s.startCheckout)

  // Load on mount, reusing the store's cache: only fetch the catalog if it's empty
  // (TopUpModal / SubscribeButton may already have populated it). Subscription is a
  // cheap display-only read that fails open to null.
  useEffect(() => {
    if (products.length === 0) void fetchProducts()
    void fetchSubscription()
  }, [products.length, fetchProducts, fetchSubscription])

  const locale = toIntlLocale(i18n.language)
  const fmtWon = (won: number) => `₩${won.toLocaleString(locale)}`

  const plans = products
    .filter((p) => p.kind === 'subscription' && p.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  // The current plan is whichever active-subscription product the user holds.
  const currentProductId = subscription?.productId ?? null

  // Cancel-at-period-end (mig 121): access is retained until current_period_end.
  const cancelPending = !!subscription?.cancelAtPeriodEnd
  const periodEndLabel = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  if (loading && plans.length === 0) {
    return (
      <div className="mt-3 flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  if (plans.length === 0) return null

  // Scope the checkout status notes to THIS selector: the store's checkout state is
  // global (a credit-pack top-up in WalletSummary shares it), so only surface
  // success/failed when the in-flight product is one of the subscription plans.
  const checkoutIsPlan = plans.some((p) => p.id === checkoutProductId)

  return (
    <div className="mt-4">
      <p className="mb-2 text-sm font-semibold text-foreground">{t('plans.title')}</p>
      <ul className="space-y-2">
        {plans.map((p) => {
          const isCurrent = currentProductId != null && p.id === currentProductId
          const unlimited = isUnlimitedCardLimit(p.cardLimit)
          const limitLabel = unlimited
            ? t('plans.unlimited')
            : t('plans.cardLimit', { limit: (p.cardLimit ?? 0).toLocaleString(locale) })
          const priceLabel =
            p.period === 'monthly'
              ? `${fmtWon(p.priceKrw)} ${t('plans.perMonth')}`
              : fmtWon(p.priceKrw)
          const processing = checkoutStatus === 'processing' && checkoutProductId === p.id

          return (
            <li
              key={p.id}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                isCurrent ? 'border-brand bg-brand/5' : 'border-border bg-card'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{p.title}</p>
                  {isCurrent && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand">
                      <Check className="h-3 w-3" />
                      {t('plans.current')}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{limitLabel}</p>
                <p className="mt-0.5 text-sm font-medium text-foreground tabular-nums">
                  {priceLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void startCheckout(p.id)}
                disabled={isCurrent || processing}
                title={PAYMENTS_ACTIVE ? undefined : t('comingSoon.title')}
                className={
                  isCurrent
                    ? 'cursor-not-allowed rounded-lg bg-accent px-4 py-2 text-sm font-medium text-muted-foreground'
                    : PAYMENTS_ACTIVE
                      ? 'flex items-center gap-1.5 cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-60'
                      : 'cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent/70'
                }
              >
                {processing && <Loader2 className="h-4 w-4 animate-spin" />}
                {isCurrent
                  ? t('plans.current')
                  : PAYMENTS_ACTIVE
                    ? t('plans.select')
                    : t('comingSoon.badge')}
              </button>
            </li>
          )
        })}
      </ul>

      {cancelPending && (
        <p className="mt-2 text-xs text-muted-foreground">
          {periodEndLabel
            ? t('subscribe.cancelPending', { date: periodEndLabel })
            : t('subscribe.cancelPendingNoDate')}
        </p>
      )}
      {(!PAYMENTS_ACTIVE || comingSoon) && (
        <p className="mt-2 text-xs text-muted-foreground">{t('comingSoon.body')}</p>
      )}
      {PAYMENTS_ACTIVE && checkoutIsPlan && checkoutStatus === 'success' && (
        <p className="mt-2 text-xs text-success">{t('subscribe.success')}</p>
      )}
      {PAYMENTS_ACTIVE && checkoutIsPlan && error === 'checkout_failed' && (
        <p className="mt-2 text-xs text-destructive">{t('checkout.failed')}</p>
      )}
    </div>
  )
}
