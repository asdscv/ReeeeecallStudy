import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { formatUsdMicro } from '@reeeeecall/shared/lib/ai/server-client'
import { useBillingStore, PAYMENTS_ACTIVE } from '../../stores/billing-store'
import { TopUpModal } from '../billing/TopUpModal'
import { CreditLedgerList } from './CreditLedgerList'

// AI wallet / usage content for the Settings accordion section (충전금·사용량):
// prepaid $ balance, today's free-tier usage, and recent spend/top-up history
// (get_ai_wallet_summary, mig 117). Fetches on mount — the parent CollapsibleSection
// only mounts this when expanded. Top-up opens TopUpModal (payment gated OFF until a
// provider is wired — the modal shows a coming-soon state).
export function WalletSummary() {
  const { t } = useTranslation('wallet')
  // Read from the billing store so a successful top-up (which calls fetchWallet)
  // reflects here without a manual reload.
  const summary = useBillingStore((s) => s.wallet)
  const walletState = useBillingStore((s) => s.walletState)
  const fetchWallet = useBillingStore((s) => s.fetchWallet)
  const [topUpOpen, setTopUpOpen] = useState(false)

  useEffect(() => { void fetchWallet() }, [fetchWallet])

  if (!summary && (walletState === 'loading' || walletState === 'idle')) {
    return <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }
  if (walletState === 'error' || !summary) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-muted-foreground mb-3">{t('error')}</p>
        <button onClick={() => void fetchWallet()} className="px-4 py-2 text-sm text-white bg-brand rounded-lg hover:bg-brand-hover transition cursor-pointer font-medium">{t('retry')}</button>
      </div>
    )
  }

  const freePct = Math.min(100, Math.round((summary.freeUsedToday / Math.max(1, summary.freeLimit)) * 100))

  return (
    <div className="space-y-5">
      {/* Balance */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">{t('balance.title')}</p>
        <div className="text-3xl font-bold text-foreground tabular-nums">{formatUsdMicro(summary.balanceMicroWon)}</div>
        <p className="text-xs text-muted-foreground mt-1">{t('balance.hint')}</p>
        <p className="text-xs text-content-tertiary mt-1">{t('cardPlanHint')}</p>
        <button
          onClick={() => setTopUpOpen(true)}
          title={PAYMENTS_ACTIVE ? undefined : t('balance.topUpSoon')}
          className={`mt-3 px-4 py-2 text-sm rounded-lg cursor-pointer font-medium transition ${
            PAYMENTS_ACTIVE
              ? 'bg-brand text-white hover:bg-brand-hover'
              : 'bg-accent text-muted-foreground hover:bg-accent/70'
          }`}
        >
          {t('balance.topUp')}
        </button>
        <TopUpModal open={topUpOpen} onClose={() => setTopUpOpen(false)} />
      </div>

      {/* Free today */}
      <div className="pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-foreground">{t('free.title')}</p>
          <span className="text-sm text-muted-foreground tabular-nums">
            {t('free.count', { used: summary.freeUsedToday, limit: summary.freeLimit })}
          </span>
        </div>
        <div className="h-2 rounded-full bg-accent overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${summary.freeRemainingToday <= 0 ? 'bg-destructive' : 'bg-brand'}`}
            style={{ width: `${freePct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">{t('free.note')}</p>
      </div>

      {/* History — infinite scroll via get_ai_credit_ledger (mig 130); reloads page 1
          when the balance moves (a top-up/spend) so a new entry appears live. */}
      <CreditLedgerList refreshKey={summary.balanceMicroWon} />
    </div>
  )
}
