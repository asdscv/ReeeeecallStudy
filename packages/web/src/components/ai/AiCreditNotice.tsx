import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  getAiWalletSummary, formatUsdMicro, type AiWalletSummary,
} from '@reeeeecall/shared/lib/ai/server-client'
import {
  creditNotice, aiFeatureRequiresCredits,
} from '@reeeeecall/shared/lib/ai/credit-notice'

/**
 * The one notice every AI screen shows: what there is to spend.
 *
 * Placed by feature id rather than by hand, so registering a fourth AI feature with
 * `poweredBy: 'model'` in `hub/catalog.ts` is the whole edit — the notice follows. A feature
 * that spends nothing (`'device'`, the learning plan) renders nothing here rather than a
 * reassuring "무료" line, because a line about credits on a screen that never touches them is
 * noise the learner has to learn to ignore.
 *
 * Deliberately NOT a price. That was removed from the flow on purpose: a learner is not told
 * an amount before acting. What is left is the fact they cannot act around — whether they have
 * anything at all — and the way to fix it when they do not.
 */
export function AiCreditNotice({ featureId, className = '' }: {
  featureId: string
  className?: string
}) {
  const { t } = useTranslation('ai-generate')
  // `undefined` is "not read yet", `null` is "read failed" — different screens, both handled
  // by `creditNotice`. Collapsing them would show "잔액 없음" during every load.
  const [wallet, setWallet] = useState<AiWalletSummary | null | undefined>(undefined)
  const needed = aiFeatureRequiresCredits(featureId)

  useEffect(() => {
    if (!needed) return
    let cancelled = false
    void getAiWalletSummary()
      .then((w) => { if (!cancelled) setWallet(w) })
      .catch(() => { if (!cancelled) setWallet(null) })
    return () => { cancelled = true }
  }, [needed, featureId])

  if (!needed) return null

  const notice = creditNotice(wallet, formatUsdMicro)
  if (!notice) {
    // Reserve the row while the read is in flight, so the content below does not jump.
    return <div className={`h-10 animate-pulse rounded-lg border border-border bg-card ${className}`} />
  }

  const line = notice.secondKey
    ? `${t(notice.key, notice.params)} · ${t(notice.secondKey, notice.secondParams)}`
    : t(notice.key, notice.params)

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-sm tabular-nums ${
        notice.tone === 'empty'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'border-border bg-card text-muted-foreground'
      } ${className}`}
      data-testid="ai-credit-notice"
      data-tone={notice.tone}
    >
      {line}
      {/* Only when there is nothing left. A charge link beside a healthy balance is an advert;
          beside an empty one it is the answer to the sentence above it. */}
      {notice.tone === 'empty' && (
        <>
          {' '}
          {/* The wallet lives on the settings screen; there is no separate billing route. */}
          <Link to="/settings" className="font-medium underline underline-offset-2">
            {t('wallet.topUp')}
          </Link>
        </>
      )}
    </div>
  )
}
