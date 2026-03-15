import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Pencil, Plus } from 'lucide-react'

interface DoneStepProps {
  templateName?: string
  deckName?: string
  cardCount: number
  deckId: string | null
  templateId: string | null
  onAddMore: () => void
  onClose: () => void
}

export function DoneStep({
  templateName,
  deckName,
  cardCount,
  deckId,
  templateId,
  onAddMore,
  onClose,
}: DoneStepProps) {
  const { t } = useTranslation('ai-generate')
  const navigate = useNavigate()

  return (
    <div className="text-center space-y-6">
      {/* Success animation */}
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <span className="text-3xl">✓</span>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold text-gray-900">{t('done.title')}</h3>
        <p className="text-sm text-gray-500 mt-1">{t('done.subtitle')}</p>
      </div>

      {/* Summary cards */}
      <div className="flex justify-center gap-3">
        {templateName && (
          <div className="px-3 py-2 bg-purple-50 rounded-lg text-center">
            <p className="text-[10px] uppercase text-purple-500 font-semibold">{t('done.template')}</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">{templateName}</p>
          </div>
        )}
        {deckName && (
          <div className="px-3 py-2 bg-blue-50 rounded-lg text-center">
            <p className="text-[10px] uppercase text-blue-500 font-semibold">{t('done.deck')}</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">{deckName}</p>
          </div>
        )}
        <div className="px-3 py-2 bg-green-50 rounded-lg text-center">
          <p className="text-[10px] uppercase text-green-500 font-semibold">{t('done.cards')}</p>
          <p className="text-sm font-medium text-gray-900 mt-0.5">{cardCount}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-2 pt-2">
        {deckId && (
          <button
            type="button"
            onClick={() => { onClose(); navigate(`/decks/${deckId}`) }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
          >
            {t('done.viewDeck')}
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          {templateId && (
            <button
              type="button"
              onClick={() => { onClose(); navigate(`/templates/${templateId}/edit`) }}
              className="flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 rounded-xl text-xs font-medium hover:bg-gray-50 transition cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              {t('done.editTemplate')}
            </button>
          )}
          <button
            type="button"
            onClick={onAddMore}
            className="flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 rounded-xl text-xs font-medium hover:bg-gray-50 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('done.addMore')}
          </button>
        </div>
      </div>
    </div>
  )
}
