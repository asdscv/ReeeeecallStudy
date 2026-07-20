import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageUp } from 'lucide-react'
import { getAffordableCards, type Affordable } from '@reeeeecall/shared/lib/ai/server-client'
import { useCardLimit } from '@reeeeecall/shared/hooks/useCardLimit'
import { useDeckStore } from '../../../stores/deck-store'
import { CardLimitBlock } from '../../card/CardLimitBlock'
import type { GenerateMode } from '../../../lib/ai/types'
import type { Deck } from '../../../types/database'

// ─── Exported types ────────────────────────────────────────

export interface FieldPresetItem {
  name: string
  side: 'front' | 'back'
}

export type FieldMode = 'auto' | 'manual'

// The free AI-generation daily cap (mirrors the server's _ai_free_cards_per_day = 10).
// Used to clamp the default card count to today's remaining free allowance.
const FREE_DAILY_CAP = 10

export interface GenerateConfig {
  topic: string
  cardCount: number
  useCustomHtml: boolean
  contentLang: string
  fieldMode: FieldMode
  customFields: FieldPresetItem[]
  selectedDeckId?: string
  selectedTemplateId?: string
  imageMode?: 'topic' | 'image'
  imageDataUrl?: string
}

const CONTENT_LANGUAGES = [
  { value: '', labelKey: 'config.lang.auto' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'zh-TW', label: '中文（繁體）' },
  { value: 'es-ES', label: 'Español' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'vi-VN', label: 'Tiếng Việt' },
  { value: 'th-TH', label: 'ไทย' },
]

// ─── Props ─────────────────────────────────────────────────

interface ConfigStepProps {
  mode: GenerateMode
  initialTopic?: string
  existingDeckId?: string | null
  onStart: (cfg: GenerateConfig) => void
  showModeSelect?: boolean
  onModeChange?: (mode: GenerateMode) => void
}

// ─── Component ─────────────────────────────────────────────
// AI generation runs on our server key (metered free tier), so no provider/API
// key selection is needed here — this step only gathers generation parameters.

