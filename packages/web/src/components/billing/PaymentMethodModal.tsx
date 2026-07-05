import { useTranslation } from 'react-i18next'
import { providersForKind, type PaymentProviderId } from '../../lib/payments'
import { useBillingStore } from '../../stores/billing-store'

// Payment-method chooser — shown only when MORE THAN ONE provider is configured for the
// product kind (e.g. Toss + LemonSqueezy). With a single provider the caller skips this
// and starts checkout directly. Picking a method starts checkout with that provider id.
export function PaymentMethodModal({
  open,
  productId,
  kind,
  onClose,
}: {
  open: boolean
  productId: string | null
  kind: 'credit_pack' | 'subscription'
  onClose: () => void
}) {
  const { t } = useTranslation('billing')
  const startCheckout = useBillingStore((s) => s.startCheckout)
  if (!open || !productId) return null

  const providers = providersForKind(kind)
  const pick = (id: PaymentProviderId) => {
    onClose()
    void startCheckout(productId, id)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xs rounded-xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="mb-3 text-sm font-semibold text-foreground">{t('methods.title')}</p>
        <div className="space-y-2">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p.id as PaymentProviderId)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:border-brand hover:bg-brand/5"
            >
              <span>{t(p.labelKey)}</span>
              <span aria-hidden className="text-muted-foreground">›</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          {t('methods.cancel')}
        </button>
      </div>
    </div>
  )
}
