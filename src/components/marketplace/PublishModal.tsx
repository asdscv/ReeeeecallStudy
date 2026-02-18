import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useMarketplaceStore } from '../../stores/marketplace-store'
import { MARKETPLACE_CATEGORIES } from '../../lib/marketplace'
import type { ShareMode } from '../../types/database'

const PUBLISH_SHARE_MODES: { value: ShareMode; label: string; desc: string; detail: string }[] = [
  { value: 'copy', label: 'sharing:shareModes.copy.label', desc: 'sharing:shareModes.copy.desc', detail: 'sharing:shareModes.copy.detail' },
  { value: 'subscribe', label: 'sharing:shareModes.subscribe.label', desc: 'sharing:shareModes.subscribe.desc', detail: 'sharing:shareModes.subscribe.detail' },
  { value: 'snapshot', label: 'sharing:shareModes.snapshot.label', desc: 'sharing:shareModes.snapshot.desc', detail: 'sharing:shareModes.snapshot.detail' },
]

interface PublishModalProps {
  open: boolean
  onClose: () => void
  deckId: string
  deckName: string
}

export function PublishModal({ open, onClose, deckId, deckName }: PublishModalProps) {
  const { t } = useTranslation(['sharing', 'marketplace', 'common'])
  const { publishDeck, error } = useMarketplaceStore()
  const [title, setTitle] = useState(deckName)
  const [description, setDescription] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [category, setCategory] = useState('general')
  const [shareMode, setShareMode] = useState<ShareMode>('copy')
  const [loading, setLoading] = useState(false)

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setLoading(true)
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
    await publishDeck({
      deckId,
      title: title.trim(),
      description: description.trim() || undefined,
      tags,
      category,
      shareMode,
    })
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">{t('sharing:publish.title')}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('sharing:publish.titleLabel')}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('sharing:publish.description')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('sharing:publish.category')}</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
            >
              {MARKETPLACE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('sharing:publish.tags')}</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder={t('sharing:publish.tagsPlaceholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('sharing:publish.shareMode')}</label>
            <div className="space-y-2">
              {PUBLISH_SHARE_MODES.map((m) => (
                <label
                  key={m.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                    shareMode === m.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="publishShareMode"
                    value={m.value}
                    checked={shareMode === m.value}
                    onChange={() => setShareMode(m.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{t(m.label)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{t(m.desc)}</div>
                    <div className="text-xs text-gray-400 mt-1 leading-relaxed">{t(m.detail)}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading || !title.trim()}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer"
          >
            {loading ? t('sharing:publish.publishing') : t('sharing:publish.submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
