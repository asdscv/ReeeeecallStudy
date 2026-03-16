import { useTranslation } from 'react-i18next'
import type { GeneratedDeck } from '../../../lib/ai/types'

interface ReviewDeckStepProps {
  deck: GeneratedDeck
  onChange: (d: GeneratedDeck) => void
  onRegenerate: () => void
  onNext: () => void
}

const COLORS = [
  '#3B82F6', '#EF4444', '#22C55E', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#6B7280',
]

export function ReviewDeckStep({ deck, onChange, onRegenerate, onNext }: ReviewDeckStepProps) {
  const { t } = useTranslation('ai-generate')

  return (
    <div className="space-y-4">
      {/* Preview */}
      <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl">
        <span className="text-3xl">{deck.icon}</span>
        <div>
          <h3 className="font-semibold text-gray-900">{deck.name}</h3>
          <p className="text-sm text-gray-500">{deck.description}</p>
        </div>
        <div className="ml-auto w-6 h-6 rounded-full" style={{ backgroundColor: deck.color }} />
      </div>

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('review.deckName')}
        </label>
        <input
          type="text"
          value={deck.name}
          onChange={(e) => onChange({ ...deck, name: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:border-blue-500"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('review.deckDescription')}
        </label>
        <input
          type="text"
          value={deck.description}
          onChange={(e) => onChange({ ...deck, description: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:border-blue-500"
        />
      </div>

      {/* Icon */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('review.deckIcon')}
        </label>
        <input
          type="text"
          value={deck.icon}
          onChange={(e) => onChange({ ...deck, icon: e.target.value })}
          className="w-20 px-3 py-2 rounded-lg border border-gray-300 text-center text-lg outline-none focus:border-blue-500"
        />
      </div>

      {/* Color */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('review.deckColor')}
        </label>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...deck, color: c })}
              className={`w-8 h-8 rounded-full cursor-pointer transition ${
                deck.color === c ? 'ring-2 ring-offset-2 ring-blue-500' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRegenerate}
          className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
        >
          {t('review.regenerate')}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 cursor-pointer"
        >
          {t('review.next')}
        </button>
      </div>
    </div>
  )
}
