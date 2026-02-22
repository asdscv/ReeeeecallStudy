import { useTranslation } from 'react-i18next'
import type { StudyMode } from '../../types/database'
import type { CrammingFilter } from '../../lib/cramming-queue'

interface NoCardsDueProps {
  mode: StudyMode
  crammingFilter?: CrammingFilter
  onBackToDeck: () => void
  onOtherMode: () => void
}

function getContent(mode: StudyMode, crammingFilter?: CrammingFilter) {
  if (mode === 'srs') {
    return { emoji: '\u2705', titleKey: 'noCards.srs.title', messageKey: 'noCards.srs.message' }
  }
  if (mode === 'cramming' && crammingFilter?.type === 'weak') {
    return { emoji: '\uD83D\uDCAA', titleKey: 'noCards.cramming.weakTitle', messageKey: 'noCards.cramming.weakMessage' }
  }
  if (mode === 'cramming' && crammingFilter?.type === 'due_soon') {
    return { emoji: '\u2705', titleKey: 'noCards.cramming.dueSoonTitle', messageKey: 'noCards.cramming.dueSoonMessage' }
  }
  return { emoji: '\uD83D\uDCDA', titleKey: 'noCards.generic.title', messageKey: 'noCards.generic.message' }
}

export function NoCardsDue({ mode, crammingFilter, onBackToDeck, onOtherMode }: NoCardsDueProps) {
  const { t } = useTranslation('study')
  const { emoji, titleKey, messageKey } = getContent(mode, crammingFilter)

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full mx-auto px-4 sm:px-6 text-center">
        <div className="text-4xl sm:text-5xl mb-4 sm:mb-6">{emoji}</div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">{t(titleKey)}</h1>
        <p className="text-gray-500 mb-6 sm:mb-8">{t(messageKey)}</p>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            onClick={onBackToDeck}
            className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-xl font-medium transition cursor-pointer text-sm sm:text-base"
          >
            {t('summary.backToDeck')}
          </button>
          <button
            onClick={onOtherMode}
            className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition cursor-pointer text-sm sm:text-base"
          >
            {t('noCards.otherMode')}
          </button>
        </div>
      </div>
    </div>
  )
}
