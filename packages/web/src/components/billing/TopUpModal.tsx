import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog'
import { useBillingStore, PAYMENTS_ACTIVE } from '../../stores/billing-store'
import { microWonToWon } from '@reeeeecall/shared/lib/ai/server-client'
import { toIntlLocale } from '../../lib/locale-utils'

interface TopUpModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Credit top-up sheet: lists the `credit_pack` catalog (₩ price + credits granted)
 * with a buy button per pack. When no provider is wired (PAYMENTS_ACTIVE=false),
 * `startCheckout` flips a `comingSoon` flag and this shows a "준비 중" banner instead
 * of calling any provider. With a provider live (VITE_PAYMENTS_ENABLED=true +
 * VITE_PAYMENT_PROVIDER set) the buttons run the real create_payment_intent →
 * provider.checkout flow and reflect processing / success / canceled state.
 */
export function TopUpModal({ open, onClose }: TopUpModalProps) {
  const { t, i18n } = useTranslation('billing')
  const products = useBillingStore((s) => s.products)
  const loading = useBillingStore((s) => s.loading)
  const error = useBillingStore((s) => s.error)
  const comingSoon = useBillingStore((s) => s.comingSoon)
  const checkoutStatus = useBillingStore((s) => s.checkoutStatus)
  const checkoutProductId = useBillingStore((s) => s.checkoutProductId)
  const fetchProducts = useBillingStore((s) => s.fetchProducts)
  const startCheckout = useBillingStore((s) => s.startCheckout)
  const clearComingSoon = useBillingStore((s) => s.clearComingSoon)

  useEffect(() => {
    if (open) {
      clearComingSoon()
      void fetchProducts()
    }
  }, [open, fetchProducts, clearComingSoon])

  const dateLocale = toIntlLocale(i18n.language)
  const fmtWon = (won: number) => `₩${won.toLocaleString(dateLocale)}`

  const creditPacks = products
    .filter((p) => p.kind === 'credit_pack')
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const showComingSoon = !PAYMENTS_ACTIVE || comingSoon

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('topUp.title')}</DialogTitle>
          <DialogDescription>{t('topUp.subtitle')}</DialogDescription>
        </DialogHeader>

        {showComingSoon && (
          <div className="rounded-lg bg-accent px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              <span className="mr-2 inline-block rounded-full bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand">
                {t('comingSoon.badge')}
              </span>
              {t('comingSoon.title')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t('comingSoon.body')}</p>
          </div>
        )}

        {PAYMENTS_ACTIVE && checkoutStatus === 'success' && (
          <div className="rounded-lg bg-success/10 px-4 py-3">
            <p className="text-sm font-medium text-success">{t('topUp.success')}</p>
          </div>
        )}
        {PAYMENTS_ACTIVE && checkoutStatus === 'canceled' && (
          <div className="rounded-lg bg-accent px-4 py-3">
            <p className="text-sm text-muted-foreground">{t('checkout.canceled')}</p>
          </div>
        )}
        {PAYMENTS_ACTIVE && error === 'checkout_failed' && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3">
            <p className="text-sm text-destructive">{t('checkout.failed')}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error === 'load_failed' ? (
          <div className="py-4 text-center">
            <p className="mb-3 text-sm text-muted-foreground">{t('topUp.loadError')}</p>
            <button
              onClick={() => void fetchProducts()}
              className="cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-hover"
            >
              {t('retry')}
            </button>
          </div>
        ) : creditPacks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('topUp.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {creditPacks.map((p) => {
              const creditsWon = microWonToWon(p.creditsMicroWon ?? 0)
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div>
                    <p className="text-base font-semibold text-foreground tabular-nums">
                      {fmtWon(p.priceKrw)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('topUp.credits', { won: creditsWon.toLocaleString(dateLocale) })}
                    </p>
                  </div>
                  {(() => {
                    const processing =
                      checkoutStatus === 'processing' && checkoutProductId === p.id
                    return (
                      <button
                        type="button"
                        onClick={() => void startCheckout(p.id)}
                        disabled={processing}
                        title={PAYMENTS_ACTIVE ? undefined : t('comingSoon.title')}
                        className={
                          PAYMENTS_ACTIVE
                            ? 'flex items-center gap-1.5 cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-60'
                            : 'cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent/70'
                        }
                      >
                        {processing && <Loader2 className="h-4 w-4 animate-spin" />}
                        {PAYMENTS_ACTIVE ? t('topUp.buy') : t('comingSoon.badge')}
                      </button>
                    )
                  })()}
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
