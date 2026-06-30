import { create } from 'zustand'
import i18next from 'i18next'
import { callServerAI, getAffordableCards } from '../lib/ai/server-client'
import type { FieldHint } from '../lib/ai/prompts'
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

// Fallback strings in case the ai-generate i18n namespace isn't loaded (e.g. mobile)
const ERROR_FALLBACKS: Record<string, string> = {
  insufficientCredits: "You've used today's free AI cards and have no credits left. Top up to keep generating.",
  quotaExceeded: "You've reached today's free AI generation limit. Please try again tomorrow.",
  rateLimited: 'Rate limited. Please wait a moment and try again.',
  invalidResponse: 'AI returned an invalid response. Please try again.',
  networkError: 'Network error. Please check your connection and try again.',
  serverError: 'AI generation is temporarily unavailable. Please try again later.',
}

function t(key: string): string {
  const result = i18next.t(`ai-generate:errors.${key}`)
  // i18next returns the key itself if namespace is missing
  if (result === `ai-generate:errors.${key}` || !result) return ERROR_FALLBACKS[key] ?? key
  return result
}

function mapError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === 'AI_INSUFFICIENT_CREDITS' || msg === 'AI_QUOTA_EXCEEDED') return t('insufficientCredits')
  if (msg === 'AI_RATE_CAP' || msg === 'RATE_LIMITED') return t('rateLimited')
  if (msg === 'INVALID_RESPONSE' || msg === 'ALL_CARDS_INVALID') return t('invalidResponse')
  if (msg === 'AI_PROVIDER_ERROR' || msg === 'AI_PROVIDER_AUTH' || msg === 'AI_NOT_CONFIGURED' || msg === 'AI_METER_ERROR' || msg === 'SERVER_ERROR') {
    return t('serverError')
  }
  if (msg === 'NETWORK_ERROR' || msg.includes('Failed to fetch') || msg.includes('NetworkError')) return t('networkError')
  return t('serverError')
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
      // Fail fast before any paid call if the user can't afford a single card
      // (no free left AND no credits) — avoids wasting template + deck calls.
      // Only hard-block when the wallet is KNOWN (L1: don't block on a read blip).
      const aff = await getAffordableCards()
      if (aff.walletKnown && aff.total <= 0) throw new Error('AI_QUOTA_EXCEEDED')
      const uiLang = i18next.language
      const { topic, useCustomHtml, contentLang, fieldHints } = get()
      const { content } = await callServerAI({
        kind: 'template',
        topic,
        uiLang,
        useCustomHtml,
        contentLang: contentLang || undefined,
        fieldHints: fieldHints.length > 0 ? fieldHints : undefined,
      })
      const template = validateTemplateResponse(content)
      // Throttle: small pause before the next step keeps the multi-call flow gentle.
      await new Promise((r) => setTimeout(r, 3000))
      set({ generatedTemplate: template, currentStep: 'review_template' })
    } catch (err) {
      set({ error: mapError(err), currentStep: 'error' })
    }
  },

  generateDeck: async () => {
    set({ currentStep: 'generating_deck', error: null })
    try {
      const uiLang = i18next.language
      const { topic } = get()
      const { content } = await callServerAI({ kind: 'deck', topic, uiLang })
      const deck = validateDeckResponse(content)
      await new Promise((r) => setTimeout(r, 3000))
      set({ generatedDeck: deck, currentStep: 'review_deck' })
    } catch (err) {
      set({ error: mapError(err), currentStep: 'error' })
    }
  },

  generateCards: async () => {
    set({ currentStep: 'generating_cards', error: null })
    try {
      const uiLang = i18next.language
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

      // Phase 1: cap to what the user can afford = free remaining + credits.
      // The server is authoritative (debits atomically, 402s when short). If the
      // wallet read failed (walletKnown=false), don't cap/block — defer to server.
      const aff = await getAffordableCards()
      if (aff.walletKnown && aff.total <= 0) throw new Error('AI_QUOTA_EXCEEDED')
      const effectiveCount = aff.walletKnown ? Math.min(cardCount, aff.total) : cardCount

      // Get existing cards for dedup in cards_only mode
      let existingCards: Record<string, string>[] | undefined
      if (mode === 'cards_only' && existingDeckId) {
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
      const batches = Math.ceil(effectiveCount / batchSize)
      const fieldKeys = fields.map((f) => f.key)

      for (let i = 0; i < batches; i++) {
        const remainingCount = effectiveCount - allCards.length
        const count = Math.min(batchSize, remainingCount)
        if (count <= 0) break

        const combined = existingCards
          ? [...existingCards, ...allCards.map((c) => c.field_values)]
          : allCards.length > 0 ? allCards.map((c) => c.field_values) : undefined

        // Throttle between batches to keep the multi-call flow gentle.
        if (i > 0) await new Promise((r) => setTimeout(r, 3000))

        try {
          const { content } = await callServerAI({
            kind: 'cards',
            topic,
            uiLang,
            fields,
            cardCount: count,
            existingCards: combined,
          })
          const result = validateCardsResponse(content, fieldKeys)
          allCards.push(...result.valid)
          totalFiltered += result.filtered
        } catch (batchErr) {
          // M2: keep earlier successful batches; only fail outright if nothing
          // has been generated yet.
          if (allCards.length > 0) break
          throw batchErr
        }

        set({ progress: { done: allCards.length, total: effectiveCount } })
      }

      if (allCards.length === 0) throw new Error('INVALID_RESPONSE')
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
    set({ ...initialState })
  },
}))
