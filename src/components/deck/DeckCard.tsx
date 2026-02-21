import { useNavigate } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '../../lib/locale-utils'
import { formatRelativeTime } from '../../lib/date-utils'
import { ShareBadge } from '../sharing/ShareBadge'
import { useAuthStore } from '../../stores/auth-store'
import type { Deck } from '../../types/database'

interface DeckStats {
  total_cards: number
  new_cards: number
  review_cards: number
  learning_cards: number
  last_studied: string | null
}

interface DeckCardProps {
  deck: Deck
  stats?: DeckStats
  templateName?: string
  onDelete: (deck: Deck) => void
}

export function DeckCard({ deck, stats, templateName, onDelete }: DeckCardProps) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { t, i18n } = useTranslation('decks')
  const dateLocale = toIntlLocale(i18n.language)

  const totalCards = stats?.total_cards ?? 0
  const dueCards = (stats?.review_cards ?? 0) + (stats?.learning_cards ?? 0)
  const newCards = stats?.new_cards ?? 0

  const formatLastStudied = (dateStr: string | null) => {
    if (!dateStr) return t('card.noStudyRecord')
    return formatRelativeTime(dateStr, dateLocale)
  }

  const goToDetail = () => navigate(`/decks/${deck.id}`)

  return (
    <div
      className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-blue-300 hover:shadow-md transition relative flex cursor-pointer"
      onClick={goToDetail}
    >
      {/* Left color bar */}
      <div
        className="w-1 shrink-0 rounded-l-xl"
        style={{ backgroundColor: deck.color }}
      />

      <div className="flex-1 p-3 sm:p-5">
        {/* Header */}
        <div className="flex items-center gap-2 min-w-0 mb-2 sm:mb-3">
          <span className="text-xl sm:text-2xl shrink-0">{deck.icon}</span>
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">{deck.name}</h3>
          {user && <ShareBadge deck={deck} userId={user.id} />}
        </div>

        {/* Template */}
        {templateName ? (
          <p className="text-xs mb-1 text-gray-400">
            📋 {templateName}
          </p>
        ) : (
          <p className="text-xs mb-1 text-amber-500 flex items-center gap-1.5">
            <span>📋 {t('card.templateNotSet')}</span>
            <span
              role="link"
              onClick={(e) => { e.stopPropagation(); navigate(`/decks/${deck.id}/edit`) }}
              className="text-amber-600 underline underline-offset-2 hover:text-amber-700 cursor-pointer"
            >
              {t('card.goToSettings')}
            </span>
          </p>
        )}

        {/* Description */}
        {deck.description && (
          <p className="text-sm text-gray-500 mb-3 line-clamp-1">{deck.description}</p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm text-gray-500 mb-3 sm:mb-4">
          <span>{t('card.totalCards', { count: totalCards })}</span>
          {newCards > 0 && (
            <span className="text-blue-600">{t('card.newCards', { count: newCards })}</span>
          )}
          {dueCards > 0 && (
            <span className="text-amber-600">{t('card.review', { count: dueCards })}</span>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 sm:pt-4 border-t border-gray-100">
          <span className="text-xs text-gray-400 truncate mr-2">
            {formatLastStudied(stats?.last_studied ?? null)}
          </span>
          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => navigate(`/decks/${deck.id}/edit`)}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition cursor-pointer"
              title={t('card.edit')}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => onDelete(deck)}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition cursor-pointer"
              title={t('card.delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate(`/decks/${deck.id}/study/setup`)}
              className="px-3 sm:px-4 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition cursor-pointer"
            >
              {t('card.startStudy')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
