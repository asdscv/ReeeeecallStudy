import { useTranslation } from 'react-i18next'
import type { CrammingFilter } from '../../lib/cramming-queue'

interface CrammingSetupPanelProps {
  filter: CrammingFilter
  onFilterChange: (filter: CrammingFilter) => void
  timeLimitMinutes: number | null
  onTimeLimitChange: (minutes: number | null) => void
  shuffle: boolean
  onShuffleChange: (shuffle: boolean) => void
}

const TIME_PRESETS = [null, 15, 30, 60] as const

export function CrammingSetupPanel({
  filter,
  onFilterChange,
  timeLimitMinutes,
  onTimeLimitChange,
  shuffle,
  onShuffleChange,
}: CrammingSetupPanelProps) {
  const { t } = useTranslation('study')

  return (
    <div className="space-y-6">
      {/* Card Filter */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('cramming.filter.title')}
        </label>
        <div className="space-y-2">
          <FilterOption
            selected={filter.type === 'all'}
            onClick={() => onFilterChange({ type: 'all' })}
            label={t('cramming.filter.all')}
            desc={t('cramming.filter.allDesc')}
          />
          <FilterOption
            selected={filter.type === 'weak'}
            onClick={() => onFilterChange({ type: 'weak', maxEaseFactor: 2.0 })}
            label={t('cramming.filter.weak')}
            desc={t('cramming.filter.weakDesc')}
          />
          <FilterOption
            selected={filter.type === 'due_soon'}
            onClick={() => onFilterChange({ type: 'due_soon', withinDays: 3 })}
            label={t('cramming.filter.dueSoon')}
            desc={t('cramming.filter.dueSoonDesc')}
          />
        </div>
      </div>

      {/* Time Limit */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('cramming.timeLimit.title')}
        </label>
        <div className="flex flex-wrap gap-2">
          {TIME_PRESETS.map((preset) => (
            <button
              key={preset ?? 'none'}
              type="button"
              onClick={() => onTimeLimitChange(preset)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition cursor-pointer ${
                timeLimitMinutes === preset
                  ? 'bg-purple-100 text-purple-700 border-2 border-purple-500'
                  : 'bg-gray-100 text-gray-700 border-2 border-transparent hover:border-gray-300'
              }`}
            >
              {preset == null
                ? t('cramming.timeLimit.none')
                : t('cramming.timeLimit.minutes', { count: preset })}
            </button>
          ))}
        </div>
      </div>

      {/* Shuffle Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">{t('cramming.shuffle.title')}</p>
          <p className="text-xs text-gray-500">{t('cramming.shuffle.desc')}</p>
        </div>
        <button
          type="button"
          onClick={() => onShuffleChange(!shuffle)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
            shuffle ? 'bg-purple-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              shuffle ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  )
}

function FilterOption({
  selected,
  onClick,
  label,
  desc,
}: {
  selected: boolean
  onClick: () => void
  label: string
  desc: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl border-2 transition-all cursor-pointer ${
        selected
          ? 'border-purple-500 bg-purple-50'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="font-medium text-gray-900 text-sm">{label}</div>
      <div className="text-xs text-gray-500">{desc}</div>
    </button>
  )
}
