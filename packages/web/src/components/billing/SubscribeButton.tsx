import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toIntlLocale } from '../../lib/locale-utils'
import { useBillingStore, PAYMENTS_ACTIVE } from '../../stores/billing-store'

/**
 * Card-limit "upgrade" CTA → subscribe to the cheapest active subscription plan.
 *
 * The plan is DATA-DRIVEN: it's the first `kind === 'subscription' && isActive`
 * product from the billing catalog (get_billing_products), sorted by `sortOrder`.
 * We must NOT hardcode a product id — mig 124 retired the old `sub_pro_monthly`
 * placeholder (is_active=false) in favor of `sub_5k_monthly` / `sub_unlimited_monthly`,
 * and create_payment_intent rejects any inactive product ("Unknown or inactive
 * product"). Reading the catalog keeps this pointed at a real, active plan through
 * any future catalog edit. (The full plan list lives in PlanSelector on Settings;
 * this is the compact single-CTA entry point used by the over-cap prompt.)
 *
 * When no provider is wired (VITE_PAYMENT_PROVIDER unset), `startCheckout` flips a
 * `comingSoon` flag (no provider call) and we reveal a short coming-soon note. With
 * a provider live it runs the real create_payment_intent → provider.checkout flow
 * and reflects processing / success / canceled state.
 *
 * Also reads get_my_subscription (via the billing store) so that when the current
 * plan is set to cancel at period end (cancel_at_period_end from mig 121), we show
 * a "canceling on <date>" note instead of implying the plan just vanished — access
 * is retained through current_period_end.
 */
export function SubscribeButton() {
  const { t, i18n } = useTranslation('billing')
  const products = useBillingStore((s) => s.products)
  const startCheckout = useBillingStore((s) => s.startCheckout)
  const comingSoon = useBillingStore((s) => s.comingSoon)
  const checkoutProductId = useBillingStore((s) => s.checkoutProductId)
  const checkoutStatus = useBillingStore((s) => s.checkoutStatus)
  const error = useBillingStore((s) => s.error)
  const subscription = useBillingStore((s) => s.subscription)
  const fetchProducts = useBillingStore((s) => s.fetchProducts)
  const fetchSubscription = useBillingStore((s) => s.fetchSubscription)

  // Load on mount, reusing the store's cache: only fetch the catalog if it's empty
  // (PlanSelector / TopUpModal may already have populated it).
  useEffect(() => {
    if (products.length === 0) void fetchProducts()
    void fetchSubscription()
  }, [products.length, fetchProducts, fetchSubscription])

  // Cheapest active subscription plan (data-driven — never a hardcoded id).
  const targetPlan =
    products
      .filter((p) => p.kind === 'subscription' && p.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null
  const targetPlanId = targetPlan?.id ?? null

  const isThis = targetPlanId != null && checkoutProductId === targetPlanId
  const showSoon = comingSoon && isThis
  const processing = isThis && checkoutStatus === 'processing'
  const succeeded = isThis && checkoutStatus === 'success'
  const canceled = isThis && checkoutStatus === 'canceled'
  const failed = isThis && error === 'checkout_failed'

  // Plan set to cancel at the end of the paid period: keep access until then, but
  // tell the user. current_period_end can be null (perpetual/unknown) → no date.
  const cancelPending = !!subscription?.cancelAtPeriodEnd
  const periodEndLabel =
    subscription?.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).toLocaleDateString(toIntlLocale(i18n.language), {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null

  // Fail closed: with no active subscription plan in the catalog there's nothing to
  // check out, so don't render a CTA that would throw "Unknown or inactive product".
  if (!targetPlanId) return null

  return (
    <div>
      <button
        type="button"
        onClick={() => void startCheckout(targetPlanId)}
        disabled={processing}
        title={PAYMENTS_ACTIVE ? undefined : t('comingSoon.title')}
        className={
          PAYMENTS_ACTIVE
            ? 'mt-2 flex items-center gap-1.5 cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-60'
            : 'mt-2 cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent/70'
        }
      >
        {processing && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('subscribe.cta')}
      </button>
      {cancelPending && (
        <p className="mt-2 text-xs text-muted-foreground">
          {periodEndLabel
            ? t('subscribe.cancelPending', { date: periodEndLabel })
            : t('subscribe.cancelPendingNoDate')}
        </p>
      )}
      {showSoon && <p className="mt-2 text-xs text-muted-foreground">{t('comingSoon.body')}</p>}
      {succeeded && <p className="mt-2 text-xs text-success">{t('subscribe.success')}</p>}
      {canceled && <p className="mt-2 text-xs text-muted-foreground">{t('checkout.canceled')}</p>}
      {failed && <p className="mt-2 text-xs text-destructive">{t('checkout.failed')}</p>}
    </div>
  )
}
