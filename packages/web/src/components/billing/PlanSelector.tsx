import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Check, ExternalLink } from 'lucide-react'
import { toIntlLocale } from '../../lib/locale-utils'
import { supabase } from '../../lib/supabase'
import { useBillingStore, PAYMENTS_ACTIVE } from '../../stores/billing-store'
import { preferredProviderId } from '../../lib/payments'
import { formatProductPrice } from '@reeeeecall/shared/lib/pricing'

// A card_limit at or above this sentinel means "unlimited" for DISPLAY only. As of
// mig 148 NO subscription plan is unlimited (the top plan caps at 100,000); this now
// only collapses to "무제한 / Unlimited" for admins, whose effective limit is 2e9
// (mig 139). Never special-case this server-side.
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
 * shows title, card limit ("무제한" when >= 1e9, else the formatted number), the $
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
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState(false)

  // Open LemonSqueezy's hosted customer portal (cancel / change plan / update card).
  // LS is Merchant of Record, so we never mutate the subscription ourselves — the
  // portal does, and the resulting subscription_updated/cancelled webhook syncs it
  // back. The signed URL is fetched per click (subscription-portal edge fn). A blank
  // tab is pre-opened INSIDE the click gesture so the popup isn't blocked after the
  // async call; null (blocked) → same-tab fallback.
  const openPortal = async () => {
    if (portalLoading) return
    setPortalError(false)
    const tab = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null
    setPortalLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('subscription-portal', {
        method: 'POST',
      })
      const url = (data as { url?: string } | null)?.url
      if (error || !url) {
        tab?.close()
        setPortalError(true)
        return
      }
      if (tab && !tab.closed) tab.location.href = url
      else window.location.href = url
    } catch {
      tab?.close()
      setPortalError(true)
    } finally {
      setPortalLoading(false)
    }
  }

  // Load on mount, reusing the store's cache: only fetch the catalog if it's empty
  // (TopUpModal / SubscribeButton may already have populated it). Subscription is a
  // cheap display-only read that fails open to null.
  useEffect(() => {
    if (products.length === 0) void fetchProducts()
    void fetchSubscription()
  }, [products.length, fetchProducts, fetchSubscription])

  const locale = toIntlLocale(i18n.language)
  // Price is always USD — the store charges USD everywhere (LemonSqueezy; Toss/₩ dropped).
  const fmtPrice = (p: (typeof products)[number]) =>
    formatProductPrice(p)

  const plans = products
    .filter((p) => p.kind === 'subscription' && p.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  // The current plan is whichever active-subscription product the user holds.
  const currentProductId = subscription?.productId ?? null
  const currentProvider = subscription?.provider ?? null

  // (P-H5) A live LemonSqueezy (Merchant-of-Record) subscriber must change plans through the
  // hosted portal — NOT by opening a fresh checkout, which would start a SECOND, independently
  // -billed LS subscription (double-charge). So lock the per-plan Select for LS subscribers and
  // route them to the portal button below. (The server also rejects a second LS checkout.)
  const lockPlanSwitch = PAYMENTS_ACTIVE && currentProductId != null && currentProvider === 'lemonsqueezy'

  // LemonSqueezy is the only payment provider (Toss/₩ dropped); preferredProviderId()
  // always resolves to it, and the displayed $ price is what it charges.
  const beginCheckout = (productId: string) => {
    void startCheckout(productId, preferredProviderId())
  }

  // Toss subscriptions have no hosted portal — we run the recurring charge, so cancel /
  // resume is an in-app RPC (flips cancel_at_period_end; the renewal scheduler obeys it).
  const [cancelLoading, setCancelLoading] = useState(false)
  const setCancel = async (cancel: boolean) => {
    if (cancelLoading) return
    setCancelLoading(true)
    const rpc = cancel ? 'request_cancel_my_subscription' : 'request_resume_my_subscription'
    const { data, error } = await supabase.rpc(rpc)
    if (!error && (data as { ok?: boolean } | null)?.ok) await fetchSubscription()
    setCancelLoading(false)
  }

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
              ? `${fmtPrice(p)} ${t('plans.perMonth')}`
              : fmtPrice(p)
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
                onClick={() => { if (lockPlanSwitch && !isCurrent) { void openPortal() } else { beginCheckout(p.id) } }}
                disabled={isCurrent || processing || (lockPlanSwitch && portalLoading)}
                title={
                  isCurrent
                    ? undefined
                    : lockPlanSwitch
                      ? t('manageSubscription.hint')
                      : PAYMENTS_ACTIVE ? undefined : t('comingSoon.title')
                }
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
                  : lockPlanSwitch
                    ? t('manageSubscription.button')
                    : PAYMENTS_ACTIVE
                      ? t('plans.select')
                      : t('comingSoon.badge')}
              </button>
            </li>
          )
        })}
      </ul>

      {/* Manage the current subscription. LemonSqueezy (Merchant of Record) → its hosted
          customer portal (cancel / change plan / update card). Toss → in-app cancel /
          resume (we run the recurring charge ourselves). */}
      {PAYMENTS_ACTIVE && currentProductId != null && currentProvider === 'lemonsqueezy' && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void openPortal()}
            disabled={portalLoading}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-60"
          >
            {portalLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            {t('manageSubscription.button')}
          </button>
          <p className="mt-1.5 text-xs text-muted-foreground">{t('manageSubscription.hint')}</p>
          {portalError && (
            <p className="mt-1 text-xs text-destructive">{t('manageSubscription.error')}</p>
          )}
        </div>
      )}

      {PAYMENTS_ACTIVE && currentProductId != null && currentProvider === 'toss' && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void setCancel(!cancelPending)}
            disabled={cancelLoading}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-60"
          >
            {cancelLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {cancelPending ? t('manageSubscription.resume') : t('manageSubscription.cancel')}
          </button>
        </div>
      )}

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
