import { useTranslation } from 'react-i18next'
import type { SessionSummaryType } from '../../lib/study-summary-type'

interface StudySummaryProps {
  stats: {
    totalCards: number
    cardsStudied: number
    ratings: Record<string, number>
    totalDurationMs: number
  }
  summaryType?: SessionSummaryType
  onBackToDeck: () => void
  onStudyAgain: () => void
}

export function StudySummary({ stats, summaryType = 'complete', onBackToDeck, onStudyAgain }: StudySummaryProps) {
  const { t } = useTranslation('study')
  const minutes = Math.floor(stats.totalDurationMs / 60000)
  const seconds = Math.floor((stats.totalDurationMs % 60000) / 1000)
  const avgMs = stats.cardsStudied > 0
    ? Math.round(stats.totalDurationMs / stats.cardsStudied / 1000)
    : 0

  const isPartial = summaryType === 'partial'

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-md w-full mx-auto px-4 sm:px-6 text-center">
        <div className="text-4xl sm:text-5xl mb-4 sm:mb-6">{isPartial ? '\uD83D\uDCCA' : '\uD83C\uDF89'}</div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">
          {isPartial ? t('summary.sessionEnded') : t('summary.completed')}
        </h1>
        <p className="text-muted-foreground mb-6 sm:mb-8">
          {isPartial ? t('summary.progressSoFar') : t('summary.wellDone')}
        </p>

        <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 mb-6 sm:mb-8 space-y-3 sm:space-y-4">
          <StatRow label={t('summary.cardsStudied')} value={t('summary.cardCount', { studied: stats.cardsStudied, total: stats.totalCards })} />
          <StatRow label={t('summary.timeSpent')} value={t('summary.timeFormat', { minutes, seconds })} />
          <StatRow label={t('summary.avgPerCard')} value={t('summary.secondsFormat', { seconds: avgMs })} />

          {Object.keys(stats.ratings).length > 0 && (
            <div className="pt-3 border-t border-border">
              <p className="text-sm text-content-tertiary mb-2">{t('summary.ratingDistribution')}</p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                {Object.entries(stats.ratings).map(([rating, count]) => (
                  <span
                    key={rating}
                    className={`px-3 py-1 rounded-full text-sm font-medium ${ratingColor(rating)}`}
                  >
                    {ratingLabel(rating, t)} {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            onClick={onBackToDeck}
            className="flex-1 px-4 py-3 bg-card border border-border text-foreground hover:bg-muted rounded-xl font-medium transition cursor-pointer text-sm sm:text-base"
          >
            {t('summary.backToDeck')}
          </button>
          <button
            onClick={onStudyAgain}
            className="flex-1 px-4 py-3 bg-brand hover:bg-brand text-white rounded-xl font-medium transition cursor-pointer text-sm sm:text-base"
          >
            {t('summary.studyAgain')}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  )
}

function ratingLabel(rating: string, t: (key: string) => string): string {
  const map: Record<string, string> = {
    again: t('srsRating.again'),
    hard: t('srsRating.hard'),
    good: t('srsRating.good'),
    easy: t('srsRating.easy'),
    known: t('rating.known'),
    unknown: t('rating.unknown'),
    next: t('rating.next'),
    got_it: t('cramming.gotIt'),
    missed: t('cramming.missed'),
  }
  return map[rating] ?? rating
}

function ratingColor(rating: string): string {
  const map: Record<string, string> = {
    again: 'bg-destructive/10 text-destructive',
    hard: 'bg-warning/10 text-warning',
    good: 'bg-brand/10 text-brand',
    easy: 'bg-success/10 text-success',
    known: 'bg-success/10 text-success',
    unknown: 'bg-destructive/10 text-destructive',
    next: 'bg-accent text-foreground',
    got_it: 'bg-success/10 text-success',
    missed: 'bg-destructive/10 text-destructive',
  }
  return map[rating] ?? 'bg-accent text-foreground'
}
