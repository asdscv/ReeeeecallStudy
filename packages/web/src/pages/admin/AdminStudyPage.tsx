import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminStore } from '../../stores/admin-store'
import { DailyActivityChart } from '../../components/admin/DailyActivityChart'
import { ModeUsagePieChart } from '../../components/admin/ModeUsagePieChart'
import { RatingDistributionChart } from '../../components/admin/RatingDistributionChart'
import { AdminErrorState } from '../../components/admin/AdminErrorState'
import { fillDailyActivityGaps, computeModeUsagePercentages, computeModeEffectiveness, formatStatNumber, srsStatusLabel, studyModeLabel } from '../../lib/admin-stats'

const PERIOD_OPTIONS = [7, 14, 30, 90] as const

const SRS_COLORS: Record<string, string> = {
  new: '#3b82f6',
  learning: '#f59e0b',
  review: '#10b981',
  suspended: '#6b7280',
}

export function AdminStudyPage() {
  const { t } = useTranslation('admin')
  const {
    dailyActivity, modeBreakdown, ratingDistribution, srsBreakdown,
    studyLoading, studyError, fetchStudyActivity,
  } = useAdminStore()
  const [days, setDays] = useState<number>(30)
  const filledActivity = useMemo(() => fillDailyActivityGaps(dailyActivity, days), [dailyActivity, days])
  const modePercentages = useMemo(() => computeModeUsagePercentages(modeBreakdown), [modeBreakdown])
  const modeEffectiveness = useMemo(() => computeModeEffectiveness(modeBreakdown), [modeBreakdown])
  const totalCards = useMemo(() => srsBreakdown.reduce((s, b) => s + b.count, 0), [srsBreakdown])

  useEffect(() => {
    fetchStudyActivity(days)
  }, [fetchStudyActivity, days])

  if (studyError) {
    return <AdminErrorState error={studyError} onRetry={() => fetchStudyActivity(days)} />
  }

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t('study.period')}:</span>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={days === p}
              onClick={() => setDays(p)}
              className={`px-3 py-1 text-xs rounded-full border transition cursor-pointer ${
                days === p
                  ? 'bg-brand text-white border-brand'
                  : 'bg-card text-muted-foreground border-border hover:border-border'
              }`}
            >
              {t('study.periodDay', { count: p })}
            </button>
          ))}
        </div>
      </div>

      {studyLoading && dailyActivity.length === 0 ? (
        <p className="text-sm text-content-tertiary py-8 text-center">{t('loading')}</p>
      ) : (
        <>
          {/* Daily activity charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <DailyActivityChart data={filledActivity} dataKey="sessions" title={t('study.dailySessions')} />
            <DailyActivityChart data={filledActivity} dataKey="cards" title={t('study.dailyCards')} />
            <DailyActivityChart data={filledActivity} dataKey="total_duration_ms" title={t('study.dailyDuration')} />
          </div>

          {/* SRS Status Breakdown */}
          {srsBreakdown.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-4">
              <h3 className="text-sm font-medium text-foreground mb-3">{t('study.srsBreakdown')}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {srsBreakdown.map((s) => (
                  <div key={s.status} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: SRS_COLORS[s.status] ?? '#6b7280' }}
                    />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{t(srsStatusLabel(s.status), s.status)}</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatStatNumber(s.count)}
                        {totalCards > 0 && (
                          <span className="text-xs font-normal text-content-tertiary ml-1">
                            ({Math.round((s.count / totalCards) * 100)}%)
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mode usage + Rating distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ModeUsagePieChart data={modePercentages} />
            <RatingDistributionChart data={ratingDistribution} />
          </div>

          {/* Mode Effectiveness Table */}
          {modeEffectiveness.length > 0 && (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-medium text-foreground">{t('study.modeEffectiveness')}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t('study.mode')}</th>
                      <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">{t('study.sessions')}</th>
                      <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">{t('study.avgCardsPerSession')}</th>
                      <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">{t('study.avgDurationPerSession')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {modeEffectiveness.map((m) => (
                      <tr key={m.mode} className="hover:bg-muted">
                        <td className="px-4 py-2 text-foreground font-medium">{t(studyModeLabel(m.mode), m.mode)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{formatStatNumber(m.session_count)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{formatStatNumber(m.avgCardsPerSession)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{t('study.minuteShort', { value: m.avgDurationMin })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
