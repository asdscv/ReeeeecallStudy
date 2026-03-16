import { useTranslation } from 'react-i18next'
import type { SessionSummaryType } from '../../lib/study-summary-type'
import type { Card, CardTemplate } from '../../types/database'

interface CrammingSummaryStats {
  totalCards: number
  cardsStudied: number
  ratings: Record<string, number>
  totalDurationMs: number
}

interface CrammingMeta {
  rounds: number
  masteryPercentage: number
  allMastered: boolean
  hardestCards: { cardId: string; missedCount: number }[]
}

interface CrammingSummaryProps {
  stats: CrammingSummaryStats
  crammingMeta: CrammingMeta
  cards: Card[]
  template: CardTemplate | null
  summaryType?: SessionSummaryType
  onBackToDeck: () => void
  onCrammingAgain: () => void
  onOtherMode: () => void
}

export function CrammingSummary({
  stats,
  crammingMeta,
  cards,
  template,
  summaryType = 'complete',
  onBackToDeck,
  onCrammingAgain,
  onOtherMode,
}: CrammingSummaryProps) {
  const { t } = useTranslation('study')
  const minutes = Math.floor(stats.totalDurationMs / 60000)
  const seconds = Math.floor((stats.totalDurationMs % 60000) / 1000)

  const isPartial = summaryType === 'partial'
  const cardMap = new Map(cards.map(c => [c.id, c]))

  // Get front text from card for hardest cards display
  const getFrontText = (cardId: string): string => {
    const card = cardMap.get(cardId)
    if (!card || !template) return cardId.slice(0, 8)
    const frontField = template.front_layout?.[0]?.field_key
    if (frontField && card.field_values[frontField]) {
      const text = card.field_values[frontField]
      return text.length > 40 ? text.slice(0, 40) + '...' : text
    }
    const firstValue = Object.values(card.field_values)[0]
    if (typeof firstValue === 'string') {
      return firstValue.length > 40 ? firstValue.slice(0, 40) + '...' : firstValue
    }
    return cardId.slice(0, 8)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full mx-auto px-4 sm:px-6 text-center">
        <div className="text-4xl sm:text-5xl mb-4 sm:mb-6">{isPartial ? '\uD83D\uDCCA' : '\u26A1'}</div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">
          {isPartial
            ? t('cramming.summary.sessionEnded')
            : crammingMeta.allMastered
              ? t('cramming.summary.completed')
              : t('cramming.summary.timeUp')}
        </h1>
        <p className="text-gray-500 mb-6 sm:mb-8">{t('cramming.summary.wellDone')}</p>

        <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 mb-4 space-y-3 sm:space-y-4">
          <StatRow
            label={t('cramming.summary.totalRounds')}
            value={String(crammingMeta.rounds)}
          />
          <StatRow
            label={t('cramming.summary.masteryRate')}
            value={`${crammingMeta.masteryPercentage}%`}
            highlight={crammingMeta.masteryPercentage >= 80}
          />
          <StatRow
            label={t('cramming.summary.cardsStudied')}
            value={String(stats.cardsStudied)}
          />
          <StatRow
            label={t('summary.timeSpent')}
            value={t('summary.timeFormat', { minutes, seconds })}
          />

          {/* Rating distribution */}
          {Object.keys(stats.ratings).length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <p className="text-sm text-gray-400 mb-2">{t('summary.ratingDistribution')}</p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                {stats.ratings.got_it != null && stats.ratings.got_it > 0 && (
                  <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-50 text-green-700">
                    {t('cramming.gotIt')} {stats.ratings.got_it}
                  </span>
                )}
                {stats.ratings.missed != null && stats.ratings.missed > 0 && (
                  <span className="px-3 py-1 rounded-full text-sm font-medium bg-red-50 text-red-700">
                    {t('cramming.missed')} {stats.ratings.missed}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Hardest cards */}
          {crammingMeta.hardestCards.length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <p className="text-sm text-gray-400 mb-2">{t('cramming.summary.hardestCards')}</p>
              <div className="space-y-1.5">
                {crammingMeta.hardestCards.map((hc) => (
                  <div key={hc.cardId} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate flex-1 text-left">
                      {getFrontText(hc.cardId)}
                    </span>
                    <span className="text-red-600 font-medium ml-2 whitespace-nowrap">
                      {t('cramming.summary.missedTimes', { count: hc.missedCount })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SRS safety notice */}
        <p className="text-xs text-gray-400 mb-6">
          {t('cramming.summary.noSrsImpact')}
        </p>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            onClick={onBackToDeck}
            className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-xl font-medium transition cursor-pointer text-sm sm:text-base"
          >
            {t('summary.backToDeck')}
          </button>
          <button
            onClick={onCrammingAgain}
            className="flex-1 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium transition cursor-pointer text-sm sm:text-base"
          >
            {t('cramming.summary.crammingAgain')}
          </button>
          <button
            onClick={onOtherMode}
            className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition cursor-pointer text-sm sm:text-base"
          >
            {t('cramming.summary.otherMode')}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500 text-sm">{label}</span>
      <span className={`font-medium ${highlight ? 'text-green-600' : 'text-gray-900'}`}>
        {value}
      </span>
    </div>
  )
}
