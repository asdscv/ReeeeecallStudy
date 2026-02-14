import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { useDeckStore } from '../../stores/deck-store'
import { DEFAULT_SRS_SETTINGS } from '../../types/database'
import type { Deck, SrsSettings } from '../../types/database'

const COLORS = [
  '#3B82F6', '#EF4444', '#22C55E', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#6B7280',
]

const ICONS = ['📚', '📖', '🇨🇳', '🇺🇸', '🇯🇵', '🧠', '💡', '📝']

const SRS_FIELDS: { key: keyof SrsSettings; label: string; color: string }[] = [
  { key: 'again_days', label: 'Again', color: 'text-red-500' },
  { key: 'hard_days', label: 'Hard', color: 'text-amber-500' },
  { key: 'good_days', label: 'Good', color: 'text-blue-500' },
  { key: 'easy_days', label: 'Easy', color: 'text-green-500' },
]

interface DeckFormModalProps {
  open: boolean
  onClose: () => void
  editDeck?: Deck | null
}

export function DeckFormModal({ open, onClose, editDeck }: DeckFormModalProps) {
  const { createDeck, updateDeck, templates } = useDeckStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [icon, setIcon] = useState(ICONS[0])
  const [templateId, setTemplateId] = useState('')
  const [srsSettings, setSrsSettings] = useState<SrsSettings>({ ...DEFAULT_SRS_SETTINGS })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (editDeck) {
      setName(editDeck.name)
      setDescription(editDeck.description || '')
      setColor(editDeck.color)
      setIcon(editDeck.icon)
      setTemplateId(editDeck.default_template_id || '')
      setSrsSettings(editDeck.srs_settings ?? { ...DEFAULT_SRS_SETTINGS })
    } else {
      setName('')
      setDescription('')
      setColor(COLORS[0])
      setIcon(ICONS[0])
      setTemplateId(templates.find((t) => t.is_default)?.id || '')
      setSrsSettings({ ...DEFAULT_SRS_SETTINGS })
    }
  }, [editDeck, open, templates])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)

    if (editDeck) {
      await updateDeck(editDeck.id, {
        name: name.trim(),
        description: description.trim() || null,
        color,
        icon,
        default_template_id: templateId || null,
        srs_settings: srsSettings,
      })
    } else {
      await createDeck({
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        icon,
        default_template_id: templateId || undefined,
        srs_settings: srsSettings,
      })
    }

    setLoading(false)
    onClose()
  }

  const updateSrsField = (key: keyof SrsSettings, value: number) => {
    setSrsSettings({ ...srsSettings, [key]: Math.max(0, Math.min(365, value)) })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editDeck ? '덱 수정' : '새 덱 만들기'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 이름 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              덱 이름 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: HSK 5급"
              required
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900"
            />
          </div>

          {/* 설명 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              설명 (선택)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="덱에 대한 설명"
              rows={2}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 resize-none"
            />
          </div>

          {/* 색상 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">색상</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full cursor-pointer transition-transform ${
                    color === c ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* 아이콘 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">아이콘</label>
            <div className="flex gap-2">
              {ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setIcon(ic)}
                  className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center cursor-pointer transition ${
                    icon === ic
                      ? 'bg-blue-50 ring-2 ring-blue-500'
                      : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          {/* 기본 템플릿 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              기본 카드 템플릿
            </label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900"
            >
              <option value="">선택 안 함</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.is_default ? '(기본)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* SRS 간격 설정 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              SRS 초기 간격 (일)
            </label>
            <div className="grid grid-cols-4 gap-2">
              {SRS_FIELDS.map(({ key, label, color }) => (
                <div key={key} className="text-center">
                  <label className={`block text-xs font-semibold mb-1 ${color}`}>
                    {label}
                  </label>
                  <input
                    type="number"
                    value={srsSettings[key]}
                    onChange={(e) => updateSrsField(key, parseInt(e.target.value) || 0)}
                    min={0}
                    max={365}
                    className="w-full px-2 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 text-center text-sm"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Again 0 = 10분 후 재학습. 이후 반복 시 간격이 자동으로 증가합니다.
            </p>
          </div>

          {/* 버튼 */}
          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {loading ? '저장 중...' : editDeck ? '수정' : '만들기'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
