import { useState } from 'react'
import { X } from 'lucide-react'
import { useMarketplaceStore } from '../../stores/marketplace-store'
import { MARKETPLACE_CATEGORIES } from '../../lib/marketplace'
import type { ShareMode } from '../../types/database'

interface PublishModalProps {
  open: boolean
  onClose: () => void
  deckId: string
  deckName: string
}

export function PublishModal({ open, onClose, deckId, deckName }: PublishModalProps) {
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
          <h3 className="text-lg font-semibold text-gray-900">마켓에 게시</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
            >
              {MARKETPLACE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">태그 (쉼표로 구분)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="english, toeic, vocabulary"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">공유 모드</label>
            <select
              value={shareMode}
              onChange={(e) => setShareMode(e.target.value as ShareMode)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
            >
              <option value="copy">복사 (독립적인 복사본)</option>
              <option value="subscribe">구독 (원본 연동, 진도 별도)</option>
              <option value="snapshot">스냅샷 (읽기 전용 복사)</option>
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading || !title.trim()}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer"
          >
            {loading ? '게시 중...' : '마켓에 게시'}
          </button>
        </form>
      </div>
    </div>
  )
}
