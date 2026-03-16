import { useTranslation } from 'react-i18next'

interface CrammingProgressBarProps {
  round: number
  remainingInRound: number
  totalInRound: number
  masteryPct: number
  timeRemainingMs: number | null
}

export function CrammingProgressBar({
  round,
  remainingInRound,
  totalInRound,
  masteryPct,
  timeRemainingMs,
}: CrammingProgressBarProps) {
  const { t } = useTranslation('study')
  const progressInRound = totalInRound > 0
    ? Math.round(((totalInRound - remainingInRound) / totalInRound) * 100)
    : 0

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000)
    const min = Math.floor(totalSec / 60)
    const sec = totalSec % 60
    return `${min}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div className="flex items-center gap-2 sm:gap-3 flex-1">
      {/* Round badge */}
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-medium whitespace-nowrap">
        <span>⚡</span>
        {t('cramming.round', { round })}
      </span>

      {/* Progress bar */}
      <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-violet-500 transition-all duration-300"
          style={{ width: `${progressInRound}%` }}
        />
      </div>

      {/* Count */}
      <span className="text-xs font-medium text-gray-600 whitespace-nowrap">
        {totalInRound - remainingInRound}/{totalInRound}
      </span>

      {/* Divider */}
      <span className="text-gray-300">|</span>

      {/* Mastery */}
      <span className="text-xs font-medium text-purple-600 whitespace-nowrap">
        {t('cramming.mastery', { percentage: masteryPct })}
      </span>

      {/* Timer */}
      {timeRemainingMs != null && (
        <>
          <span className="text-gray-300">|</span>
          <span className={`text-xs font-medium whitespace-nowrap ${timeRemainingMs < 60000 ? 'text-red-600' : 'text-gray-600'}`}>
            ⏱ {formatTime(timeRemainingMs)}
          </span>
        </>
      )}
    </div>
  )
}
