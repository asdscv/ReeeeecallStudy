import { create } from 'zustand'
import i18next from 'i18next'
import { callAI } from '../lib/ai/ai-client'
import { aiConfigManager } from '../lib/ai/secure-storage'
import { useAuthStore } from './auth-store'
import { buildTemplatePrompt, buildDeckPrompt, buildCardsPrompt, type FieldHint } from '../lib/ai/prompts'
import { validateTemplateResponse, validateDeckResponse, validateCardsResponse } from '../lib/ai/validators'
import { supabase } from '../lib/supabase'
import { useTemplateStore } from './template-store'
import { useDeckStore } from './deck-store'
import { useCardStore } from './card-store'
import type {
  GenerateMode,
  GenerateStep,
  GeneratedTemplate,
  GeneratedDeck,
  GeneratedCard,
  AIConfig,
} from '../lib/ai/types'

interface AIGenerateState {
  mode: GenerateMode
  topic: string
  cardCount: number
  useCustomHtml: boolean
  contentLang: string
  fieldHints: FieldHint[]

  existingTemplateId: string | null
  existingDeckId: string | null

  generatedTemplate: GeneratedTemplate | null
  generatedDeck: GeneratedDeck | null
  generatedCards: GeneratedCard[] | null
  filteredCardCount: number

  createdTemplateId: string | null
  createdDeckId: string | null

  currentStep: GenerateStep
  progress: { done: number; total: number }
  error: string | null

  // Actions
  setConfig: (cfg: { mode: GenerateMode; topic: string; cardCount: number; useCustomHtml: boolean; contentLang?: string; fieldHints?: FieldHint[]; existingTemplateId?: string | null; existingDeckId?: string | null }) => void
  generateTemplate: () => Promise<void>
  generateDeck: () => Promise<void>
  generateCards: () => Promise<void>
  saveAll: () => Promise<void>

  editGeneratedTemplate: (t: GeneratedTemplate) => void
  editGeneratedDeck: (d: GeneratedDeck) => void
  editGeneratedCards: (cards: GeneratedCard[]) => void
  removeGeneratedCard: (index: number) => void

  reset: () => void
}

const initialState = {
  mode: 'full' as GenerateMode,
  topic: '',
  cardCount: 20,
  useCustomHtml: false,
  contentLang: '',
  fieldHints: [] as FieldHint[],
  existingTemplateId: null as string | null,
  existingDeckId: null as string | null,
  generatedTemplate: null as GeneratedTemplate | null,
  generatedDeck: null as GeneratedDeck | null,
  generatedCards: null as GeneratedCard[] | null,
  filteredCardCount: 0,
  createdTemplateId: null as string | null,
  createdDeckId: null as string | null,
  currentStep: 'config' as GenerateStep,
  progress: { done: 0, total: 0 },
  error: null as string | null,
}

// In-memory cache: set by ConfigStep on submit, used by generate actions.
// This avoids a storage round-trip race between save and the first load.
let _cachedAIConfig: AIConfig | null = null

export function setAIConfigCache(config: AIConfig): void {
  _cachedAIConfig = config
}

async function getConfig(): Promise<AIConfig> {
  // 1. Use in-memory cache first (set right before generation starts)
  if (_cachedAIConfig?.apiKey) return _cachedAIConfig

  // 2. Fallback to encrypted storage
  const uid = useAuthStore.getState().user?.id
  if (!uid) throw new Error('NO_API_KEY')
  const config = await aiConfigManager.load(uid)
  if (!config || !config.apiKey) throw new Error('NO_API_KEY')
  _cachedAIConfig = config
  return config
}

// Fallback strings in case the ai-generate i18n namespace isn't loaded (e.g. mobile)
const ERROR_FALLBACKS: Record<string, string> = {
  noApiKey: 'Please set up your AI API key first.',
  invalidApiKey: 'Invalid API key. Please check your key.',
  rateLimited: 'Rate limited. Please wait a moment and try again.',
  invalidResponse: 'AI returned an invalid response. Please try again.',
  networkError: 'Network error. This might be a CORS issue — try a different provider or check your API key.',
  serverError: 'AI server error (500). Please try again later.',
}

function t(key: string): string {
  const result = i18next.t(`ai-generate:errors.${key}`)
  // i18next returns the key itself if namespace is missing
  if (result === `ai-generate:errors.${key}` || !result) return ERROR_FALLBACKS[key] ?? key
  return result
}

