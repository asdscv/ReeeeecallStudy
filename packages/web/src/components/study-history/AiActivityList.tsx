import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuizStore, isDailyCheckTitle, type AiActivityEntry } from '@reeeeecall/shared/stores/quiz-store'
import { dateLine, tallyFromCounts, tallyLine } from '@reeeeecall/shared/lib/quiz-outcome'
import { formatUsdMicro } from '@reeeeecall/shared/lib/ai/server-client'

/**
 * What the learner did through AI, on the screen that answers "what have I been doing".
 *
 * 기록 read `study_sessions` and `study_logs` and nothing else, so an afternoon of generating a
 * deck, sitting three quizzes and paying for six gradings showed as an empty day — every act in
 * the part of the app that costs money was missing from the only record of it.
 *
 * Quiz sittings and generation jobs are ONE timeline because they happened in one afternoon. The
 * tally comes from `_quiz_run_tally` and is phrased by `tallyLine`, the same function the run and
 * result screens use, so a sitting cannot read one way here and another there.
 */
export function AiActivityList({ limit = 30 }: { limit?: number }) {
  const { t } = useTranslation('quiz')
  const { loadAiActivity } = useQuizStore()
  const [entries, setEntries] = useState<AiActivityEntry[] | null>(null)

  useEffect(() => {
    let live = true
    void loadAiActivity(limit)
      .then((rows) => { if (live) setEntries(rows) })
      .catch(() => { if (live) setEntries([]) })
    return () => { live = false }
  }, [loadAiActivity, limit])

  // Nothing yet, or nothing ever: either way there is no section to show. A learner who has
  // never used AI should not be handed an empty box about it.
  if (!entries || entries.length === 0) return null

  return (
    <section className="space-y-2" data-testid="ai-activity">
      <h2 className="text-sm font-medium text-foreground">{t('activity.title')}</h2>
      <ul className="space-y-2">
        {entries.map((e) => {
          const at = dateLine(e.at)
          const cost = e.price_micro > 0 ? formatUsdMicro(e.price_micro) : null
          return (
            <li key={`${e.kind}-${e.id}`} className="p-3 bg-card rounded-lg border border-border">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {e.kind === 'quiz' ? (
                    <>
                      <p className="text-sm text-foreground truncate">
                        {t('activity.quiz', {
                          title: isDailyCheckTitle(e.title ?? '')
                            ? t('home.dailyCheckTitle') : e.title,
                          n: e.attempt_no ?? 1,
                        })}
                      </p>
                      <p className="text-xs text-content-tertiary mt-0.5">
                        {(() => {
                          const line = tallyLine(tallyFromCounts(e.tally))
                          return t(line.key, line.params)
                        })()}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-foreground truncate">
                        {/* The action in the learner's words. `quiz_action` is finer than
                            `job_kind` for grading — "주관식 채점" rather than "AI 퀴즈". */}
                        {t(`activity.job.${e.quiz_action ?? e.job_kind}`, {
                          defaultValue: t(`activity.job.${e.job_kind}`, { defaultValue: e.job_kind ?? '' }),
                        })}
                      </p>
                      {(e.cards ?? 0) > 0 && (
                        <p className="text-xs text-content-tertiary mt-0.5">
                          {t('home.questions', { count: e.cards })}
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {at && <p className="text-xs text-content-tertiary">{t(at.key, at.params)}</p>}
                  {/* "무료" is information, not an absence — but only worth saying on a job the
                      learner might have expected to pay for. */}
                  {e.kind === 'ai_gen' && (
                    <p className="text-xs text-content-tertiary mt-0.5">
                      {e.refunded ? t('activity.refunded') : (cost ?? t('activity.free'))}
                    </p>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
