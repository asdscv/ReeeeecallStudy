import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { calculateSRS, type SrsRating } from '../lib/srs'
import { buildSequentialReviewQueue, computeSequentialReviewPositions } from '../lib/study-session-utils'
import { SrsQueueManager, type QueueCard } from '../lib/study-queue'
import { guard } from '../lib/rate-limit-instance'
import { getSrsSource, mergeCardWithProgress, type SrsSource, type UserCardProgress } from '../lib/srs-access'
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
  sessionStartedAt: number
  sessionStats: SessionStats
  studyState: DeckStudyState | null
  srsSource: SrsSource
  srsQueueManager: SrsQueueManager | null
  maxCardPosition: number

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
  sessionStartedAt: Date.now(),
  sessionStats: { ...initialStats },
  studyState: null,
  srsSource: 'embedded',
  srsQueueManager: null,
  maxCardPosition: 0,

  initSession: async (config: StudyConfig) => {
    const check = guard.check('study_session_start', 'study_sessions_daily')
    if (!check.allowed) { set({ phase: 'idle' }); return }

    set({ phase: 'loading', config })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { set({ phase: 'idle' }); return }

    // Fetch deck template, srs_settings, and sharing info
    const { data: deck } = await supabase
      .from('decks')
      .select('default_template_id, srs_settings, share_mode, user_id, source_owner_id')
      .eq('id', config.deckId)
      .single()

    const deckData = deck as { default_template_id: string | null; srs_settings: SrsSettings | null; share_mode: string | null; user_id: string; source_owner_id: string | null } | null
    const srsSettings = deckData?.srs_settings ?? null

    // Determine SRS source (embedded vs progress_table)
    const srsSource = deckData
      ? getSrsSource({ share_mode: deckData.share_mode, user_id: deckData.user_id, source_owner_id: deckData.source_owner_id }, user.id)
      : 'embedded' as SrsSource

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

    // Get max card position for wrap-around calculations
    const { data: maxPosData } = await supabase
      .from('cards')
      .select('sort_position')
      .eq('deck_id', config.deckId)
      .order('sort_position', { ascending: false })
      .limit(1)
      .single()
    const maxCardPosition = (maxPosData as { sort_position: number } | null)?.sort_position ?? 0

    // Build card queue based on mode
    let cards: Card[] = []
    let srsQueueManager: SrsQueueManager | null = null
    const now = new Date().toISOString()

    switch (config.mode) {
      case 'srs': {
        // Fetch user's daily_new_limit from profile
        let newCardLimit = config.batchSize
        const { data: profile } = await supabase
          .from('profiles')
          .select('daily_new_limit')
          .eq('id', user.id)
          .single()
        if (profile && (profile as { daily_new_limit: number }).daily_new_limit) {
          newCardLimit = (profile as { daily_new_limit: number }).daily_new_limit
        }

        // Count new cards already studied today (across all sessions)
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        const { count: todayNewCount } = await supabase
          .from('study_logs')
          .select('*', { count: 'exact', head: true })
          .eq('deck_id', config.deckId)
          .eq('user_id', user.id)
          .eq('study_mode', 'srs')
          .gte('studied_at', todayStart.toISOString())

        // Remaining new cards for today
        const remainingNewToday = Math.max(0, newCardLimit - (todayNewCount ?? 0))

        if (srsSource === 'progress_table') {
          const { data: allCards } = await supabase
            .from('cards')
            .select('*')
            .eq('deck_id', config.deckId)
            .order('sort_position', { ascending: true })

          const { data: progressData } = await supabase
            .from('user_card_progress')
            .select('*')
            .eq('deck_id', config.deckId)
            .eq('user_id', user.id)

          const progressMap = new Map<string, UserCardProgress>()
          for (const p of (progressData ?? []) as UserCardProgress[]) {
            progressMap.set(p.card_id, p)
          }

          const mergedCards = ((allCards ?? []) as Card[]).map((card) => {
            const progress = progressMap.get(card.id)
            return mergeCardWithProgress(card, progress) as Card
          })

          const learning = mergedCards.filter(
            (c) => c.srs_status === 'learning' && c.next_review_at && c.next_review_at <= now
          )
          const review = mergedCards.filter(
            (c) => c.srs_status === 'review' && c.next_review_at && c.next_review_at <= now
          )
          const newC = mergedCards.filter((c) => c.srs_status === 'new').slice(0, remainingNewToday)

          cards = [...learning, ...review, ...newC]
        } else {
          // Embedded: original path
          const { data: learning } = await supabase
            .from('cards')
            .select('*')
            .eq('deck_id', config.deckId)
            .eq('srs_status', 'learning')
            .lte('next_review_at', now)
            .order('next_review_at', { ascending: true })

          const { data: review } = await supabase
            .from('cards')
            .select('*')
            .eq('deck_id', config.deckId)
            .eq('srs_status', 'review')
            .lte('next_review_at', now)
            .order('next_review_at', { ascending: true })

          const { data: newCards } = await supabase
            .from('cards')
            .select('*')
            .eq('deck_id', config.deckId)
            .eq('srs_status', 'new')
            .order('sort_position', { ascending: true })
            .limit(remainingNewToday)

          cards = [
            ...((learning ?? []) as Card[]),
            ...((review ?? []) as Card[]),
            ...((newCards ?? []) as Card[]),
          ]
        }

        // Create SRS queue manager for intra-session requeue
        if (cards.length > 0) {
          const queueCards: QueueCard[] = cards.map(c => ({
            id: c.id,
            srs_status: c.srs_status,
            ease_factor: c.ease_factor,
            interval_days: c.interval_days,
            repetitions: c.repetitions,
          }))
          srsQueueManager = new SrsQueueManager(queueCards, srsSettings ?? undefined)
        }
        break
      }

      case 'sequential_review': {
        if (!typedStudyState) break

        // Fetch all cards for this deck
        const { data: allDeckCards } = await supabase
          .from('cards')
          .select('*')
          .eq('deck_id', config.deckId)
          .order('sort_position', { ascending: true })

        const allCards = (allDeckCards ?? []) as Card[]

        const { newCards, reviewCards } = buildSequentialReviewQueue(
          allCards.map(c => ({ id: c.id, sort_position: c.sort_position, srs_status: c.srs_status })),
          typedStudyState,
          Number.MAX_SAFE_INTEGER,  // All new cards — never limit
          config.batchSize,         // User's batch size controls review cards
        )

        // Map back to full Card objects
        const cardMap = new Map(allCards.map(c => [c.id, c]))
        const newCardsFull = newCards.map(c => cardMap.get(c.id)!).filter(Boolean)
        const reviewCardsFull = reviewCards.map(c => cardMap.get(c.id)!).filter(Boolean)

        cards = [...newCardsFull, ...reviewCardsFull]
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

        // Try from current position
        const { data: seqCards } = await supabase
          .from('cards')
          .select('*')
          .eq('deck_id', config.deckId)
          .neq('srs_status', 'suspended')
          .gte('sort_position', typedStudyState.sequential_pos)
          .order('sort_position', { ascending: true })
          .limit(config.batchSize)

        cards = (seqCards ?? []) as Card[]

        // Wrap around if no cards found
        if (cards.length === 0) {
          const { data: wrapCards } = await supabase
            .from('cards')
            .select('*')
            .eq('deck_id', config.deckId)
            .neq('srs_status', 'suspended')
            .order('sort_position', { ascending: true })
            .limit(config.batchSize)

          cards = (wrapCards ?? []) as Card[]
        }
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
        srsSource,
        queue: [],
        studyState: typedStudyState,
        srsQueueManager: null,
        maxCardPosition,
        sessionStats: { ...initialStats, totalCards: 0 },
      })
      return
    }

    guard.recordSuccess('study_sessions_daily')
    set({
      phase: 'studying',
      template,
      srsSettings,
      srsSource,
      queue: cards,
      studyState: typedStudyState,
      srsQueueManager,
      maxCardPosition,
      currentIndex: 0,
      isFlipped: false,
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      sessionStats: { ...initialStats, totalCards: cards.length },
    })
  },

  flipCard: () => {
    set((state) => ({ isFlipped: !state.isFlipped }))
  },

  rateCard: async (rating: string) => {
    const { queue, currentIndex, config, cardStartTime, sessionStats, srsSettings, srsSource, srsQueueManager } = get()
    if (!config) return

    // Determine current card based on mode
    const isSrsMode = config.mode === 'srs' && srsQueueManager
    const card = isSrsMode
      ? (() => {
          const qc = srsQueueManager!.currentCard()
          return qc ? queue.find(c => c.id === qc.id) ?? queue[currentIndex] : queue[currentIndex]
        })()
      : queue[currentIndex]

    if (!card) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const durationMs = Date.now() - cardStartTime
    let newInterval = card.interval_days
    let newEase = card.ease_factor
    let updatedQueue = queue

    // SRS mode: update card SRS fields
    if (config.mode === 'srs') {
      const srsResult = calculateSRS(card, rating as SrsRating, srsSettings ?? undefined)
      newInterval = srsResult.interval_days
      newEase = srsResult.ease_factor

      if (srsSource === 'progress_table') {
        await supabase
          .from('user_card_progress')
          .upsert({
            user_id: user.id,
            card_id: card.id,
            deck_id: config.deckId,
            ease_factor: srsResult.ease_factor,
            interval_days: srsResult.interval_days,
            repetitions: srsResult.repetitions,
            srs_status: srsResult.srs_status,
            next_review_at: srsResult.next_review_at,
            last_reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as Record<string, unknown>, { onConflict: 'user_id,card_id' })
      } else {
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

      // Update card data in queue so requeued cards show correct SRS state
      const queueIndex = queue.findIndex(c => c.id === card.id)
      if (queueIndex >= 0) {
        updatedQueue = [...queue]
        updatedQueue[queueIndex] = {
          ...updatedQueue[queueIndex],
          ease_factor: srsResult.ease_factor,
          interval_days: srsResult.interval_days,
          repetitions: srsResult.repetitions,
          srs_status: srsResult.srs_status as Card['srs_status'],
          next_review_at: srsResult.next_review_at,
          last_reviewed_at: new Date().toISOString(),
        }
      }

      // Advance the SRS queue manager (handles requeue for 'again')
      if (srsQueueManager) {
        srsQueueManager.rateCard(rating as SrsRating)
      }
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

    // Determine if session is complete
    const isComplete = isSrsMode
      ? srsQueueManager!.isComplete()
      : currentIndex + 1 >= queue.length

    if (isComplete) {
      set({
        queue: updatedQueue,
        sessionStats: {
          ...sessionStats,
          cardsStudied: sessionStats.cardsStudied + 1,
          ratings: updatedRatings,
          totalDurationMs: sessionStats.totalDurationMs + durationMs,
        },
        phase: 'completed',
      })
      await get().endSession()
    } else {
      // For SRS mode, get the next card from queue manager
      if (isSrsMode) {
        const nextQueueCard = srsQueueManager!.currentCard()
        const nextCardIndex = nextQueueCard
          ? updatedQueue.findIndex(c => c.id === nextQueueCard.id)
          : currentIndex + 1

        set({
          queue: updatedQueue,
          currentIndex: nextCardIndex >= 0 ? nextCardIndex : currentIndex + 1,
          isFlipped: false,
          cardStartTime: Date.now(),
          sessionStats: {
            ...sessionStats,
            cardsStudied: sessionStats.cardsStudied + 1,
            ratings: updatedRatings,
            totalDurationMs: sessionStats.totalDurationMs + durationMs,
          },
        })
      } else {
        set({
          queue: updatedQueue,
          currentIndex: currentIndex + 1,
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
    }
  },

  endSession: async () => {
    const { config, queue, studyState, sessionStats, sessionStartedAt, maxCardPosition } = get()
    if (!config || !studyState) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Save study session record
    if (sessionStats.cardsStudied > 0) {
      await supabase
        .from('study_sessions')
        .insert({
          user_id: user.id,
          deck_id: config.deckId,
          study_mode: config.mode,
          cards_studied: sessionStats.cardsStudied,
          total_cards: sessionStats.totalCards,
          total_duration_ms: sessionStats.totalDurationMs,
          ratings: sessionStats.ratings,
          started_at: new Date(sessionStartedAt).toISOString(),
          completed_at: new Date().toISOString(),
        } as Record<string, unknown>)
    }

    // Update deck_study_state based on mode
    if (config.mode === 'sequential_review' && queue.length > 0) {
      const positions = computeSequentialReviewPositions(queue, studyState, maxCardPosition)

      await supabase
        .from('deck_study_state')
        .update({
          new_start_pos: positions.new_start_pos,
          review_start_pos: positions.review_start_pos,
        } as Record<string, unknown>)
        .eq('id', studyState.id)
    }

    if (config.mode === 'sequential' && queue.length > 0) {
      const maxPos = Math.max(...queue.map(c => c.sort_position))
      const nextPos = maxPos + 1

      // Wrap around if past all cards
      await supabase
        .from('deck_study_state')
        .update({
          sequential_pos: nextPos > maxCardPosition ? 0 : nextPos,
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
      srsSource: 'embedded',
      queue: [],
      currentIndex: 0,
      isFlipped: false,
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      sessionStats: { ...initialStats },
      studyState: null,
      srsQueueManager: null,
      maxCardPosition: 0,
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
