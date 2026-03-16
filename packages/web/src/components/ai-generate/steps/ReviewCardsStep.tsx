import { useTranslation } from 'react-i18next'
import type { GeneratedCard, GeneratedTemplateField } from '../../../lib/ai/types'

interface ReviewCardsStepProps {
  cards: GeneratedCard[]
  fields: GeneratedTemplateField[]
  filteredCount: number
  onChange: (cards: GeneratedCard[]) => void
  onRemove: (index: number) => void
  onSave: () => void
}

export function ReviewCardsStep({ cards, fields, filteredCount, onChange, onRemove, onSave }: ReviewCardsStepProps) {
  const { t } = useTranslation('ai-generate')

  const updateCardField = (cardIndex: number, fieldKey: string, value: string) => {
    const updated = [...cards]
    updated[cardIndex] = {
      ...updated[cardIndex],
      field_values: { ...updated[cardIndex].field_values, [fieldKey]: value },
    }
    onChange(updated)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">
          {t('review.cardsTitle', { count: cards.length })}
        </h4>
        {filteredCount > 0 && (
          <span className="text-xs text-amber-600">
            {t('review.filteredWarning', { count: filteredCount })}
          </span>
        )}
      </div>

      {/* Cards table */}
      <div className="max-h-[400px] overflow-y-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr className="border-b border-gray-200">
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-8">#</th>
              {fields.map((f) => (
                <th key={f.key} className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                  {f.name}
                </th>
              ))}
              <th className="px-3 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {cards.map((card, i) => (
              <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                {fields.map((f) => (
                  <td key={f.key} className="px-3 py-1">
                    <input
                      type="text"
                      value={card.field_values[f.key] || ''}
                      onChange={(e) => updateCardField(i, f.key, e.target.value)}
                      className="w-full px-1.5 py-1 text-sm border border-transparent hover:border-gray-200 focus:border-blue-500 rounded outline-none"
                    />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    className="text-red-400 hover:text-red-600 cursor-pointer text-xs"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={cards.length === 0}
        className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer disabled:opacity-50"
      >
        {t('review.save', { count: cards.length })}
      </button>
    </div>
  )
}
