import { useState, useEffect, useRef } from 'react'
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
import { useTemplateStore } from '../../stores/template-store'
import { useCardLimit } from '@reeeeecall/shared/hooks/useCardLimit'
import { CardLimitBlock } from '../card/CardLimitBlock'
import {
  QUICK_PRESETS,
  presetFieldSpecs,
  type QuickPreset,
  type QuickFieldSpec,
} from '@reeeeecall/shared/lib/default-templates'

interface QuickCreateModalProps {
  open: boolean
  onClose: () => void
  onCreated?: (deckId: string) => void
}

const INITIAL_ROWS = 1

/**
 * Dead-simple "just add stuff" flow: name the deck (optional description), pick a
 * card shape by FIELD COUNT (front/back — simplest = 1 front / 1 back), type a
 * few cards, done. The matching card_template is found-or-created on submit, so
 * the user never deals with templates. The full-flexibility flow (DeckFormModal +
 * CardFormModal) is untouched; this sits alongside it.
 */
export function QuickCreateModal({ open, onClose, onCreated }: QuickCreateModalProps) {
  const { t } = useTranslation(['decks', 'common'])
  const { createDeck, deleteDeck } = useDeckStore()
  const { createCards } = useCardStore()
  const limit = useCardLimit()
  const { findOrCreatePresetTemplate } = useTemplateStore()

  const [deckName, setDeckName] = useState('')
  const [deckDescription, setDeckDescription] = useState('')
  const [presetId, setPresetId] = useState(QUICK_PRESETS[0].id)
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // If deck/template creation succeeded but a later step failed, keep the modal
  // open and remember the ids so a retry never re-creates them (no duplicates).
  const [createdDeckId, setCreatedDeckId] = useState<string | null>(null)
  const [createdTemplateId, setCreatedTemplateId] = useState<string | null>(null)
  // How many of the current cards already landed in DB — so a retry after a
  // partial insert only sends the remainder (no duplicate cards).
  const [createdCardCount, setCreatedCardCount] = useState(0)
  // Synchronous in-flight guard: `loading` (React state) commits asynchronously,
  // so a fast double-click/Enter could enter handleSubmit twice before it flips
  // and create two decks (decks have no unique constraint). A ref blocks re-entry
  // synchronously on the first call.
  const submitting = useRef(false)

  useEffect(() => {
    if (!open) return
    setDeckName('')
    setDeckDescription('')
    setPresetId(QUICK_PRESETS[0].id)
    setError(null)
    setCreatedDeckId(null)
    setCreatedTemplateId(null)
    setCreatedCardCount(0)
    setRows(Array.from({ length: INITIAL_ROWS }, () => ({})))
  }, [open])

  const preset: QuickPreset = QUICK_PRESETS.find((p) => p.id === presetId) ?? QUICK_PRESETS[0]
  const specs: QuickFieldSpec[] = presetFieldSpecs(preset)

  const presetSummary = (p: QuickPreset) =>
    t('decks:quickCreate.presetSummary', { front: p.front, back: p.back })
  const fieldLabel = (spec: QuickFieldSpec) => {
    if (spec.side === 'front') {
      return spec.index === 1
        ? t('decks:quickCreate.fields.front')
        : t('decks:quickCreate.fields.frontN', { n: spec.index })
    }
    return spec.index === 1
      ? t('decks:quickCreate.fields.back')
      : t('decks:quickCreate.fields.backN', { n: spec.index })
  }

  const emptyRows = () => Array.from({ length: INITIAL_ROWS }, () => ({}))
  const cleanupOrphanDeck = () => {
    // A deck is created before its cards; if creation succeeded but no card ever
    // landed (createdCardCount === 0), abandoning the flow (cancel / close /
    // preset switch) would leave an empty orphan deck in the list. Delete it.
    // Decks that already received cards are real and kept.
    if (createdDeckId && createdCardCount === 0) void deleteDeck(createdDeckId)
  }
  const handleClose = () => {
    cleanupOrphanDeck()
    onClose()
  }
  const selectPreset = (id: string) => {
    // Field keys (field_1/2/…) carry different meanings per shape, so switching
    // would mislabel already-typed values — clear the rows on switch. Also drop
    // any empty deck created under the old shape and reset the created ids so the
    // new shape is consistent end-to-end.
    cleanupOrphanDeck()
    setPresetId(id)
    setRows(emptyRows())
    setCreatedTemplateId(null)
    setCreatedDeckId(null)
    setCreatedCardCount(0)
  }
  const setCell = (rowIdx: number, key: string, value: string) =>
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)))
  const addRow = () => setRows((prev) => [...prev, {}])
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading || submitting.current) return
    submitting.current = true
    try {
      setError(null)

      // Owned-card limit pre-flight (mig 116). Server also enforces at createCards.
      if (limit.reached) {
        setError('errors:card.limitReached')
        return
      }

      const name = deckName.trim()
      if (!name) {
        setError(t('decks:quickCreate.errors.nameRequired'))
        return
      }

      // Build cards. A row counts only if it has content; a non-empty row that is
      // missing its front field blocks submit (an empty front = a blank study
      // prompt) instead of silently creating a broken card.
      const frontKeys = specs.filter((s) => s.side === 'front').map((s) => s.key)
      let incompleteFront = false
      const cards: { field_values: Record<string, string> }[] = []
      for (const row of rows) {
        const fv: Record<string, string> = {}
        for (const spec of specs) {
          const v = (row[spec.key] ?? '').trim()
          if (v) fv[spec.key] = v
        }
        if (Object.keys(fv).length === 0) continue
        if (frontKeys.some((k) => !fv[k])) { incompleteFront = true; continue }
        cards.push({ field_values: fv })
      }

      if (incompleteFront) {
        setError(t('decks:quickCreate.errors.frontRequired'))
        return
      }
      if (cards.length === 0) {
        setError(t('decks:quickCreate.errors.cardsRequired'))
        return
      }

      setLoading(true)

      // 1. find-or-create the template for this field shape (reused on retry).
      let templateId = createdTemplateId
      if (!templateId) {
        const tpl = await findOrCreatePresetTemplate(preset)
        if (!tpl) {
          setError(useTemplateStore.getState().error ?? t('decks:quickCreate.errors.createFailed'))
          return
        }
        templateId = tpl.id
        setCreatedTemplateId(tpl.id)
      }

      // 2. create the deck only once; a retry after a later failure reuses it.
      let deckId = createdDeckId
      if (!deckId) {
        const deck = await createDeck({
          name,
          description: deckDescription.trim() || undefined,
          default_template_id: templateId,
        })
        if (!deck) {
          setError(useDeckStore.getState().error ?? t('decks:quickCreate.errors.createFailed'))
          return
        }
        deckId = deck.id
        setCreatedDeckId(deck.id)
      }

      // 3. insert ONLY the cards not already saved by a previous attempt, so a
      // retry after a partial insert never duplicates the already-saved cards.
      const remaining = cards.slice(createdCardCount)
      const inserted = remaining.length
        ? await createCards({ deck_id: deckId, template_id: templateId, cards: remaining })
        : 0
      const total = createdCardCount + inserted
      setCreatedCardCount(total)

      if (total < cards.length) {
        setError(useCardStore.getState().error ?? t('decks:quickCreate.errors.createFailed'))
        return
      }

      // The template was written via template-store; invalidate deck-store's
      // separate templates cache so DeckDetail / card forms refetch and see it.
      useDeckStore.getState().invalidate('templates')
      onCreated?.(deckId)
      onClose()
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('decks:quickCreate.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {limit.reached && <CardLimitBlock />}
          {error && (
            <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
              {t(error, { defaultValue: error })}
            </div>
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

          {/* Deck description (optional) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('decks:quickCreate.deckDescription')}
            </label>
            <input
              type="text"
              data-testid="qc-deck-description"
              value={deckDescription}
              onChange={(e) => setDeckDescription(e.target.value)}
              placeholder={t('decks:quickCreate.deckDescriptionPlaceholder')}
              className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground"
            />
          </div>

          {/* Card shape picker (by field count) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('decks:quickCreate.template')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_PRESETS.map((p) => {
                const selected = p.id === presetId
                return (
                  <button
                    type="button"
                    key={p.id}
                    data-testid={`qc-preset-${p.id}`}
                    onClick={() => selectPreset(p.id)}
                    className={`text-left p-3 rounded-lg border transition cursor-pointer ${
                      selected
                        ? 'border-brand ring-2 ring-brand/20 bg-brand/5'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">{presetSummary(p)}</span>
                      {p.id === QUICK_PRESETS[0].id && (
                        <span className="text-[10px] font-medium text-brand bg-brand/10 px-1.5 py-0.5 rounded">
                          {t('decks:quickCreate.basicLabel')}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Card entry rows */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('decks:quickCreate.cards')}
            </label>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
              {rows.map((row, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {specs.map((spec, fIdx) => (
                      <input
                        key={spec.key}
                        type="text"
                        data-testid={`qc-card-${idx}-${fIdx}`}
                        value={row[spec.key] ?? ''}
                        onChange={(e) => setCell(idx, spec.key, e.target.value)}
                        placeholder={fieldLabel(spec)}
                        /* Distinguish front (accent border + tint) from back (default) at a glance. */
                        className={`w-full px-3 py-2 rounded-lg border ${spec.side === 'front' ? 'border-brand/60 bg-brand/5' : 'border-border'} focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-sm text-foreground`}
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

          <DialogFooter>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm text-foreground bg-card border border-border rounded-lg hover:bg-muted cursor-pointer"
            >
              {t('decks:quickCreate.cancel')}
            </button>
            <button
              type="submit"
              data-testid="qc-submit"
              disabled={loading || !deckName.trim()}
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
