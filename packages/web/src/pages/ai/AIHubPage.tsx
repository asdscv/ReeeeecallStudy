import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { aiHubEntries } from '@reeeeecall/shared/lib/ai/hub/catalog'
import { isAiBadgeEligible } from '@reeeeecall/shared/lib/ai/hub/types'
import { aiHubBus } from '@reeeeecall/shared/lib/ai/hub/events'
import {
  getAiWalletSummary,
  formatUsdMicro,
  type AiWalletSummary,
} from '@reeeeecall/shared/lib/ai/server-client'

/**
 * The AI 학습 landing: every registered AI feature, and what the user has left to spend.
 *
 * Nothing here names a feature — the tiles come from the registry, so a fourth entry appears
 * on this page and in the nav submenu from its one `.register()` call. The "AI" badge is asked
 * for per entry rather than stored: the learning plan lives in this menu but runs on the
 * device, and badging it would be a claim we do not make.
 */
export function AIHubPage() {
  const { t } = useTranslation('ai-generate')
  // `undefined` = still loading, `null` = the read failed. A menu is not a billing page, so a
  // failure shows nothing at all rather than an error banner the user cannot act on.
  const [wallet, setWallet] = useState<AiWalletSummary | null | undefined>(undefined)
  const entries = aiHubEntries()
  // One open per visit. StrictMode runs mount effects twice in dev, and a funnel that counts
  // the same arrival twice locally is a funnel nobody trusts.
  const openEmitted = useRef(false)

  useEffect(() => {
    if (openEmitted.current) return
    openEmitted.current = true
    aiHubBus.emit({ type: 'ai_hub.opened', source: 'nav' })
  }, [])

  useEffect(() => {
    let cancelled = false
    void getAiWalletSummary()
      .then((summary) => {
        if (!cancelled) setWallet(summary)
      })
      .catch(() => {
        if (!cancelled) setWallet(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Same wording as the generate screen's wallet line, and the same rule: the balance is
  // shown, never a "≈ N cards" estimate, because pricing is metered. The free limit comes
  // from the response — it is server config, not a constant.
  const walletText = !wallet
    ? null
    : wallet.freeRemainingToday > 0 && wallet.balanceMicroWon > 0
      ? `${t('wallet.freeOnly', { free: wallet.freeRemainingToday })} · ${t('wallet.balance', { amount: formatUsdMicro(wallet.balanceMicroWon) })}`
      : wallet.freeRemainingToday > 0
        ? t('wallet.freeOnly', { free: wallet.freeRemainingToday })
        : wallet.balanceMicroWon > 0
          ? t('wallet.balance', { amount: formatUsdMicro(wallet.balanceMicroWon) })
          : t('wallet.empty')

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-medium text-foreground">{t('hub.title')}</h1>
        <p className="text-xs text-content-tertiary mt-0.5">{t('hub.subtitle')}</p>
      </div>

      {wallet === undefined ? (
        <div className="h-10 rounded-lg bg-card border border-border animate-pulse" />
      ) : walletText ? (
        <p className="px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground tabular-nums">
          {walletText}
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {entries.map((entry) => (
          <Link
            key={entry.id}
            to={entry.webPath}
            onClick={() => aiHubBus.emit({ type: 'ai_hub.entry_opened', entryId: entry.id, source: 'hub' })}
            className="block p-4 bg-card rounded-xl border border-border no-underline transition hover:border-brand/40 hover:bg-accent/40"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none" aria-hidden="true">{entry.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium text-foreground">{t(entry.titleKey)}</h2>
                  {isAiBadgeEligible(entry) && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand/10 text-brand">
                      {t('hub.badge.ai')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t(entry.descKey)}</p>
                <p className="text-xs text-brand mt-3">{t('hub.openAction')}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
