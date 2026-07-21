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
  generateCardsFromImage: (images: string[]) => Promise<void>
  generateDeckFromImage: (images: string[]) => Promise<void>
  saveAll: () => Promise<void>

  editGeneratedTemplate: (t: GeneratedTemplate) => void
  editGeneratedDeck: (d: GeneratedDeck) => void
  editGeneratedCards: (cards: GeneratedCard[]) => void
  removeGeneratedCard: (index: number) => void

  reset: () => void
  retryFromConfig: () => void
}

const initialState = {
  mode: 'full' as GenerateMode,
  topic: '',
  cardCount: 10,   // matches the free daily cap (10/day); ConfigStep further defaults to today's remaining free
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
  invalidImage: "Couldn't read that image. Please try a smaller or clearer photo.",
  quotaExceeded: "You've reached today's free AI generation limit. Please try again tomorrow.",
  rateLimited: 'Rate limited. Please wait a moment and try again.',
  invalidResponse: 'AI returned an invalid response. Please try again.',
  networkError: 'Network error. Please check your connection and try again.',
  serverError: 'AI generation is temporarily unavailable. Please try again later.',
  emptyResult: "The AI generated no cards. Please try again — you weren't charged.",
  cardLimitReached: "You've reached your card limit. Delete cards or subscribe to save more.",
  deckNotOwned: "That deck can't receive new cards. Choose a deck you own.",
}

function t(key: string): string {
  const nsKey = `errors.${key}`
  const result = i18next.t(`ai-generate:${nsKey}`)
  // On a miss i18next returns the namespace-STRIPPED key ('errors.<key>'), not the full
  // 'ai-generate:errors.<key>'. Guard against both so a missing locale key falls back to
  // the English ERROR_FALLBACKS instead of surfacing the raw key string to the user.
  if (!result || result === nsKey || result === `ai-generate:${nsKey}`) return ERROR_FALLBACKS[key] ?? key
  return result
}

