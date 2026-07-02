import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { microWonToWon } from '@reeeeecall/shared/lib/ai/server-client'
import { toIntlLocale } from '../../lib/locale-utils'
import { useBillingStore } from '../../stores/billing-store'
import { TopUpModal } from '../billing/TopUpModal'

// AI wallet / usage content for the Settings accordion section (충전금·사용량):
// prepaid ₩ balance, today's free-tier usage, and recent spend/top-up history
// (get_ai_wallet_summary, mig 117). Fetches on mount — the parent CollapsibleSection
// only mounts this when expanded. Top-up opens TopUpModal (payment gated OFF until a
// provider is wired — the modal shows a coming-soon state).
export function WalletSummary() {
  const { t, i18n } = useTranslation('wallet')
  // Read from the billing store so a successful top-up (which calls fetchWallet)
  // reflects here without a manual reload.
  const summary = useBillingStore((s) => s.wallet)
  const walletState = useBillingStore((s) => s.walletState)
  const fetchWallet = useBillingStore((s) => s.fetchWallet)
  const [topUpOpen, setTopUpOpen] = useState(false)

  useEffect(() => { void fetchWallet() }, [fetchWallet])

  const dateLocale = toIntlLocale(i18n.language)
  const fmtWon = (won: number) => `₩${won.toLocaleString(dateLocale)}`
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

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

  const balanceWon = microWonToWon(summary.balanceMicroWon)
  const freePct = Math.min(100, Math.round((summary.freeUsedToday / Math.max(1, summary.freeLimit)) * 100))

  return (
    <div className="space-y-5">
      {/* Balance */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">{t('balance.title')}</p>
        <div className="text-3xl font-bold text-foreground tabular-nums">{fmtWon(balanceWon)}</div>
        <p className="text-xs text-muted-foreground mt-1">{t('balance.hint')}</p>
        <button
          onClick={() => setTopUpOpen(true)}
          title={t('balance.topUpSoon')}
          className="mt-3 px-4 py-2 text-sm rounded-lg bg-accent text-muted-foreground hover:bg-accent/70 cursor-pointer font-medium transition"
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

      {/* History */}
      <div className="pt-4 border-t border-border">
        <p className="text-sm font-semibold text-foreground mb-2">{t('history.title')}</p>
        {summary.ledger.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2 text-center">{t('history.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {summary.ledger.map((e, i) => {
              const positive = e.delta >= 0
              return (
                <li key={i} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm text-foreground">{t(`reason.${e.reason}`, { defaultValue: e.reason })}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(e.createdAt)}</p>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ${positive ? 'text-success' : 'text-destructive'}`}>
                    {positive ? '+' : '−'}{fmtWon(microWonToWon(Math.abs(e.delta)))}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
