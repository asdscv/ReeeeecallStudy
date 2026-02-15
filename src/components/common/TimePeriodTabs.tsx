import { TIME_PERIOD_OPTIONS, type TimePeriod } from '../../lib/time-period'

interface TimePeriodTabsProps {
  value: TimePeriod
  onChange: (period: TimePeriod) => void
}

export function TimePeriodTabs({ value, onChange }: TimePeriodTabsProps) {
  return (
    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
      {TIME_PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium transition cursor-pointer ${
            value === opt.value
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