function mapError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Card-limit rejection at save time (saveAll throws the card-store error key) — tell
  // the user to delete/subscribe, not "try again later" (retry would keep failing).
  if (msg === 'errors:card.limitReached' || msg === 'CARD_LIMIT_REACHED') return t('cardLimitReached')
  // Save-time ownership rejection (reserve_card_positions) — the target deck isn't the
  // user's (e.g. a subscribed deck slipped in, or it was deleted mid-flow). "Try again
  // later" would keep failing; tell the user to pick a deck they own.
  if (msg === 'deck not found or not owned') return t('deckNotOwned')
  if (msg === 'BAD_REQUEST') return t('invalidImage')
  if (msg === 'AI_INSUFFICIENT_CREDITS' || msg === 'AI_QUOTA_EXCEEDED') return t('insufficientCredits')
  if (msg === 'AI_RATE_CAP' || msg === 'RATE_LIMITED') return t('rateLimited')
  if (msg === 'INVALID_RESPONSE' || msg === 'ALL_CARDS_INVALID') return t('invalidResponse')
  // AI_EMPTY_RESULT: the server produced no cards → it RELEASED the reservation (no quota /
  // wallet was spent). Tell the user to retry, and reassure them nothing was charged.
  if (msg === 'AI_EMPTY_RESULT') return t('emptyResult')
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

  // Image recognition (vision): one uploaded image → cards (always paid, Phase 1b).
  generateCardsFromImage: async (images: string[]) => {
    set({ currentStep: 'generating_cards', error: null })
    try {
      const uiLang = i18next.language
      const { cardCount, generatedTemplate, existingTemplateId } = get()

      let fields: { key: string; name: string; type: 'text'; order: number; tts_enabled?: boolean; tts_lang?: string }[] | undefined = generatedTemplate?.fields
      if (!fields && existingTemplateId) {
        let templates = useTemplateStore.getState().templates
        if (templates.length === 0) {
          await useTemplateStore.getState().fetchTemplates()
          templates = useTemplateStore.getState().templates
        }
        let tmpl = templates.find((t) => t.id === existingTemplateId)
        if (!tmpl) {
          const { data } = await supabase.from('card_templates').select('*').eq('id', existingTemplateId).single()
          if (data) tmpl = data as typeof tmpl
        }
        fields = tmpl?.fields
          .filter((f) => f.type === 'text')
          .map((f) => ({ ...f, type: 'text' as const }))
      }
      if (!fields || fields.length === 0) throw new Error('INVALID_RESPONSE')

      const { content } = await callServerAI({ kind: 'image', images, uiLang, fields, cardCount })
      const result = validateCardsResponse(content, fields.map((f) => f.key))
      if (result.valid.length === 0) throw new Error('ALL_CARDS_INVALID')
      set({
        generatedCards: result.valid,
        filteredCardCount: result.filtered,
        currentStep: 'review_cards',
      })
    } catch (err) {
      set({ error: mapError(err), currentStep: 'error' })
    }
  },

  // Image → a COMPLETE new deck in one vision call (kind='image_deck', always paid):
  // recognizes the image and returns deck metadata + template + cards. We set all
  // three generated states (mode='full') and route to card review; saveAll then
  // creates the deck + template + cards. Default front/back layouts are injected when
  // the model omits them (front = first field, back = the rest).
  generateDeckFromImage: async (images: string[]) => {
    set({ currentStep: 'generating_deck', error: null })
    try {
      const uiLang = i18next.language
      const { content } = await callServerAI({ kind: 'image_deck', images, uiLang })
      const deck = validateDeckResponse(content)

      const rawTmpl = ((content as Record<string, unknown>)?.template ?? {}) as Record<string, unknown>
      // Mirror validateFields' normalization (drop non-objects, cap at 6) and its rekeying
      // rule (any key not already 'field_'-prefixed becomes field_<i>) so we know the
      // template keys BEFORE validation. The single vision call keys both the template
      // fields and each card's field_values by semantic names (front/back/term/…), so we
      // must (a) build object layouts against the REKEYED keys — bare strings are dropped
      // by validateLayout, and (b) remap card field_values from the raw semantic key to the
      // rekeyed key by position, or validateCardsResponse filters every card out.
      const normFields = (Array.isArray(rawTmpl.fields) ? rawTmpl.fields : [])
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .slice(0, 6)
      const rawKeys = normFields.map((f) => (typeof f.key === 'string' ? f.key : ''))
      const effectiveKeys = rawKeys.map((k, i) => (k.startsWith('field_') ? k : `field_${i}`))

      const template = validateTemplateResponse({
        name: typeof rawTmpl.name === 'string' && rawTmpl.name ? rawTmpl.name : deck.name,
        fields: normFields,
        front_layout: Array.isArray(rawTmpl.front_layout) && rawTmpl.front_layout.length
          ? rawTmpl.front_layout
          : effectiveKeys.slice(0, 1).map((k) => ({ field_key: k, style: 'primary' })),
        back_layout: Array.isArray(rawTmpl.back_layout) && rawTmpl.back_layout.length
          ? rawTmpl.back_layout
          : effectiveKeys.slice(1).map((k) => ({ field_key: k, style: 'primary' })),
      })

      const rawCards = Array.isArray((content as Record<string, unknown>)?.cards)
        ? ((content as Record<string, unknown>).cards as Array<Record<string, unknown>>)
        : []
      const remapped = {
        cards: rawCards.map((card) => {
          const fv = (card?.field_values ?? {}) as Record<string, unknown>
          const field_values: Record<string, unknown> = {}
          effectiveKeys.forEach((ek, i) => {
            const rawKey = rawKeys[i]
            field_values[ek] = fv[ek] ?? (rawKey ? fv[rawKey] : undefined) ?? ''
          })
          return { ...card, field_values }
        }),
      }
      const result = validateCardsResponse(remapped, template.fields.map((f) => f.key))
      if (result.valid.length === 0) throw new Error('ALL_CARDS_INVALID')

      set({
        mode: 'full',
        generatedDeck: deck,
        generatedTemplate: template,
        generatedCards: result.valid,
        filteredCardCount: result.filtered,
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

  // Return to the config step for another attempt, PRESERVING the user's config
  // (topic/count/language/hints/mode/existing ids). Only the generated results,
  // progress, and error are cleared — a full reset() would dump the user back to a
  // blank form and discard everything they typed, which is punishing after a paid
  // image error where they'd also have to re-pick the image.
  retryFromConfig: () => {
    set({
      generatedTemplate: null,
      generatedDeck: null,
      generatedCards: null,
      filteredCardCount: 0,
      createdTemplateId: null,
      createdDeckId: null,
      currentStep: 'config',
      progress: { done: 0, total: 0 },
      error: null,
    })
  },
}))
