import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  refusalFrom, refusalMessageKey, refusalFallbackKey, isWalletRefusal,
  type PaidActionId,
} from '@reeeeecall/shared/lib/ai/refusal'

/**
 * The one way this app says "that cost money and it did not happen".
 *
 * Every paid surface had its own rendering of the same server condition, and the differences
 * were not cosmetic: the quiz RUN screen printed "충전하면 계속할 수 있어요" with no way to 충전
 * anywhere on it, because the component carrying the top-up link was mounted only on the two
 * screens BEFORE the quiz started. A learner who ran out at question six was told to top up by
 * a screen that could not take them there, on mobile could not leave without abandoning the
 * run, and was not told that finishing and self-marking was free.
 *
 * So the route out is not a prop. It is attached to the classification: `topUp` is true for
 * exactly one refusal kind, and this component renders the link whenever it is. A screen cannot
 * forget it, and a screen cannot add one to a refusal that topping up would not fix — the
 * daily request cap is not a money problem and offering a charge link there sells nothing.
 */
export function AiRefusalNotice({ code, actionId, onRetry, className = '' }: {
  /** The server's code, verbatim. Null renders nothing. */
  code: string | null | undefined
  /** Which paid action was refused, so a free way forward can be offered when one exists. */
  actionId?: PaidActionId
  /** Offered only when pressing again could plausibly work. */
  onRetry?: () => void
  className?: string
}) {
  const { t } = useTranslation('ai-generate')
  if (!code) return null

  const refusal = refusalFrom(code)
  const fallbackKey = refusalFallbackKey(refusal, actionId)

  return (
    <div
      role="alert"
      className={`rounded-lg border px-3 py-2.5 text-sm ${
        isWalletRefusal(refusal)
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'border-destructive/30 bg-destructive/10 text-destructive'
      } ${className}`}
      data-testid="ai-refusal"
      data-kind={refusal.kind}
    >
      <p>{t(refusalMessageKey(refusal))}</p>

      {/* The one thing they can act on, wherever they hit it. */}
      {refusal.topUp && (
        <Link
          to="/settings"
          className="mt-1.5 inline-block font-medium underline underline-offset-2"
          data-testid="ai-refusal-topup"
        >
          {t('wallet.topUp')}
        </Link>
      )}

      {/* And what they can do without paying at all, when the feature has such a path. */}
      {fallbackKey && (
        <p className="mt-1.5 text-xs opacity-90" data-testid="ai-refusal-fallback">
          {t(fallbackKey)}
        </p>
      )}

      {onRetry && refusal.retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 block cursor-pointer text-xs font-medium underline underline-offset-2"
          data-testid="ai-refusal-retry"
        >
          {t('wallet.refusal.retry')}
        </button>
      )}
    </div>
  )
}
