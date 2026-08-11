import { useTranslation } from 'react-i18next'
import { TIME_PERIOD_OPTIONS, toDateKey, type DateRange, type TimePeriod } from '../../lib/time-period'

interface TimePeriodTabsProps {
  value: TimePeriod
  onChange: (period: TimePeriod) => void
  /**
   * Opt-in. A screen that can act on an arbitrary window passes these and gets the extra
   * chip plus two date fields; the dashboard and the deck page pass nothing and are
   * unchanged, because a picker they cannot honour would be a dead control.
   */
  range?: DateRange | null
  onRangeChange?: (range: DateRange) => void
}

export function TimePeriodTabs({ value, onChange, range, onRangeChange }: TimePeriodTabsProps) {
  const { t } = useTranslation('common')
  const supportsRange = typeof onRangeChange === 'function'
  // Today, so the pickers cannot ask for study that has not happened yet.
  const today = toDateKey(new Date())
  const from = range?.from ?? ''
  const to = range?.to ?? ''

  return (
    <div className="space-y-2">
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex rounded-lg border border-border overflow-hidden w-max">
        {TIME_PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium transition cursor-pointer whitespace-nowrap ${
              value === opt.value
                ? 'bg-brand text-white'
                : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {t(`timePeriod.${opt.value}`)}
          </button>
        ))}
        {supportsRange && (
          <button
            type="button"
            onClick={() => {
              // Seed the fields with the window currently on screen, so choosing 직접 선택
              // does not blank the charts and make the learner type two dates before seeing
              // anything.
              if (!range) {
                const start = new Date()
                start.setDate(start.getDate() - 29)
                onRangeChange?.({ from: toDateKey(start), to: today })
              }
              onChange('custom')
            }}
            className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium transition cursor-pointer whitespace-nowrap border-l border-border ${
              value === 'custom'
                ? 'bg-brand text-white'
                : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {t('timePeriod.custom')}
          </button>
        )}
      </div>
    </div>

    {supportsRange && value === 'custom' && (
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-content-tertiary">
          {t('timePeriod.from')}
          <input
            type="date"
            value={from}
            max={to || today}
            onChange={(e) => onRangeChange?.({ from: e.target.value, to })}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-content-tertiary">
          {t('timePeriod.to')}
          <input
            type="date"
            value={to}
            min={from || undefined}
            max={today}
            onChange={(e) => onRangeChange?.({ from, to: e.target.value })}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
          />
        </label>
      </div>
    )}
    </div>
  )
}
