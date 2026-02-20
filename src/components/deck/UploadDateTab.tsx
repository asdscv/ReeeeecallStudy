import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '../../lib/locale-utils'
import type { Card, CardTemplate } from '../../types/database'
import { groupCardsByDate } from '../../lib/stats'
import { utcToLocalDateKey, formatLocalTime } from '../../lib/date-utils'

interface UploadDateTabProps {
  cards: Card[]
  template: CardTemplate | null
  onEditCard: (card: Card) => void
}

export function UploadDateTab({ cards, template, onEditCard }: UploadDateTabProps) {
  const { t, i18n } = useTranslation('decks')
  const dateLocale = toIntlLocale(i18n.language)
  const groups = groupCardsByDate(cards)
  const displayFields = template?.fields.slice(0, 2) ?? []

  if (cards.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
        {t('uploadDate.noCards')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map(({ date, count }) => {
        const dateCards = cards.filter((c) => utcToLocalDateKey(c.created_at) === date)

        return (
          <div key={date} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">{date}</span>
              <span className="text-xs text-gray-400">{t('uploadDate.cardCount', { count })}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {dateCards.map((card) => (
                <div
                  key={card.id}
                  className="px-4 py-3 hover:bg-gray-50 cursor-pointer flex items-center gap-4"
                  onClick={() => onEditCard(card)}
                >
                  {displayFields.map((field) => (
                    <span key={field.key} className="text-sm text-gray-900 truncate flex-1">
                      {card.field_values[field.key] || '-'}
                    </span>
                  ))}
                  <span className="text-xs text-gray-400 shrink-0">
                    {formatLocalTime(card.created_at, dateLocale, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