function mapError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === 'NO_API_KEY') return t('noApiKey')
  if (msg === 'INVALID_API_KEY') return t('invalidApiKey')
  if (msg === 'RATE_LIMITED') return t('rateLimited')
  if (msg === 'INVALID_RESPONSE' || msg === 'ALL_CARDS_INVALID') return t('invalidResponse')
  if (msg === 'SERVER_ERROR') return t('serverError')
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return t('networkError')
  return msg
}

export const useAIGenerateStore = create<AIGenerateState>((set, get) => ({
  ...initialState,

  setConfig: (cfg) => {
    set({
      mode: cfg.mode,
      topic: cfg.topic,
      cardCount: cfg.cardCount,
      useCustomHtml: cfg.useCustomHtml,
      contentLang: cfg.contentLang ?? '',
      fieldHints: cfg.fieldHints ?? [],
      existingTemplateId: cfg.existingTemplateId ?? null,
      existingDeckId: cfg.existingDeckId ?? null,
    })
  },

  generateTemplate: async () => {
    set({ currentStep: 'generating_template', error: null })
    try {
      const config = await getConfig()
      const uiLang = i18next.language
      const { topic, useCustomHtml, contentLang, fieldHints } = get()
      const { systemPrompt, userPrompt } = buildTemplatePrompt(
        topic, uiLang, useCustomHtml,
        contentLang || undefined,
        fieldHints.length > 0 ? fieldHints : undefined,
      )
      const data = await callAI(config, { systemPrompt, userPrompt })
      const template = validateTemplateResponse(data)
      // Throttle: wait before next step to avoid rate limits on low-tier APIs
      await new Promise((r) => setTimeout(r, 3000))
      set({ generatedTemplate: template, currentStep: 'review_template' })
    } catch (err) {
      set({ error: mapError(err), currentStep: 'error' })
    }
  },

  generateDeck: async () => {
    set({ currentStep: 'generating_deck', error: null })
    try {
      const config = await getConfig()
      const uiLang = i18next.language
      const { topic } = get()
      const { systemPrompt, userPrompt } = buildDeckPrompt(topic, uiLang)
      const data = await callAI(config, { systemPrompt, userPrompt })
      const deck = validateDeckResponse(data)
      await new Promise((r) => setTimeout(r, 3000))
      set({ generatedDeck: deck, currentStep: 'review_deck' })
    } catch (err) {
      set({ error: mapError(err), currentStep: 'error' })
    }
  },

  generateCards: async () => {
    set({ currentStep: 'generating_cards', error: null })
    try {
      const config = await getConfig()
      const { topic, cardCount, mode, existingDeckId, generatedTemplate, existingTemplateId } = get()

      // Get field definitions
      let fields: { key: string; name: string; type: 'text'; order: number; tts_enabled?: boolean; tts_lang?: string }[] | undefined = generatedTemplate?.fields
      if (!fields && existingTemplateId) {
        // Try from store first, then fetch from DB if empty
        let templates = useTemplateStore.getState().templates
        if (templates.length === 0) {
          await useTemplateStore.getState().fetchTemplates()
          templates = useTemplateStore.getState().templates
        }
        let tmpl = templates.find((t) => t.id === existingTemplateId)
        // If still not found, fetch directly
        if (!tmpl) {
          const { data } = await supabase
            .from('card_templates')
            .select('*')
            .eq('id', existingTemplateId)
            .single()
          if (data) tmpl = data as typeof tmpl
        }
        fields = tmpl?.fields
          .filter((f) => f.type === 'text')
          .map((f) => ({ ...f, type: 'text' as const }))
      }
      if (!fields || fields.length === 0) throw new Error('INVALID_RESPONSE')

      // Get existing cards for dedup in cards_only mode
      let existingCards: Record<string, string>[] | undefined
      if (mode === 'cards_only' && existingDeckId) {
        // Fetch existing cards from DB to get accurate dedup
        await useCardStore.getState().fetchCards(existingDeckId)
        const cards = useCardStore.getState().cards
        if (cards.length > 0) {
          existingCards = cards.map((c) => c.field_values)
        }
      }

      // Generate in batches if needed
      const allCards: GeneratedCard[] = []
      let totalFiltered = 0
      const batchSize = 25
      const batches = Math.ceil(cardCount / batchSize)

      for (let i = 0; i < batches; i++) {
        const remaining = cardCount - allCards.length
        const count = Math.min(batchSize, remaining)
        if (count <= 0) break

        const combined = existingCards
          ? [...existingCards, ...allCards.map((c) => c.field_values)]
          : allCards.length > 0 ? allCards.map((c) => c.field_values) : undefined

        // Throttle between batches to avoid rate limits (especially low-tier APIs)
        if (i > 0) await new Promise((r) => setTimeout(r, 3000))

        const { systemPrompt, userPrompt } = buildCardsPrompt(topic, fields, count, combined)
        const data = await callAI(config, { systemPrompt, userPrompt })
        const fieldKeys = fields.map((f) => f.key)
        const result = validateCardsResponse(data, fieldKeys)
        allCards.push(...result.valid)
        totalFiltered += result.filtered

        set({ progress: { done: allCards.length, total: cardCount } })
      }

      set({
        generatedCards: allCards,
        filteredCardCount: totalFiltered,
        currentStep: 'review_cards',
      })
    } catch (err) {
      set({ error: mapError(err), currentStep: 'error' })
    }
  },

  saveAll: async () => {
    set({ currentStep: 'saving', error: null, progress: { done: 0, total: 0 } })
    try {
      const { mode, generatedTemplate, generatedDeck, generatedCards, existingTemplateId, existingDeckId } = get()

      let templateId = existingTemplateId
      let deckId = existingDeckId

      // Save template (full mode only)
      if (mode === 'full' && generatedTemplate) {
        const tmpl = await useTemplateStore.getState().createTemplate({
          name: generatedTemplate.name,
          fields: generatedTemplate.fields,
          front_layout: generatedTemplate.front_layout,
          back_layout: generatedTemplate.back_layout,
          layout_mode: generatedTemplate.layout_mode,
          front_html: generatedTemplate.front_html,
          back_html: generatedTemplate.back_html,
        })
        if (!tmpl) throw new Error(useTemplateStore.getState().error || 'Failed to save template')
        templateId = tmpl.id
        set({ createdTemplateId: tmpl.id })
      }

      // Save deck (full mode only)
      if (mode === 'full' && generatedDeck) {
        const deck = await useDeckStore.getState().createDeck({
          name: generatedDeck.name,
          description: generatedDeck.description,
          color: generatedDeck.color,
          icon: generatedDeck.icon,
          default_template_id: templateId ?? undefined,
        })
        if (!deck) throw new Error(useDeckStore.getState().error || 'Failed to save deck')
        deckId = deck.id
        set({ createdDeckId: deck.id })
      }

      // Save cards
      if (generatedCards && generatedCards.length > 0 && deckId && templateId) {
        // Dedup for cards_only (adding to existing deck)
        let cardsToSave = generatedCards
        if (mode === 'cards_only') {
          const existingCards = useCardStore.getState().cards
          if (existingCards.length > 0) {
            const existingKeys = new Set(
              existingCards.map((c) => JSON.stringify(c.field_values)),
            )
            cardsToSave = generatedCards.filter(
              (c) => !existingKeys.has(JSON.stringify(c.field_values)),
            )
          }
        }

        if (cardsToSave.length > 0) {
          const totalInserted = await useCardStore.getState().createCards({
            deck_id: deckId,
            template_id: templateId,
            cards: cardsToSave.map((c) => ({
              field_values: c.field_values,
              tags: c.tags,
            })),
            onProgress: (done, total) => set({ progress: { done, total } }),
          })
          if (totalInserted === 0 && useCardStore.getState().error) {
            throw new Error(useCardStore.getState().error!)
          }
        }
      }

      set({ currentStep: 'done' })
    } catch (err) {
      set({ error: mapError(err), currentStep: 'error' })
    }
  },

  editGeneratedTemplate: (t) => set({ generatedTemplate: t }),
  editGeneratedDeck: (d) => set({ generatedDeck: d }),
  editGeneratedCards: (cards) => set({ generatedCards: cards }),
  removeGeneratedCard: (index) => {
    const cards = get().generatedCards
    if (!cards) return
    set({ generatedCards: cards.filter((_, i) => i !== index) })
  },

  reset: () => {
    _cachedAIConfig = null
    set({ ...initialState })
  },
}))
