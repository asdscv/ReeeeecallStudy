import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wallet, Sparkles, Clock, Loader2 } from 'lucide-react'
import {
  getAiWalletSummary,
  microWonToWon,
  type AiWalletSummary,
} from '@reeeeecall/shared/lib/ai/server-client'
import { toIntlLocale } from '../lib/locale-utils'

// User-facing AI wallet / usage screen: prepaid ₩ balance (충전금), today's free-tier
// usage, and recent spend/top-up history (from get_ai_wallet_summary, mig 117).
// Top-up is disabled — payment (Phase 2) is on hold.
export function WalletPage() {
  const { t, i18n } = useTranslation('wallet')
  const [summary, setSummary] = useState<AiWalletSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = () => {
    setState('loading')
    getAiWalletSummary().then((s) => {
      if (s) { setSummary(s); setState('ready') } else { setState('error') }
    })
  }
  useEffect(load, [])

  const dateLocale = toIntlLocale(i18n.language)
  const fmtWon = (won: number) => `₩${won.toLocaleString(dateLocale)}`
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const balanceWon = summary ? microWonToWon(summary.balanceMicroWon) : 0
  const freePct = summary
    ? Math.min(100, Math.round((summary.freeUsedToday / Math.max(1, summary.freeLimit)) * 100))
    : 0

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Wallet size={22} className="text-brand" />
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t('title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-5 sm:mb-6">{t('subtitle')}</p>

      {state === 'loading' && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {state === 'error' && (
        <div className="bg-card rounded-xl border border-border p-6 text-center">
          <p className="text-sm text-muted-foreground mb-3">{t('error')}</p>
          <button
            onClick={load}
            className="px-4 py-2 text-sm text-white bg-brand rounded-lg hover:bg-brand-hover transition cursor-pointer font-medium"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {state === 'ready' && summary && (
        <div className="space-y-4 sm:space-y-6">
          {/* ── Balance (충전금) ── */}
          <section className="bg-card rounded-xl border border-border p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-2">
              <Wallet size={18} className="text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">{t('balance.title')}</h2>
            </div>
            <div className="text-3xl font-bold text-foreground tabular-nums">{fmtWon(balanceWon)}</div>
            <p className="text-xs text-muted-foreground mt-2">{t('balance.hint')}</p>
            <button
              disabled
              title={t('balance.topUpSoon')}
              className="mt-4 w-full sm:w-auto px-4 py-2 text-sm rounded-lg bg-accent text-muted-foreground cursor-not-allowed font-medium"
            >
              {t('balance.topUp')}
            </button>
          </section>

          {/* ── Free tier today ── */}
          <section className="bg-card rounded-xl border border-border p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">{t('free.title')}</h2>
              </div>
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
          </section>

          {/* ── Usage history ── */}
          <section className="bg-card rounded-xl border border-border p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={18} className="text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">{t('history.title')}</h2>
            </div>
            {summary.ledger.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t('history.empty')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {summary.ledger.map((e, i) => {
                  const positive = e.delta >= 0
                  return (
                    <li key={i} className="flex items-center justify-between py-3">
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
          </section>
        </div>
      )}
    </div>
  )
}
