import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageUp } from 'lucide-react'
import { getAffordableCards, type Affordable } from '@reeeeecall/shared/lib/ai/server-client'
import { useDeckStore } from '../../../stores/deck-store'
import type { GenerateMode } from '../../../lib/ai/types'
import type { Deck } from '../../../types/database'

// ─── Exported types ────────────────────────────────────────

export interface FieldPresetItem {
  name: string
  side: 'front' | 'back'
}

export type FieldMode = 'auto' | 'manual'

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

  // Generation config state
  const [topic, setTopic] = useState(initialTopic || '')
  const [cardCount, setCardCount] = useState(20)
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
  const useImage = !isFullMode && imageMode === 'image'

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
      if (!imageDataUrl || !selectedDeckId) return
    } else {
      if (!topic.trim()) return
      if (!isFullMode && !selectedDeckId) return
    }

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
      ? !!imageDataUrl && !!selectedDeckId
      : topic.trim() && (isFullMode || selectedDeckId)

  // Free-remaining + prepaid ₩ wallet line (metered billing). Image mode is paid-only.
  const balanceWon = affordable?.balanceMicroWon ? Math.floor(affordable.balanceMicroWon / 1_000_000) : 0
  const balanceText = () => t('wallet.balance', { won: balanceWon.toLocaleString(), cards: affordable!.paid })
  const walletText = !affordable
    ? null
    : !affordable.walletKnown
      ? t('wallet.unknown')
      : useImage
        ? (balanceWon > 0 ? balanceText() : t('wallet.empty'))
        : affordable.free > 0 && balanceWon > 0
          ? `${t('wallet.freeOnly', { free: affordable.free })} · ${balanceText()}`
          : affordable.free > 0
            ? t('wallet.freeOnly', { free: affordable.free })
            : balanceWon > 0
              ? balanceText()
              : t('wallet.empty')

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
                className={`px-3 py-2 text-xs rounded-lg border transition cursor-pointer ${
                  mode === m
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {t(`config.mode.${m}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Content Section ── */}
      <fieldset className="space-y-3 p-3 bg-brand/5 rounded-lg border border-brand/20">
        <legend className="text-xs font-semibold text-brand uppercase px-1">{t('config.contentSection')}</legend>

        {/* Deck selector (cards_only mode) */}
        {!isFullMode && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('config.targetDeck')}</label>
            <select
              value={selectedDeckId}
              onChange={(e) => setSelectedDeckId(e.target.value)}
              className={`w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-brand bg-card ${
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

        {/* Input mode toggle (cards_only): topic vs image */}
        {!isFullMode && (
          <div className="grid grid-cols-2 gap-1.5">
            {(['topic', 'image'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setImageMode(m)}
                className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer ${
                  imageMode === m
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {t(m === 'topic' ? 'config.inputModeTopic' : 'config.inputModeImage')}
              </button>
            ))}
          </div>
        )}

        {/* Topic input (topic mode, or full mode) */}
        {!useImage && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('config.topic')}</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t('config.topicPlaceholder')}
              className="w-full px-3 py-2 rounded-lg border border-border text-sm outline-none focus:border-brand"
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
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-brand/40 text-sm text-brand hover:bg-brand/5 transition cursor-pointer"
            >
              <ImageUp className="w-4 h-4" />
              {imageDataUrl ? t('config.imageChange') : t('config.imageUpload')}
            </button>
            {imageDataUrl && (
              <img src={imageDataUrl} alt="" className="mt-2 max-h-44 rounded-lg border border-border mx-auto" />
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
              className="w-full px-3 py-2 rounded-lg border border-border text-sm outline-none focus:border-brand bg-card"
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
              const raw = e.target.value
              setCardCount(raw === '' ? ('' as any) : (parseInt(raw) || 0))
            }}
            onBlur={() => {
              const n = typeof cardCount === 'number' ? cardCount : parseInt(String(cardCount)) || 1
              setCardCount(Math.max(1, Math.min(100, n)))
            }}
            className="w-full px-3 py-2 rounded-lg border border-border text-sm outline-none focus:border-brand bg-card"
            placeholder={t('config.cardCountPlaceholder', { min: 1, max: 100 })}
          />
          <p className="text-xs text-content-tertiary mt-1">{t('config.cardCountHint', { min: 1, max: 100 })}</p>
        </div>
      </fieldset>

      {/* ── Template Config (full mode only) ── */}
      {isFullMode && (
        <fieldset className="space-y-3 p-3 bg-purple-50/50 rounded-lg border border-purple-100">
          <legend className="text-xs font-semibold text-purple-600 uppercase px-1">{t('config.templateSection')}</legend>

          {/* Field mode: auto vs manual */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('config.fieldConfig')}</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setFieldMode('auto')}
                className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer text-left ${
                  fieldMode === 'auto'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className="font-medium">{t('config.fieldAuto')}</span>
                <span className="block text-[10px] text-content-tertiary mt-0.5">{t('config.fieldAutoDesc')}</span>
              </button>
              <button
                type="button"
                onClick={() => setFieldMode('manual')}
                className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer text-left ${
                  fieldMode === 'manual'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-border text-muted-foreground hover:bg-muted'
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
                    className="flex-1 px-2 py-1.5 text-xs border border-border rounded outline-none focus:border-purple-500"
                  />
                  <select
                    value={field.side}
                    onChange={(e) => updateCustomField(i, { side: e.target.value as 'front' | 'back' })}
                    className="px-2 py-1.5 text-xs border border-border rounded outline-none bg-card"
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
                  className="text-xs text-purple-600 hover:text-purple-800 cursor-pointer"
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
                className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer text-left ${
                  !useCustomHtml
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className="font-medium">{t('config.layoutDefault')}</span>
                <span className="block text-[10px] text-content-tertiary mt-0.5">{t('config.layoutDefaultDesc')}</span>
              </button>
              <button
                type="button"
                onClick={() => setUseCustomHtml(true)}
                className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer text-left ${
                  useCustomHtml
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-border text-muted-foreground hover:bg-muted'
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
        <p className="text-xs text-center text-muted-foreground">{walletText}</p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full px-4 py-2.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand-hover transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t('config.startGenerate')}
      </button>
    </form>
  )
}
