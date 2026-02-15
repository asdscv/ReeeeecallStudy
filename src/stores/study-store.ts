import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { calculateSRS, type SrsRating } from '../lib/srs'
import type { Card, CardTemplate, StudyMode, DeckStudyState, SrsSettings } from '../types/database'

type Phase = 'idle' | 'loading' | 'studying' | 'completed'

interface StudyConfig {
  deckId: string
  mode: StudyMode
  batchSize: number
  uploadDateStart?: string
  uploadDateEnd?: string
}

interface SessionStats {
  totalCards: number
  cardsStudied: number
  ratings: Record<string, number>
  totalDurationMs: number
}

interface StudyState {
  phase: Phase
  config: StudyConfig | null
  template: CardTemplate | null
  srsSettings: SrsSettings | null
  queue: Card[]
  currentIndex: number
  isFlipped: boolean
  cardStartTime: number
  sessionStats: SessionStats
  studyState: DeckStudyState | null

  initSession: (config: StudyConfig) => Promise<void>
  flipCard: () => void
  rateCard: (rating: string) => Promise<void>
  endSession: () => Promise<void>
  reset: () => void
}

const initialStats: SessionStats = {
  totalCards: 0,
  cardsStudied: 0,
  ratings: {},
  totalDurationMs: 0,
}

