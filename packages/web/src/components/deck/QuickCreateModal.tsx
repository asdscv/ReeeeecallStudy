import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { useDeckStore } from '../../stores/deck-store'
import { useCardStore } from '../../stores/card-store'
import { presetIdForTemplate, fieldLabelId } from '@reeeeecall/shared/lib/default-templates'
import type { CardTemplate, TemplateField } from '../../types/database'

interface QuickCreateModalProps {
  open: boolean
  onClose: () => void
  onCreated?: (deckId: string) => void
}

const INITIAL_ROWS = 3

/**
 * Dead-simple "just add stuff" flow: name the deck, pick one of the built-in
 * default templates (simplest = Front/Back), type a few cards, done. The
 * full-flexibility flow (DeckFormModal + per-card CardFormModal) is untouched;
 * this sits alongside it for users who find the advanced path heavy.
 */
export function QuickCreateModal({ open, onClose, onCreated }: QuickCreateModalProps) {
  const { t } = useTranslation(['decks', 'common'])
  const { templates, ensureDefaultTemplates, createDeck } = useDeckStore()
  const { createCards } = useCardStore()

  const [deckName, setDeckName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [loading, setLoading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // On open: reset + make sure the user actually has default templates to pick
  // from (self-heals zero-template accounts via the ensure_default_templates RPC).
  useEffect(() => {
    if (!open) return
    setDeckName('')
    setTemplateId('')
    setError(null)
    setRows(Array.from({ length: INITIAL_ROWS }, () => ({})))
    setPreparing(true)
    ensureDefaultTemplates().finally(() => setPreparing(false))
  }, [open, ensureDefaultTemplates])

  // Default-select the simplest preset once templates are loaded.
  useEffect(() => {
    if (!open || templateId) return
    const first = templates.find((tpl) => tpl.is_default)
    if (first) setTemplateId(first.id)
  }, [open, templates, templateId])

  const defaultTemplates = templates.filter((tpl) => tpl.is_default)
  const selectedTemplate: CardTemplate | undefined = templates.find((tpl) => tpl.id === templateId)
  const textFields: TemplateField[] = (selectedTemplate?.fields ?? []).filter((f) => f.type === 'text')

  const presetLabel = (tpl: CardTemplate) => {
    const id = presetIdForTemplate(tpl.name)
    return id ? t(`decks:quickCreate.presets.${id}`, { defaultValue: tpl.name }) : tpl.name
  }
  const fieldLabel = (f: TemplateField) => {
    const id = fieldLabelId(f.name)
    return id ? t(`decks:quickCreate.fields.${id}`, { defaultValue: f.name }) : f.name
  }
  const fieldPreview = (tpl: CardTemplate) =>
    (tpl.fields ?? [])
      .filter((f) => f.type === 'text')
      .map((f) => fieldLabel(f))
      .join(' · ')

  const setCell = (rowIdx: number, key: string, value: string) =>
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)))
  const addRow = () => setRows((prev) => [...prev, {}])
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const name = deckName.trim()
    if (!name) {
      setError(t('decks:quickCreate.errors.nameRequired'))
      return
    }
    if (!selectedTemplate) {
      setError(t('decks:quickCreate.errors.templateRequired'))
      return
    }

    // Keep only rows with at least one non-empty text field.
    const cards = rows
      .map((row) => {
        const fv: Record<string, string> = {}
        for (const f of textFields) {
          const v = (row[f.key] ?? '').trim()
          if (v) fv[f.key] = v
        }
        return fv
      })
      .filter((fv) => Object.keys(fv).length > 0)
      .map((fv) => ({ field_values: fv }))

    if (cards.length === 0) {
      setError(t('decks:quickCreate.errors.cardsRequired'))
      return
    }

    setLoading(true)
    const deck = await createDeck({ name, default_template_id: selectedTemplate.id })
    if (!deck) {
      setError(useDeckStore.getState().error ?? t('decks:quickCreate.errors.createFailed'))
      setLoading(false)
      return
    }

    const inserted = await createCards({
      deck_id: deck.id,
      template_id: selectedTemplate.id,
      cards,
    })
    setLoading(false)

    // Deck exists regardless; surface a card error but still hand off to the deck.
    if (inserted < cards.length) {
      const cardErr = useCardStore.getState().error
      if (cardErr) setError(cardErr)
    }
    onCreated?.(deck.id)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('decks:quickCreate.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">{error}</div>
          )}

          {/* Deck name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('decks:quickCreate.deckName')}
            </label>
            <input
              type="text"
              autoFocus
              data-testid="qc-deck-name"
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
              placeholder={t('decks:quickCreate.deckNamePlaceholder')}
              className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground"
            />
          </div>

          {/* Template preset picker */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('decks:quickCreate.template')}
            </label>
            {preparing && defaultTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('common:loading', { defaultValue: 'Loading...' })}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {defaultTemplates.map((tpl) => {
                  const selected = tpl.id === templateId
                  return (
                    <button
                      type="button"
                      key={tpl.id}
                      onClick={() => setTemplateId(tpl.id)}
                      className={`text-left p-3 rounded-lg border transition cursor-pointer ${
                        selected
                          ? 'border-brand ring-2 ring-brand/20 bg-brand/5'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      <div className="text-sm font-medium text-foreground">{presetLabel(tpl)}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{fieldPreview(tpl)}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Card entry rows */}
          {textFields.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('decks:quickCreate.cards')}
              </label>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {rows.map((row, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {textFields.map((f, fIdx) => (
                        <input
                          key={f.key}
                          type="text"
                          data-testid={`qc-card-${idx}-${fIdx}`}
                          value={row[f.key] ?? ''}
                          onChange={(e) => setCell(idx, f.key, e.target.value)}
                          placeholder={fieldLabel(f)}
                          className="w-full px-3 py-2 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-sm text-foreground"
                        />
                      ))}
                    </div>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="px-2 py-2 text-muted-foreground hover:text-destructive cursor-pointer"
                        aria-label={t('decks:quickCreate.removeRow')}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addRow}
                className="mt-2 text-sm text-brand hover:underline cursor-pointer"
              >
                {t('decks:quickCreate.addRow')}
              </button>
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-foreground bg-card border border-border rounded-lg hover:bg-muted cursor-pointer"
            >
              {t('decks:quickCreate.cancel')}
            </button>
            <button
              type="submit"
              data-testid="qc-submit"
              disabled={loading || preparing || !deckName.trim()}
              className="px-4 py-2 text-sm text-white bg-brand rounded-lg hover:bg-brand disabled:opacity-50 cursor-pointer"
            >
              {loading ? t('decks:quickCreate.creating') : t('decks:quickCreate.create')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
