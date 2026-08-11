import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AI_HUB_QUIZ } from '@reeeeecall/shared/lib/ai/hub/catalog'
import { AiCreditNotice } from '../../components/ai/AiCreditNotice'
import { Link, useNavigate } from 'react-router-dom'
import { useQuizStore, type QuizSetRow } from '@reeeeecall/shared/stores/quiz-store'
import { ListSkeleton } from '../../components/common/Skeleton'

/**
 * The quiz home: what you have made, and the way to make more.
 *
 * Sets are listed rather than runs. A set is the thing that cost money and the thing worth
 * coming back to — retaking one is free, and a list of past sittings would bury the reusable
 * asset under its own history.
 */
export function QuizHomePage() {
  const { t } = useTranslation('quiz')
  const navigate = useNavigate()
  const { sets, loading, fetchSets, grantTrial, startRun } = useQuizStore()
  // The trial is still GRANTED — it is what makes a new account's first quizzes free — but
  // the amount is no longer announced. Nothing renders it, so nothing holds it.
  const [, setTrialUnits] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void fetchSets()
    // The one-time allowance is granted on first arrival, not at signup: an allowance that
    // expires before it is seen buys nothing. The RPC is once-per-account, so this is free
    // on every later visit.
    void grantTrial().then(setTrialUnits).catch(() => setTrialUnits(null))
  }, [fetchSets, grantTrial])

  const take = async (setRow: QuizSetRow) => {
    setBusy(setRow.id)
    try {
      const runId = await startRun(setRow.id)
      navigate(`/quiz/${runId}/run`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium text-foreground">{t('home.title')}</h1>
          <p className="text-xs text-content-tertiary mt-0.5">{t('home.subtitle')}</p>
        </div>
        <Link
          to="/quiz/new"
          className="px-3 py-1.5 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover shrink-0"
        >
          {t('home.create')}
        </Link>
      </div>

      {/* Quiz spends the same wallet as card generation and had never said so — a learner
          could reach a paid action from a screen that never mentioned credits. Placed by
          feature id, so it follows the catalog rather than this file. */}
      <AiCreditNotice featureId={AI_HUB_QUIZ} />

      {loading && sets.length === 0 ? (
        <ListSkeleton />
      ) : sets.length === 0 ? (
        <div className="p-6 bg-card rounded-xl border border-border text-center">
          <p className="text-sm text-muted-foreground">{t('home.empty.title')}</p>
          <p className="text-xs text-content-tertiary mt-1">{t('home.empty.body')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sets.map((setRow) => (
            <li key={setRow.id} className="p-3 bg-card rounded-lg border border-border">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{setRow.title}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-xs text-content-tertiary">
                      {t(`type.${setRow.question_type}`)}
                    </span>
                    <span className="text-xs text-content-tertiary">
                      {t('home.questions', { count: setRow.generated_count })}
                    </span>
                    {/* Under-delivery, said out loud. Items that fail validation are dropped and
                        never charged for, so asking for 6 and getting 4 is a normal outcome —
                        but until now the set just quietly said "4 questions" and the learner had
                        no way to tell it apart from having asked for 4. */}
                    {setRow.generated_count > 0 && setRow.generated_count < setRow.requested_count && (
                      <span className="text-xs text-content-tertiary">
                        {t('home.fewerThanAsked', { requested: setRow.requested_count })}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void take(setRow)}
                  disabled={busy === setRow.id || setRow.generated_count === 0}
                  className="px-3 py-1.5 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover disabled:opacity-50 shrink-0"
                >
                  {busy === setRow.id ? t('home.starting') : t('home.take')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-content-tertiary text-center">
      </p>
    </div>
  )
}
