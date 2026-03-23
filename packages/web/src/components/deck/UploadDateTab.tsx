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
      <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
        {t('uploadDate.noCards')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map(({ date, count }) => {
        const dateCards = cards.filter((c) => utcToLocalDateKey(c.created_at) === date)

        return (
          <div key={date} className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 bg-muted border-b border-border flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{date}</span>
              <span className="text-xs text-content-tertiary">{t('uploadDate.cardCount', { count })}</span>
            </div>
            <div className="divide-y divide-border">
              {dateCards.map((card) => (
                <div
                  key={card.id}
                  className="px-4 py-3 hover:bg-muted cursor-pointer flex items-center gap-4"
                  onClick={() => onEditCard(card)}
                >
                  {displayFields.map((field) => (
                    <span key={field.key} className="text-sm text-foreground truncate flex-1">
                      {card.field_values[field.key] || '-'}
                    </span>
                  ))}
                  <span className="text-xs text-content-tertiary shrink-0">
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
