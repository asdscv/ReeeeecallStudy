import { useTranslation } from 'react-i18next'
import type { StudyMode } from '../../types/database'

interface SimpleRatingButtonsProps {
  mode: StudyMode
  onRate: (rating: string) => void
}

export function SimpleRatingButtons({ mode: _mode, onRate }: SimpleRatingButtonsProps) {
  const { t } = useTranslation('study')
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => { navigator.vibrate?.(10); onRate('unknown') }}
        className="flex-1 px-4 sm:px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 active:scale-95 text-white font-medium transition-all cursor-pointer"
      >
        {t('rating.unknown')}
      </button>
      <button
        onClick={() => { navigator.vibrate?.(10); onRate('known') }}
        className="flex-1 px-4 sm:px-6 py-3 rounded-xl bg-green-600 hover:bg-green-700 active:bg-green-800 active:scale-95 text-white font-medium transition-all cursor-pointer"
      >
        {t('rating.known')}
      </button>
    </div>
  )
}
