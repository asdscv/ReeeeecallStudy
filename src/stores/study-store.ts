import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { calculateSRS, getSrsDayStart, type SrsRating } from '../lib/srs'
import { advanceSequentialReviewPosition, buildSequentialReviewQueue } from '../lib/study-session-utils'
import { SrsQueueManager, type QueueCard } from '../lib/study-queue'
import { CrammingQueueManager, filterCardsForCramming, type CrammingFilter, type CrammingRating } from '../lib/cramming-queue'
import { getRatingExitDirection, type ExitDirection } from '../lib/study-exit-direction'
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
  crammingFilter?: CrammingFilter
  crammingTimeLimitMinutes?: number | null
  crammingShuffle?: boolean
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
  isRating: boolean
  exitDirection: ExitDirection | null
  cardStartTime: number
  sessionStartedAt: number
  sessionStats: SessionStats
  studyState: DeckStudyState | null
  srsSource: SrsSource
  userId: string | null
  srsQueueManager: SrsQueueManager | null
  crammingManager: CrammingQueueManager | null
  maxCardPosition: number

  initSession: (config: StudyConfig) => Promise<void>
  flipCard: () => void
  rateCard: (rating: string) => Promise<void>
  endSession: () => Promise<void>
  exitSession: () => Promise<void>
  crammingTimeUp: () => Promise<void>
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
  isRating: false,
  exitDirection: null,
  cardStartTime: Date.now(),
  sessionStartedAt: Date.now(),
  sessionStats: { ...initialStats },
  studyState: null,
  userId: null,
  srsSource: 'embedded',
  srsQueueManager: null,
  crammingManager: null,
  maxCardPosition: 0,

  initSession: async (config: StudyConfig) => {
    const check = guard.check('study_session_start', 'study_sessions_daily')
    if (!check.allowed) { set({ phase: 'idle' }); return }

    set({ phase: 'loading', config })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { set({ phase: 'idle' }); return }
    set({ userId: user.id })

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
        // Uses SRS day boundary (4AM) instead of midnight for consistency
        const todayStart = getSrsDayStart()
        const { count: todayNewCount } = await supabase
          .from('study_logs')
          .select('*', { count: 'exact', head: true })
          .eq('deck_id', config.deckId)
          .eq('user_id', user.id)
          .eq('study_mode', 'srs')
          .gte('studied_at', todayStart.toISOString())
          .eq('prev_srs_status', 'new')

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

        // Wrap around: fill remaining from beginning if partial batch
        if (cards.length < config.batchSize) {
          const remaining = config.batchSize - cards.length
          const existingIds = new Set(cards.map(c => c.id))
          const { data: wrapCards } = await supabase
            .from('cards')
            .select('*')
            .eq('deck_id', config.deckId)
            .neq('srs_status', 'suspended')
            .order('sort_position', { ascending: true })
            .limit(remaining)

          const uniqueWrapCards = ((wrapCards ?? []) as Card[]).filter(c => !existingIds.has(c.id))
          cards = [...cards, ...uniqueWrapCards]
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

      case 'cramming': {
        // Fetch all non-suspended cards
        const { data: allCrammingCards } = await supabase
          .from('cards')
          .select('*')
          .eq('deck_id', config.deckId)
          .neq('srs_status', 'suspended')
          .order('sort_position', { ascending: true })

        const crammingFilter = config.crammingFilter ?? { type: 'all' as const }
        cards = filterCardsForCramming((allCrammingCards ?? []) as Card[], crammingFilter)
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
        crammingManager: null,
        maxCardPosition,
        sessionStats: { ...initialStats, totalCards: 0 },
      })
      return
    }

    // Create cramming manager if in cramming mode
    let crammingManager: CrammingQueueManager | null = null
    if (config.mode === 'cramming') {
      crammingManager = new CrammingQueueManager(
        cards.map(c => c.id),
        {
          filter: config.crammingFilter ?? { type: 'all' },
          timeLimitMinutes: config.crammingTimeLimitMinutes ?? null,
          shuffleCards: config.crammingShuffle ?? true,
        }
      )
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
      crammingManager,
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
    const { queue, currentIndex, config, cardStartTime, sessionStats, srsSettings, srsSource, srsQueueManager, crammingManager, isRating, studyState, maxCardPosition, userId } = get()
    if (!config || isRating || !userId) return
    set({ isRating: true, exitDirection: getRatingExitDirection(rating) })

    const isSrsMode = config.mode === 'srs' && srsQueueManager
    const isCrammingMode = config.mode === 'cramming' && crammingManager

    // Determine current card based on mode
    let card: Card | undefined
    if (isCrammingMode) {
      const cardId = crammingManager!.currentCardId()
      card = cardId ? queue.find(c => c.id === cardId) : undefined
    } else if (isSrsMode) {
      const qc = srsQueueManager!.currentCard()
      card = qc ? queue.find(c => c.id === qc.id) ?? queue[currentIndex] : queue[currentIndex]
    } else {
      card = queue[currentIndex]
    }

    if (!card) return

    const durationMs = Date.now() - cardStartTime
    let newInterval = card.interval_days
    let newEase = card.ease_factor
    let updatedQueue = queue
    let srsResult: ReturnType<typeof calculateSRS> | null = null

    if (isCrammingMode) {
      // Cramming mode: NO SRS calculation, just advance the cramming manager
      // Map unified unknown/known → missed/got_it
      const crammingRating: CrammingRating = rating === 'known' ? 'got_it' : rating === 'unknown' ? 'missed' : rating as CrammingRating
      crammingManager!.rateCard(crammingRating)
    } else if (config.mode === 'srs') {
      // SRS mode: calculate SRS synchronously
      srsResult = calculateSRS(card, rating as SrsRating, srsSettings ?? undefined)
      newInterval = srsResult.interval_days
      newEase = srsResult.ease_factor

      const queueIndex = queue.findIndex(c => c.id === card!.id)
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

      if (srsQueueManager) {
        const shouldRequeue = srsResult?.srs_status === 'learning'
        srsQueueManager.rateCard(rating as SrsRating, shouldRequeue)
      }
    }

    // Per-card position update for sequential_review (sync state update)
    let updatedStudyState = studyState
    let posUpdate: Record<string, number> | null = null
    if (config.mode === 'sequential_review' && studyState) {
      posUpdate = advanceSequentialReviewPosition(card, maxCardPosition)
      updatedStudyState = { ...studyState, ...posUpdate }
    }

    // Update stats
    const updatedRatings = { ...sessionStats.ratings }
    updatedRatings[rating] = (updatedRatings[rating] || 0) + 1

    // Determine if session is complete
    let isComplete: boolean
    if (isCrammingMode) {
      isComplete = crammingManager!.isSessionComplete()
    } else if (isSrsMode) {
      isComplete = srsQueueManager!.isComplete()
    } else {
      isComplete = currentIndex + 1 >= queue.length
    }

    // After SRS requeue, totalCards may have increased
    const updatedTotalCards = isSrsMode
      ? srsQueueManager!.studiedCount() + srsQueueManager!.remaining()
      : sessionStats.totalCards

    // ★ Optimistic UI update — set state BEFORE DB writes ★
    // Brief delay so :active press effect is visible before buttons unmount
    await new Promise(r => setTimeout(r, 120))

    if (isComplete) {
      set({
        queue: updatedQueue,
        isRating: false,
        studyState: updatedStudyState,
        sessionStats: {
          ...sessionStats,
          cardsStudied: sessionStats.cardsStudied + 1,
          totalCards: updatedTotalCards,
          ratings: updatedRatings,
          totalDurationMs: sessionStats.totalDurationMs + durationMs,
        },
        phase: 'completed',
      })
    } else if (isCrammingMode) {
      const nextCardId = crammingManager!.currentCardId()
      const nextCardIndex = nextCardId
        ? queue.findIndex(c => c.id === nextCardId)
        : currentIndex

      set({
        queue: updatedQueue,
        currentIndex: nextCardIndex >= 0 ? nextCardIndex : currentIndex,
        isFlipped: false,
        isRating: false,
        cardStartTime: Date.now(),
        studyState: updatedStudyState,
        sessionStats: {
          ...sessionStats,
          cardsStudied: sessionStats.cardsStudied + 1,
          ratings: updatedRatings,
          totalDurationMs: sessionStats.totalDurationMs + durationMs,
        },
      })
    } else if (isSrsMode) {
      const nextQueueCard = srsQueueManager!.currentCard()
      const nextCardIndex = nextQueueCard
        ? updatedQueue.findIndex(c => c.id === nextQueueCard.id)
        : currentIndex + 1

      set({
        queue: updatedQueue,
        currentIndex: nextCardIndex >= 0 ? nextCardIndex : currentIndex + 1,
        isFlipped: false,
        isRating: false,
        cardStartTime: Date.now(),
        studyState: updatedStudyState,
        sessionStats: {
          ...sessionStats,
          cardsStudied: sessionStats.cardsStudied + 1,
          totalCards: updatedTotalCards,
          ratings: updatedRatings,
          totalDurationMs: sessionStats.totalDurationMs + durationMs,
        },
      })
    } else {
      set({
        queue: updatedQueue,
        currentIndex: currentIndex + 1,
        isFlipped: false,
        isRating: false,
        cardStartTime: Date.now(),
        studyState: updatedStudyState,
        sessionStats: {
          ...sessionStats,
          cardsStudied: sessionStats.cardsStudied + 1,
          ratings: updatedRatings,
          totalDurationMs: sessionStats.totalDurationMs + durationMs,
        },
      })
    }

    // ★ Background DB writes (fire-and-forget) ★
    const dbWrites: PromiseLike<unknown>[] = []

    // SRS DB update
    if (config.mode === 'srs' && srsResult) {
      if (srsSource === 'progress_table') {
        dbWrites.push(
          supabase
            .from('user_card_progress')
            .upsert({
              user_id: userId,
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
        )
      } else {
        dbWrites.push(
          supabase
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
        )
      }
    }

    // Study log
    dbWrites.push(
      supabase
        .from('study_logs')
        .insert({
          user_id: userId,
          card_id: card.id,
          deck_id: config.deckId,
          study_mode: config.mode,
          rating,
          prev_interval: card.interval_days,
          new_interval: newInterval,
          prev_ease: card.ease_factor,
          new_ease: newEase,
          review_duration_ms: durationMs,
          prev_srs_status: card.srs_status,
        } as Record<string, unknown>)
    )

    // Sequential review position save
    if (posUpdate && studyState) {
      dbWrites.push(
        supabase
          .from('deck_study_state')
          .update(posUpdate as Record<string, unknown>)
          .eq('id', studyState.id)
      )
    }

    Promise.all(dbWrites).catch(err => console.error('[study-store] DB write failed:', err))

    // endSession also fire-and-forget
    if (isComplete) {
      get().endSession().catch(err => console.error('[study-store] endSession failed:', err))
    }
  },

  endSession: async () => {
    const { config, queue, studyState, sessionStats, sessionStartedAt, maxCardPosition, crammingManager, userId } = get()
    if (!config || !userId) return

    // Build metadata for cramming sessions
    let metadata: Record<string, unknown> | undefined
    if (config.mode === 'cramming' && crammingManager) {
      const hardestCards = crammingManager.getHardestCards(5)
      metadata = {
        cramming: {
          rounds: crammingManager.currentRound(),
          mastery_percentage: crammingManager.masteryPercentage(),
          all_mastered: crammingManager.isAllMastered(),
          hardest_cards: hardestCards.map(c => ({
            card_id: c.cardId,
            missed_count: c.missedCount,
          })),
        },
      }
    }

    // Save study session record
    if (sessionStats.cardsStudied > 0) {
      await supabase
        .from('study_sessions')
        .insert({
          user_id: userId,
          deck_id: config.deckId,
          study_mode: config.mode,
          cards_studied: sessionStats.cardsStudied,
          total_cards: sessionStats.totalCards,
          total_duration_ms: sessionStats.totalDurationMs,
          ratings: sessionStats.ratings,
          started_at: new Date(sessionStartedAt).toISOString(),
          completed_at: new Date().toISOString(),
          ...(metadata ? { metadata } : {}),
        } as Record<string, unknown>)
    }

    // Update deck_study_state based on mode (requires studyState)
    // Note: sequential_review positions are saved per-card in rateCard()
    if (studyState) {
      if (config.mode === 'sequential' && queue.length > 0) {
        const typedState = studyState as DeckStudyState
        // Detect wrapped queue (cards with positions before the session start)
        const wrappedCards = queue.filter(c => c.sort_position < typedState.sequential_pos)

        let nextPos: number
        if (wrappedCards.length > 0) {
          // Queue wrapped — continue after the last wrapped card
          nextPos = Math.max(...wrappedCards.map(c => c.sort_position)) + 1
        } else {
          const maxPos = Math.max(...queue.map(c => c.sort_position))
          nextPos = maxPos + 1
        }

        await supabase
          .from('deck_study_state')
          .update({
            sequential_pos: nextPos > maxCardPosition ? 0 : nextPos,
          } as Record<string, unknown>)
          .eq('id', studyState.id)
      }
    }

    set({ phase: 'completed' })
  },

  exitSession: async () => {
    const { phase, isRating, sessionStats, cardStartTime } = get()
    if (phase !== 'studying' || isRating) return
    if (sessionStats.cardsStudied === 0) return

    const currentCardDuration = Date.now() - cardStartTime
    set({
      sessionStats: {
        ...sessionStats,
        totalDurationMs: sessionStats.totalDurationMs + currentCardDuration,
      },
      phase: 'completed',
    })
    await get().endSession()
  },

  crammingTimeUp: async () => {
    const { config, phase, isRating, sessionStats, cardStartTime } = get()
    if (!config || config.mode !== 'cramming') return
    // Guard: skip if already completed or a rating is in progress
    if (phase !== 'studying' || isRating) return

    // Account for the time spent on the current (unrated) card
    const currentCardDuration = Date.now() - cardStartTime
    set({
      sessionStats: {
        ...sessionStats,
        totalDurationMs: sessionStats.totalDurationMs + currentCardDuration,
      },
      phase: 'completed',
    })
    await get().endSession()
  },

  reset: () => {
    set({
      phase: 'idle',
      config: null,
      template: null,
      srsSettings: null,
      userId: null,
      srsSource: 'embedded',
      queue: [],
      currentIndex: 0,
      isFlipped: false,
      isRating: false,
      exitDirection: null,
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      sessionStats: { ...initialStats },
      studyState: null,
      srsQueueManager: null,
      crammingManager: null,
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
