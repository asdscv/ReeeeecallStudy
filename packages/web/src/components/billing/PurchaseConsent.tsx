import { useTranslation } from 'react-i18next'

interface PurchaseConsentProps {
  checked: boolean
  onChange: (v: boolean) => void
  /** 'credit_pack' wording talks about credits; 'subscription' about the plan period. */
  kind: 'credit_pack' | 'subscription'
  id?: string
}

/**
 * Pre-purchase disclosure that the right of withdrawal is lost once the digital
 * content is used.
 *
 * This is not decoration — it is the legal basis for our refund policy. Korea's
 * 전자상거래법 permits restricting withdrawal for digital content only where the
 * restriction was disclosed BEFORE the purchase, and the EU/UK equivalent requires
 * the buyer's express consent to immediate performance plus acknowledgement that the
 * withdrawal right is thereby lost. Without this box ticked and recorded, "you already
 * used it" is not a defensible reason to refuse a refund in either market — which is
 * exactly what refund_eligibility reports via `consent_recorded` (mig 157).
 *
 * The tick is recorded server-side by billing-store's startCheckout, which calls
 * record_purchase_consent with the merchant_uid so the consent is tied to the charge
 * and stamped with a server time the client cannot back-date.
 */
export function PurchaseConsent({ checked, onChange, kind, id = 'purchase-consent' }: PurchaseConsentProps) {
  const { t } = useTranslation('billing')
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand"
      />
      <span>
        {t(kind === 'subscription' ? 'consent.subscription' : 'consent.creditPack')}{' '}
        <a
          href="/refund-policy.html"
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="underline hover:text-foreground"
        >
          {t('consent.policyLink')}
        </a>
      </span>
    </label>
  )
}
