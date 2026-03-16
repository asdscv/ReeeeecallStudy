import { useTranslation } from 'react-i18next'
import { getStudyModeLabel, getStudyModeEmoji, formatDuration } from '../../lib/study-history'
import type { ModeBreakdown, StudyTimeByMode } from '../../lib/study-history-stats'

interface ModeBreakdownCardsProps {
  breakdown: ModeBreakdown[]
  timeByMode: StudyTimeByMode[]
}

export function ModeBreakdownCards({ breakdown, timeByMode }: ModeBreakdownCardsProps) {
  const { t } = useTranslation('history')
  const timeMap = new Map(timeByMode.map((tm) => [tm.mode, tm]))

  if (breakdown.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-3">{t('charts.modeBreakdown')}</h3>
        <p className="text-sm text-gray-400 py-8 text-center">{t('charts.noModeData')}</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{t('charts.modeBreakdown')}</h3>
      <div className="space-y-3">
        {breakdown.map((item) => {
          const time = timeMap.get(item.mode)
          return (
            <div key={item.mode} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
              <span className="text-xl shrink-0">{getStudyModeEmoji(item.mode)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {getStudyModeLabel(item.mode)}
                  </span>
                  <span className="text-xs text-gray-400">{t('charts.sessionCountLabel', { count: item.sessionCount })}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span>{t('charts.cardCountLabel', { count: item.totalCards })}</span>
                  <span>{formatDuration(item.totalTimeMs)}</span>
                  {time && <span className="text-gray-400">{time.percentage}%</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-lg font-bold text-gray-900">{item.avgPerformance}%</div>
                <div className="text-[10px] text-gray-400">{t('charts.performance')}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
