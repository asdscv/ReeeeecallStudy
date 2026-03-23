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
      <div className="bg-card rounded-xl border border-border p-3 sm:p-5">
        <h3 className="text-sm font-medium text-foreground mb-3">{t('charts.modeBreakdown')}</h3>
        <p className="text-sm text-content-tertiary py-8 text-center">{t('charts.noModeData')}</p>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-xl border border-border p-3 sm:p-5">
      <h3 className="text-sm font-medium text-foreground mb-3">{t('charts.modeBreakdown')}</h3>
      <div className="space-y-3">
        {breakdown.map((item) => {
          const time = timeMap.get(item.mode)
          return (
            <div key={item.mode} className="flex items-center gap-3 p-2 rounded-lg bg-muted">
              <span className="text-xl shrink-0">{getStudyModeEmoji(item.mode)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {getStudyModeLabel(item.mode)}
                  </span>
                  <span className="text-xs text-content-tertiary">{t('charts.sessionCountLabel', { count: item.sessionCount })}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{t('charts.cardCountLabel', { count: item.totalCards })}</span>
                  <span>{formatDuration(item.totalTimeMs)}</span>
                  {time && <span className="text-content-tertiary">{time.percentage}%</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-lg font-bold text-foreground">{item.avgPerformance}%</div>
                <div className="text-[10px] text-content-tertiary">{t('charts.performance')}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