export const useStudyStore = create<StudyState>((set, get) => ({
  phase: 'idle',
  config: null,
  template: null,
  srsSettings: null,
  queue: [],
  currentIndex: 0,
  isFlipped: false,
  cardStartTime: Date.now(),
  sessionStats: { ...initialStats },
  studyState: null,

  initSession: async (config: StudyConfig) => {
    set({ phase: 'loading', config })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { set({ phase: 'idle' }); return }

    // Fetch deck template and srs_settings
    const { data: deck } = await supabase
      .from('decks')
      .select('default_template_id, srs_settings')
      .eq('id', config.deckId)
      .single()

    const deckData = deck as { default_template_id: string | null; srs_settings: SrsSettings | null } | null
    const srsSettings = deckData?.srs_settings ?? null

    let template: CardTemplate | null = null
    if (deckData && deckData.default_template_id) {
      const { data: tmpl } = await supabase
        .from('card_templates')
        .select('*')
        .eq('id', deckData.default_template_id)
        .single()
      template = tmpl as CardTemplate | null
    }

    // Fetch or create deck_study_state
    let { data: studyState } = await supabase
      .from('deck_study_state')
      .select('*')
      .eq('deck_id', config.deckId)
      .eq('user_id', user.id)
      .single()

    if (!studyState) {
      const { data: created } = await supabase
        .from('deck_study_state')
        .insert({
          user_id: user.id,
          deck_id: config.deckId,
          new_start_pos: 0,
          review_start_pos: 0,
          new_batch_size: 20,
          review_batch_size: 50,
          sequential_pos: 0,
        } as Record<string, unknown>)
        .select()
        .single()
      studyState = created
    }

    const typedStudyState = studyState as DeckStudyState | null

    // Build card queue based on mode
    let cards: Card[] = []
    const now = new Date().toISOString()

    switch (config.mode) {
      case 'srs': {
        // learning cards due now
        const { data: learning } = await supabase
          .from('cards')
          .select('*')
          .eq('deck_id', config.deckId)
          .eq('srs_status', 'learning')
          .lte('next_review_at', now)
          .order('next_review_at', { ascending: true })

        // review cards due now
        const { data: review } = await supabase
          .from('cards')
          .select('*')
          .eq('deck_id', config.deckId)
          .eq('srs_status', 'review')
          .lte('next_review_at', now)
          .order('next_review_at', { ascending: true })

        // new cards
        const { data: newCards } = await supabase
          .from('cards')
          .select('*')
          .eq('deck_id', config.deckId)
          .eq('srs_status', 'new')
          .order('sort_position', { ascending: true })
          .limit(config.batchSize)

        cards = [
          ...((learning ?? []) as Card[]),
          ...((review ?? []) as Card[]),
          ...((newCards ?? []) as Card[]),
        ]
        break
      }

      case 'sequential_review': {
        if (!typedStudyState) break
        // new cards from new_start_pos
        const { data: newCards } = await supabase
          .from('cards')
          .select('*')
          .eq('deck_id', config.deckId)
          .gte('sort_position', typedStudyState.new_start_pos)
          .eq('srs_status', 'new')
          .order('sort_position', { ascending: true })
          .limit(typedStudyState.new_batch_size)

        // review cards in [review_start_pos, new_start_pos)
        const { data: reviewCards } = await supabase
          .from('cards')
          .select('*')
          .eq('deck_id', config.deckId)
          .gte('sort_position', typedStudyState.review_start_pos)
          .lt('sort_position', typedStudyState.new_start_pos)
          .neq('srs_status', 'suspended')
          .order('sort_position', { ascending: true })
          .limit(typedStudyState.review_batch_size)

        cards = [
          ...((newCards ?? []) as Card[]),
          ...((reviewCards ?? []) as Card[]),
        ]
        break
      }

      case 'random': {
        let query = supabase
          .from('cards')
          .select('*')
          .eq('deck_id', config.deckId)
          .neq('srs_status', 'suspended')

        if (config.uploadDateStart) {
          query = query.gte('created_at', config.uploadDateStart)
        }
        if (config.uploadDateEnd) {
          query = query.lte('created_at', config.uploadDateEnd)
        }

        const { data: allCards } = await query
        const shuffled = shuffleArray((allCards ?? []) as Card[])
        cards = shuffled.slice(0, config.batchSize)
        break
      }

      case 'sequential': {
        if (!typedStudyState) break
        const { data: seqCards } = await supabase
          .from('cards')
          .select('*')
          .eq('deck_id', config.deckId)
          .neq('srs_status', 'suspended')
          .gte('sort_position', typedStudyState.sequential_pos)
          .order('sort_position', { ascending: true })
          .limit(config.batchSize)

        cards = (seqCards ?? []) as Card[]
        break
      }

      case 'by_date': {
        let query = supabase
          .from('cards')
          .select('*')
          .eq('deck_id', config.deckId)
          .neq('srs_status', 'suspended')

        if (config.uploadDateStart) {
          query = query.gte('created_at', config.uploadDateStart)
        }
        if (config.uploadDateEnd) {
          query = query.lte('created_at', config.uploadDateEnd)
        }

        const { data: dateCards } = await query.order('sort_position', { ascending: true })
        cards = (dateCards ?? []) as Card[]
        break
      }
    }

    if (cards.length === 0) {
      set({
        phase: 'completed',
        template,
        srsSettings,
        queue: [],
        studyState: typedStudyState,
        sessionStats: { ...initialStats, totalCards: 0 },
      })
      return
    }

    set({
      phase: 'studying',
      template,
      srsSettings,
      queue: cards,
      studyState: typedStudyState,
      currentIndex: 0,
      isFlipped: false,
      cardStartTime: Date.now(),
      sessionStats: { ...initialStats, totalCards: cards.length },
    })
  },

  flipCard: () => {
    set((state) => ({ isFlipped: !state.isFlipped }))
  },

  rateCard: async (rating: string) => {
    const { queue, currentIndex, config, cardStartTime, sessionStats, srsSettings } = get()
    if (!config) return

    const card = queue[currentIndex]
    if (!card) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const durationMs = Date.now() - cardStartTime
    let newInterval = card.interval_days
    let newEase = card.ease_factor

    // SRS mode: update card SRS fields
    if (config.mode === 'srs') {
      const srsResult = calculateSRS(card, rating as SrsRating, srsSettings ?? undefined)
      newInterval = srsResult.interval_days
      newEase = srsResult.ease_factor

      await supabase
        .from('cards')
        .update({
          ease_factor: srsResult.ease_factor,
          interval_days: srsResult.interval_days,
          repetitions: srsResult.repetitions,
          srs_status: srsResult.srs_status,
          next_review_at: srsResult.next_review_at,
          last_reviewed_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('id', card.id)
    }

    // Log study
    await supabase
      .from('study_logs')
      .insert({
        user_id: user.id,
        card_id: card.id,
        deck_id: config.deckId,
        study_mode: config.mode,
        rating,
        prev_interval: card.interval_days,
        new_interval: newInterval,
        prev_ease: card.ease_factor,
        new_ease: newEase,
        review_duration_ms: durationMs,
      } as Record<string, unknown>)

    // Update stats
    const updatedRatings = { ...sessionStats.ratings }
    updatedRatings[rating] = (updatedRatings[rating] || 0) + 1

    const nextIndex = currentIndex + 1
    const isComplete = nextIndex >= queue.length

    if (isComplete) {
      set({
        sessionStats: {
          ...sessionStats,
          cardsStudied: sessionStats.cardsStudied + 1,
          ratings: updatedRatings,
          totalDurationMs: sessionStats.totalDurationMs + durationMs,
        },
        phase: 'completed',
      })
      // Run endSession logic
      await get().endSession()
    } else {
      set({
        currentIndex: nextIndex,
        isFlipped: false,
        cardStartTime: Date.now(),
        sessionStats: {
          ...sessionStats,
          cardsStudied: sessionStats.cardsStudied + 1,
          ratings: updatedRatings,
          totalDurationMs: sessionStats.totalDurationMs + durationMs,
        },
      })
    }
  },

  endSession: async () => {
    const { config, queue, studyState } = get()
    if (!config || !studyState) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Update deck_study_state based on mode
    if (config.mode === 'sequential_review' && queue.length > 0) {
      const maxPos = Math.max(...queue.map(c => c.sort_position))
      const newCards = queue.filter(c => c.srs_status === 'new')
      const newMaxPos = newCards.length > 0
        ? Math.max(...newCards.map(c => c.sort_position)) + 1
        : studyState.new_start_pos

      await supabase
        .from('deck_study_state')
        .update({
          new_start_pos: newMaxPos,
          review_start_pos: maxPos + 1,
        } as Record<string, unknown>)
        .eq('id', studyState.id)
    }

    if (config.mode === 'sequential' && queue.length > 0) {
      const maxPos = Math.max(...queue.map(c => c.sort_position))
      await supabase
        .from('deck_study_state')
        .update({
          sequential_pos: maxPos + 1,
        } as Record<string, unknown>)
        .eq('id', studyState.id)
    }

    set({ phase: 'completed' })
  },

  reset: () => {
    set({
      phase: 'idle',
      config: null,
      template: null,
      srsSettings: null,
      queue: [],
      currentIndex: 0,
      isFlipped: false,
      cardStartTime: Date.now(),
      sessionStats: { ...initialStats },
      studyState: null,
    })
  },
}))

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}
