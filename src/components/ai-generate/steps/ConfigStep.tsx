import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { aiConfigManager } from '../../../lib/ai/secure-storage'
import { useAuthStore } from '../../../stores/auth-store'
import { setAIConfigCache } from '../../../stores/ai-generate-store'
import { getProviders, getProvider } from '../../../lib/ai/provider-registry'
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
}

const CONTENT_LANGUAGES = [
  { value: '', labelKey: 'config.lang.auto' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'zh-CN', label: '中文' },
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

export function ConfigStep({ mode, initialTopic, existingDeckId, onStart, showModeSelect, onModeChange }: ConfigStepProps) {
  const { t } = useTranslation('ai-generate')
  const providers = getProviders()
  const { decks, fetchDecks } = useDeckStore()

  // AI provider state
  const [providerId, setProviderId] = useState('openai')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [customUrl, setCustomUrl] = useState('')

  // Generation config state
  const [topic, setTopic] = useState(initialTopic || '')
  const [cardCount, setCardCount] = useState(20)
  const [useCustomHtml, setUseCustomHtml] = useState(false)
  const [contentLang, setContentLang] = useState('')

  // Deck selector (cards_only mode)
  const [selectedDeckId, setSelectedDeckId] = useState(existingDeckId || '')

  // Field config
  const [fieldMode, setFieldMode] = useState<FieldMode>('auto')
  const [customFields, setCustomFields] = useState<FieldPresetItem[]>([
    { name: '', side: 'front' },
    { name: '', side: 'back' },
  ])

  const isFullMode = mode === 'full'

  // Load saved config (async decryption)
  useEffect(() => {
    const uid = useAuthStore.getState().user?.id
    if (!uid) return
    aiConfigManager.load(uid).then((saved) => {
      if (saved) {
        setProviderId(saved.providerId)
        setApiKey(saved.apiKey)
        setModel(saved.model)
        if (saved.baseUrl) setCustomUrl(saved.baseUrl)
      }
    })
  }, [])

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

  // Auto-select first model when provider changes
  useEffect(() => {
    if (providerId === 'custom') {
      setModel('custom')
      return
    }
    const provider = getProvider(providerId)
    if (provider && provider.models.length > 0) {
      const uid = useAuthStore.getState().user?.id
      if (uid) {
        aiConfigManager.load(uid).then((saved) => {
          if (saved?.providerId === providerId && saved.model) {
            setModel(saved.model)
          } else {
            setModel(provider!.models[0].id)
          }
        })
      } else {
        setModel(provider.models[0].id)
      }
    }
  }, [providerId])

  const currentProvider = getProvider(providerId)
  const models = currentProvider?.models ?? []

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apiKey.trim() || !topic.trim()) return
    if (!isFullMode && !selectedDeckId) return

    const aiConfig = {
      providerId,
      apiKey,
      model,
      baseUrl: providerId === 'custom' ? customUrl : undefined,
    }

    // Set in-memory cache immediately (avoids async save/load race)
    setAIConfigCache(aiConfig)

    // Persist encrypted to storage (non-blocking)
    const uid = useAuthStore.getState().user?.id
    if (uid) {
      aiConfigManager.save(uid, aiConfig).catch(() => { /* storage failure */ })
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
    })
  }

  const canSubmit =
    apiKey.trim() &&
    topic.trim() &&
    model &&
    (providerId !== 'custom' || customUrl.trim()) &&
    (isFullMode || selectedDeckId)

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {/* Mode select */}
      {showModeSelect && onModeChange && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
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
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t(`config.mode.${m}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── AI Provider Section ── */}
      <fieldset className="space-y-3 p-3 bg-gray-50 rounded-lg">
        <legend className="text-xs font-semibold text-gray-500 uppercase px-1">{t('config.providerSection')}</legend>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('config.provider')}</label>
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:border-blue-500 bg-white"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            <option value="custom">{t('config.customEndpoint')}</option>
          </select>
        </div>

        {providerId === 'custom' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('config.customUrl')}</label>
            <input
              type="url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:border-blue-500"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('config.apiKey')}</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t('config.apiKeyPlaceholder')}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:border-blue-500"
          />
          <p className="text-xs text-gray-400 mt-0.5">{t('config.apiKeyHint')}</p>
        </div>

        {providerId !== 'custom' && models.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('config.model')}</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:border-blue-500 bg-white"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}
        {providerId === 'custom' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('config.model')}</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model-name"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:border-blue-500"
            />
          </div>
        )}
      </fieldset>

      {/* ── Content Section ── */}
      <fieldset className="space-y-3 p-3 bg-blue-50/50 rounded-lg border border-blue-100">
        <legend className="text-xs font-semibold text-blue-600 uppercase px-1">{t('config.contentSection')}</legend>

        {/* Deck selector (cards_only mode) */}
        {!isFullMode && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('config.targetDeck')}</label>
            <select
              value={selectedDeckId}
              onChange={(e) => setSelectedDeckId(e.target.value)}
              className={`w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-blue-500 bg-white ${
                !selectedDeckId ? 'border-red-300' : 'border-gray-300'
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
              <p className="text-xs text-red-500 mt-0.5">{t('config.selectDeckRequired')}</p>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('config.topic')}</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t('config.topicPlaceholder')}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('config.contentLang')}</label>
          <select
            value={contentLang}
            onChange={(e) => setContentLang(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:border-blue-500 bg-white"
          >
            {CONTENT_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label ?? t(l.labelKey!)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {t('config.cardCount')}: {cardCount}
          </label>
          <input
            type="range"
            min={10}
            max={50}
            step={5}
            value={cardCount}
            onChange={(e) => setCardCount(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>10</span>
            <span>50</span>
          </div>
        </div>
      </fieldset>

      {/* ── Template Config (full mode only) ── */}
      {isFullMode && (
        <fieldset className="space-y-3 p-3 bg-purple-50/50 rounded-lg border border-purple-100">
          <legend className="text-xs font-semibold text-purple-600 uppercase px-1">{t('config.templateSection')}</legend>

          {/* Field mode: auto vs manual */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">{t('config.fieldConfig')}</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setFieldMode('auto')}
                className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer text-left ${
                  fieldMode === 'auto'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="font-medium">{t('config.fieldAuto')}</span>
                <span className="block text-[10px] text-gray-400 mt-0.5">{t('config.fieldAutoDesc')}</span>
              </button>
              <button
                type="button"
                onClick={() => setFieldMode('manual')}
                className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer text-left ${
                  fieldMode === 'manual'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="font-medium">{t('config.fieldManual')}</span>
                <span className="block text-[10px] text-gray-400 mt-0.5">{t('config.fieldManualDesc')}</span>
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
                    className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded outline-none focus:border-purple-500"
                  />
                  <select
                    value={field.side}
                    onChange={(e) => updateCustomField(i, { side: e.target.value as 'front' | 'back' })}
                    className="px-2 py-1.5 text-xs border border-gray-200 rounded outline-none bg-white"
                  >
                    <option value="front">{t('config.front')}</option>
                    <option value="back">{t('config.back')}</option>
                  </select>
                  {customFields.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeCustomField(i)}
                      className="text-red-400 hover:text-red-600 text-xs cursor-pointer px-1"
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
            <label className="block text-xs font-medium text-gray-600 mb-1.5">{t('config.layoutMode')}</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setUseCustomHtml(false)}
                className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer text-left ${
                  !useCustomHtml
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="font-medium">{t('config.layoutDefault')}</span>
                <span className="block text-[10px] text-gray-400 mt-0.5">{t('config.layoutDefaultDesc')}</span>
              </button>
              <button
                type="button"
                onClick={() => setUseCustomHtml(true)}
                className={`px-2.5 py-2 text-xs rounded-lg border transition cursor-pointer text-left ${
                  useCustomHtml
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="font-medium">{t('config.layoutCustom')}</span>
                <span className="block text-[10px] text-gray-400 mt-0.5">{t('config.layoutCustomDesc')}</span>
              </button>
            </div>
          </div>
        </fieldset>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t('config.startGenerate')}
      </button>
    </form>
  )
}
