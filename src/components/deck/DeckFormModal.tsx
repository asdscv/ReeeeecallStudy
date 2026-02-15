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
import type { Deck } from '../../types/database'
import { DeckSettingsForm, COLORS, ICONS } from './DeckSettingsForm'
import type { DeckSettingsFormValues } from './DeckSettingsForm'

interface DeckFormModalProps {
  open: boolean
  onClose: () => void
  editDeck?: Deck | null
}

export function DeckFormModal({ open, onClose, editDeck }: DeckFormModalProps) {
  const { createDeck, updateDeck, templates } = useDeckStore()

  const [formValues, setFormValues] = useState<DeckSettingsFormValues>({
    name: '',
    description: '',
    color: COLORS[0],
    icon: ICONS[0],
    templateId: '',
    srsSettings: { ...DEFAULT_SRS_SETTINGS },
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (editDeck) {
      setFormValues({
        name: editDeck.name,
        description: editDeck.description || '',
        color: editDeck.color,
        icon: editDeck.icon,
        templateId: editDeck.default_template_id || '',
        srsSettings: editDeck.srs_settings ?? { ...DEFAULT_SRS_SETTINGS },
      })
    } else {
      setFormValues({
        name: '',
        description: '',
        color: COLORS[0],
        icon: ICONS[0],
        templateId: templates.find((t) => t.is_default)?.id || '',
        srsSettings: { ...DEFAULT_SRS_SETTINGS },
      })
    }
  }, [editDeck, open, templates])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formValues.name.trim()) return

    setLoading(true)

    if (editDeck) {
      await updateDeck(editDeck.id, {
        name: formValues.name.trim(),
        description: formValues.description.trim() || null,
        color: formValues.color,
        icon: formValues.icon,
        default_template_id: formValues.templateId || null,
        srs_settings: formValues.srsSettings,
      })
    } else {
      await createDeck({
        name: formValues.name.trim(),
        description: formValues.description.trim() || undefined,
        color: formValues.color,
        icon: formValues.icon,
        default_template_id: formValues.templateId || undefined,
        srs_settings: formValues.srsSettings,
      })
    }

    setLoading(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editDeck ? '덱 수정' : '새 덱 만들기'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DeckSettingsForm
            values={formValues}
            onChange={setFormValues}
            templates={templates}
          />

          <DialogFooter className="mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading || !formValues.name.trim()}
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
