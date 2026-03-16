import { useTranslation } from 'react-i18next'

interface CrammingRatingButtonsProps {
  onRate: (rating: string) => void
}

export function CrammingRatingButtons({ onRate }: CrammingRatingButtonsProps) {
  const { t } = useTranslation('study')
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => { navigator.vibrate?.(10); onRate('missed') }}
        className="flex-1 px-4 sm:px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 active:scale-95 text-white font-medium transition-all cursor-pointer"
      >
        {t('cramming.missed')}
      </button>
      <button
        onClick={() => { navigator.vibrate?.(10); onRate('got_it') }}
        className="flex-1 px-4 sm:px-6 py-3 rounded-xl bg-green-600 hover:bg-green-700 active:bg-green-800 active:scale-95 text-white font-medium transition-all cursor-pointer"
      >
        {t('cramming.gotIt')}
      </button>
    </div>
  )
}