export function ConfigStep({ mode, initialTopic, existingDeckId, onStart, showModeSelect, onModeChange }: ConfigStepProps) {
  const { t } = useTranslation('ai-generate')
  const { decks, fetchDecks } = useDeckStore()
  const limit = useCardLimit()

  // Generation config state.
  // cardCount defaults to today's REMAINING FREE cards (see the affordance effect below)
  // so a default generation never overshoots the free daily allowance (10/day). Starts at
  // the free daily cap (10) until the server-authoritative remaining loads.
  const [topic, setTopic] = useState(initialTopic || '')
  const [cardCount, setCardCount] = useState(10)
  const countTouched = useRef(false)   // once the user edits the count, stop auto-defaulting it
  const [useCustomHtml, setUseCustomHtml] = useState(false)
  const [contentLang, setContentLang] = useState('')

  // Deck selector (cards_only mode)
  const [selectedDeckId, setSelectedDeckId] = useState(existingDeckId || '')

  // Input mode (cards_only): type a topic, or upload an image to recognize.
  const [imageMode, setImageMode] = useState<'topic' | 'image'>('topic')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Remaining free cards + credit-affordable cards (cost transparency).
  const [affordable, setAffordable] = useState<Affordable | null>(null)

  // Field config
  const [fieldMode, setFieldMode] = useState<FieldMode>('auto')
  const [customFields, setCustomFields] = useState<FieldPresetItem[]>([
    { name: '', side: 'front' },
    { name: '', side: 'back' },
  ])

  const isFullMode = mode === 'full'
  // Image recognition works in BOTH modes: cards_only → add cards to a deck; full →
  // recognize the image into a whole new deck (kind='image_deck').
  const useImage = imageMode === 'image'

  // Fetch decks for selector (cards_only mode)
  useEffect(() => {
    if (!isFullMode && decks.length === 0) {
      fetchDecks()
    }
  }, [isFullMode, decks.length, fetchDecks])

  useEffect(() => {
    if (initialTopic) setTopic(initialTopic)
  }, [initialTopic])

  useEffect(() => {
    if (existingDeckId) setSelectedDeckId(existingDeckId)
  }, [existingDeckId])

  // Load the remaining-free + credit affordance once (server is authoritative).
  useEffect(() => {
    getAffordableCards().then(setAffordable).catch(() => {})
  }, [])

  // Default the card count to TODAY'S REMAINING FREE cards (clamped to [1, free daily cap])
  // so a default generation never overshoots the free allowance and silently spends the
  // wallet. Applies once the server-authoritative affordance loads, and only until the user
  // edits the count themselves. Image mode is paid-only, so it keeps the manual value.
  useEffect(() => {
    if (affordable && !countTouched.current && !useImage) {
      setCardCount(Math.max(1, Math.min(FREE_DAILY_CAP, affordable.free)))
    }
  }, [affordable, useImage])

  // Selected deck info
  const selectedDeck: Deck | undefined = decks.find((d) => d.id === selectedDeckId)

  const addCustomField = () => {
    if (customFields.length >= 6) return
    setCustomFields([...customFields, { name: '', side: 'back' }])
  }

  const removeCustomField = (index: number) => {
    if (customFields.length <= 2) return
    setCustomFields(customFields.filter((_, i) => i !== index))
  }

  const updateCustomField = (index: number, updates: Partial<FieldPresetItem>) => {
    const updated = [...customFields]
    updated[index] = { ...updated[index], ...updates }
    setCustomFields(updated)
  }

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Downscale large photos client-side so the data URL stays well under the
    // server's image cap (a phone photo is often 4–12MB).
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX_EDGE = 1600
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { setImageDataUrl(null); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      setImageDataUrl(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => { URL.revokeObjectURL(url); setImageDataUrl(null) }
    img.src = url
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (useImage) {
      if (!imageDataUrl) return
      if (!isFullMode && !selectedDeckId) return  // cards_only needs a target deck
    } else {
      if (!topic.trim()) return
      if (!isFullMode && !selectedDeckId) return
    }

    // Owned-card limit pre-flight (mig 116): don't spend AI cost/quota generating
    // cards that can't be saved. In image mode the count is model-decided, so only
    // block when there's NO room at all. Server still enforces at save.
    if (useImage ? limit.reached : limit.exceeds(cardCount)) return

    onStart({
      topic,
      cardCount,
      useCustomHtml,
      contentLang,
      fieldMode,
      customFields: fieldMode === 'manual'
        ? customFields.filter((f) => f.name.trim())
        : [],
      selectedDeckId: !isFullMode ? selectedDeckId : undefined,
      selectedTemplateId: !isFullMode && selectedDeck?.default_template_id
        ? selectedDeck.default_template_id
        : undefined,
      imageMode: useImage ? 'image' : 'topic',
      imageDataUrl: useImage ? imageDataUrl ?? undefined : undefined,
    })
  }

  // cards_only generation (topic OR image) needs the deck's template fields.
  const cardsOnlyNeedsTemplate = !isFullMode && !!selectedDeckId && !selectedDeck?.default_template_id

  const canSubmit = cardsOnlyNeedsTemplate
    ? false
    : useImage
      ? !!imageDataUrl && (isFullMode || !!selectedDeckId)
      : topic.trim() && (isFullMode || selectedDeckId)

  // Free-remaining + prepaid ₩ wallet line (metered billing). Image mode is paid-only.
  const balanceWon = affordable?.balanceMicroWon ? Math.floor(affordable.balanceMicroWon / 1_000_000) : 0
  const balanceText = () => t('wallet.balance', { won: balanceWon.toLocaleString(), cards: affordable!.paid })
  const walletText = !affordable
    ? null
    : !affordable.walletKnown
      ? t('wallet.unknown')
      : useImage
        ? (balanceWon > 0 ? balanceText() : t('wallet.imagePaid'))
        : affordable.free > 0 && balanceWon > 0
          ? `${t('wallet.freeOnly', { free: affordable.free })} · ${balanceText()}`
          : affordable.free > 0
            ? t('wallet.freeOnly', { free: affordable.free })
            : balanceWon > 0
              ? balanceText()
              : t('wallet.empty')

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Mode select */}
      {showModeSelect && onModeChange && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            {t('config.modeLabel')}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['full', 'cards_only'] as GenerateMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-left text-sm font-medium transition cursor-pointer ${
                  mode === m
                    ? 'border-brand bg-brand/10 text-brand ring-1 ring-brand/30'
                    : 'border-border text-muted-foreground hover:bg-accent/40'
                }`}
              >
                <span className="text-base leading-none">{m === 'full' ? '🆕' : '➕'}</span>
                {t(`config.mode.${m}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Content Section ── */}
      <fieldset className="bg-card rounded-xl border border-border p-4 sm:p-5 space-y-4">
        <legend className="text-sm font-semibold text-foreground px-1">{t('config.contentSection')}</legend>

        {/* Deck selector (cards_only mode) */}
        {!isFullMode && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('config.targetDeck')}</label>
            <select
              value={selectedDeckId}
              onChange={(e) => setSelectedDeckId(e.target.value)}
              className={`w-full px-3 py-2 rounded-xl border text-sm outline-none focus:border-brand bg-card ${
                !selectedDeckId ? 'border-destructive/30' : 'border-border'
              }`}
            >
              <option value="">{t('config.selectDeck')}</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.icon} {d.name}
                </option>
              ))}
            </select>
            {!selectedDeckId && (
              <p className="text-xs text-destructive mt-0.5">{t('config.selectDeckRequired')}</p>
            )}
            {cardsOnlyNeedsTemplate && (
              <p className="text-xs text-destructive mt-0.5">{t('config.deckNoTemplate')}</p>
            )}
          </div>
        )}

        {/* Input mode toggle: type a topic, or recognize an image (both modes —
            in full mode 'image' creates a whole new deck from the image) */}
        <div className="grid grid-cols-2 gap-2">
          {(['topic', 'image'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setImageMode(m)}
              className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-left text-sm font-medium transition cursor-pointer ${
                imageMode === m
                  ? 'border-brand bg-brand/10 text-brand ring-1 ring-brand/30'
                  : 'border-border text-muted-foreground hover:bg-accent/40'
              }`}
            >
              <span className="text-base leading-none">{m === 'topic' ? '📝' : '🖼️'}</span>
              {t(m === 'topic' ? 'config.inputModeTopic' : 'config.inputModeImage')}
            </button>
          ))}
        </div>

        {/* Topic input (topic mode, or full mode) */}
        {!useImage && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('config.topic')}</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t('config.topicPlaceholder')}
              className="w-full px-3 py-2 rounded-xl border border-border text-sm outline-none focus:border-brand"
            />
          </div>
        )}

        {/* Image upload (cards_only + image mode) — always paid (no free tier) */}
        {useImage && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('config.imageUpload')}</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onPickImage}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-border hover:border-brand/50 hover:bg-accent/30 transition cursor-pointer text-muted-foreground text-sm"
            >
              <ImageUp size={28} />
              {imageDataUrl ? t('config.imageChange') : t('config.imageUpload')}
            </button>
            {imageDataUrl && (
              <img src={imageDataUrl} alt="" className="mt-2 max-h-44 rounded-xl border border-border mx-auto" />
            )}
            <p className="text-[11px] text-content-tertiary mt-1.5">{t('config.imageUploadHint')}</p>
            <p className="text-[11px] text-amber-600 mt-0.5">{t('config.imagePaidNotice')}</p>
          </div>
        )}

        {/* Content language (topic mode — image takes its language from the image) */}
        {!useImage && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('config.contentLang')}</label>
            <select
              value={contentLang}
              onChange={(e) => setContentLang(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-border text-sm outline-none focus:border-brand bg-card"
            >
              {CONTENT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label ?? t(l.labelKey!)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            {t('config.cardCount')}
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={cardCount}
            onChange={(e) => {
              countTouched.current = true   // user set it manually → stop auto-defaulting to remaining-free
              const raw = e.target.value
              setCardCount(raw === '' ? ('' as any) : (parseInt(raw) || 0))
            }}
            onBlur={() => {
              const n = typeof cardCount === 'number' ? cardCount : parseInt(String(cardCount)) || 1
              setCardCount(Math.max(1, Math.min(100, n)))
            }}
            className="w-full px-3 py-2 rounded-xl border border-border text-sm outline-none focus:border-brand bg-card"
            placeholder={t('config.cardCountPlaceholder', { min: 1, max: 100 })}
          />
          <p className="text-xs text-content-tertiary mt-1">{t('config.cardCountHint', { min: 1, max: 100 })}</p>
        </div>
      </fieldset>

      {/* ── Template Config (full mode, topic input only — image builds its own template) ── */}
      {isFullMode && !useImage && (
        <fieldset className="bg-card rounded-xl border border-border p-4 sm:p-5 space-y-4">
          <legend className="text-sm font-semibold text-foreground px-1">{t('config.templateSection')}</legend>

          {/* Field mode: auto vs manual */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('config.fieldConfig')}</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setFieldMode('auto')}
                className={`px-3 py-2.5 text-xs rounded-xl border transition cursor-pointer text-left ${
                  fieldMode === 'auto'
                    ? 'border-brand bg-brand/10 text-brand ring-1 ring-brand/30'
                    : 'border-border text-muted-foreground hover:bg-accent/40'
                }`}
              >
                <span className="font-medium">{t('config.fieldAuto')}</span>
                <span className="block text-[10px] text-content-tertiary mt-0.5">{t('config.fieldAutoDesc')}</span>
              </button>
              <button
                type="button"
                onClick={() => setFieldMode('manual')}
                className={`px-3 py-2.5 text-xs rounded-xl border transition cursor-pointer text-left ${
                  fieldMode === 'manual'
                    ? 'border-brand bg-brand/10 text-brand ring-1 ring-brand/30'
                    : 'border-border text-muted-foreground hover:bg-accent/40'
                }`}
              >
                <span className="font-medium">{t('config.fieldManual')}</span>
                <span className="block text-[10px] text-content-tertiary mt-0.5">{t('config.fieldManualDesc')}</span>
              </button>
            </div>
          </div>

          {/* Manual field editor */}
          {fieldMode === 'manual' && (
            <div className="space-y-1.5">
              {customFields.map((field, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={field.name}
                    onChange={(e) => updateCustomField(i, { name: e.target.value })}
                    placeholder={`${t('config.fieldName')} ${i + 1}`}
                    className="flex-1 px-2.5 py-2 text-xs border border-border rounded-lg outline-none focus:border-brand"
                  />
                  <select
                    value={field.side}
                    onChange={(e) => updateCustomField(i, { side: e.target.value as 'front' | 'back' })}
                    className="px-2.5 py-2 text-xs border border-border rounded-lg outline-none bg-card"
                  >
                    <option value="front">{t('config.front')}</option>
                    <option value="back">{t('config.back')}</option>
                  </select>
                  {customFields.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeCustomField(i)}
                      className="text-destructive/70 hover:text-destructive text-xs cursor-pointer px-1"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {customFields.length < 6 && (
                <button
                  type="button"
                  onClick={addCustomField}
                  className="text-xs font-medium text-brand hover:text-brand-hover cursor-pointer"
                >
                  + {t('config.addField')}
                </button>
              )}
            </div>
          )}

          {/* Layout mode */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('config.layoutMode')}</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setUseCustomHtml(false)}
                className={`px-3 py-2.5 text-xs rounded-xl border transition cursor-pointer text-left ${
                  !useCustomHtml
                    ? 'border-brand bg-brand/10 text-brand ring-1 ring-brand/30'
                    : 'border-border text-muted-foreground hover:bg-accent/40'
                }`}
              >
                <span className="font-medium">{t('config.layoutDefault')}</span>
                <span className="block text-[10px] text-content-tertiary mt-0.5">{t('config.layoutDefaultDesc')}</span>
              </button>
              <button
                type="button"
                onClick={() => setUseCustomHtml(true)}
                className={`px-3 py-2.5 text-xs rounded-xl border transition cursor-pointer text-left ${
                  useCustomHtml
                    ? 'border-brand bg-brand/10 text-brand ring-1 ring-brand/30'
                    : 'border-border text-muted-foreground hover:bg-accent/40'
                }`}
              >
                <span className="font-medium">{t('config.layoutCustom')}</span>
                <span className="block text-[10px] text-content-tertiary mt-0.5">{t('config.layoutCustomDesc')}</span>
              </button>
            </div>
          </div>
        </fieldset>
      )}

      {walletText && (
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/60 text-xs text-muted-foreground">{walletText}</span>
        </div>
      )}

      {limit.reached ? (
        <CardLimitBlock />
      ) : !useImage && limit.exceeds(cardCount) ? (
        <p className="text-xs text-center text-destructive">
          {t('config.cardLimitExceeds', { available: limit.available })}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit || (!useImage && limit.exceeds(cardCount))}
        className="w-full py-3 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {t('config.startGenerate')}
      </button>
    </form>
  )
}
