import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { calculateSRS, getSrsDayStart, type SrsRating } from '../lib/srs'
import { buildSequentialReviewQueue, computeSequentialReviewPositions } from '../lib/study-session-utils'
import { SrsQueueManager, type QueueCard, type SrsQueueSnapshot } from '../lib/study-queue'
import { CrammingQueueManager, filterCardsForCramming, type CrammingFilter, type CrammingRating, type CrammingQueueSnapshot } from '../lib/cramming-queue'
import { getRatingExitDirection, type ExitDirection } from '../lib/study-exit-direction'
import { guard } from '../lib/rate-limit-instance'
import { getSrsSource, mergeCardWithProgress, type SrsSource, type UserCardProgress } from '../lib/srs-access'
import { useCardStore } from './card-store'
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

interface LastRatedCard {
  cardId: string
  previousCard: Card
  rating: string
  previousIndex: number
  previousStats: SessionStats
  timestamp: number
  srsQueueSnapshot: SrsQueueSnapshot | null
  crammingSnapshot: CrammingQueueSnapshot | null
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
  /** True when this deck is a SUBSCRIBED deck study-locked by the over-cap boundary
   *  (mig 140) — cards stay viewable, but study is gated behind subscribing/upgrading. */
  subscriptionLocked: boolean
  userId: string | null
  srsQueueManager: SrsQueueManager | null
  crammingManager: CrammingQueueManager | null
  maxCardPosition: number
  lastRatedCard: LastRatedCard | null
  sessionSaved: boolean

  initSession: (config: StudyConfig) => Promise<void>
  flipCard: () => void
  rateCard: (rating: string) => Promise<void>
  undoLastRating: () => void
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
  subscriptionLocked: false,
  srsQueueManager: null,
  crammingManager: null,
  maxCardPosition: 0,
  lastRatedCard: null,
  sessionSaved: false,

  initSession: async (config: StudyConfig) => {
    // Prevent double-init (React StrictMode / effect re-runs)
    if (get().phase === 'loading') return

    const check = guard.check('study_session_start', 'study_sessions_daily')
    if (!check.allowed) { set({ phase: 'idle' }); return }

    set({ phase: 'loading', config, subscriptionLocked: false })

    try {

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

    // Over-cap SUBSCRIBED deck → study-locked (mig 140). The account counts owned +
    // subscribed non-official cards toward the cap; when over, the newest subscribed
    // decks are locked from study (cards stay viewable) until the cap rises. Enforce
    // BEFORE building the queue so a locked deck yields no studyable cards.
    if (srsSource === 'progress_table') {
      // Resolve the over-cap study-lock (mig 140). FAIL-CLOSED (S-L2): a null/error
      // result must NOT silently unlock a study-locked deck. Retry once; if still
      // indeterminate, treat as locked. Official + under-cap subscribed decks
      // return true and study proceeds normally.
      let active: boolean | null = null
      for (let attempt = 0; attempt < 2 && active == null; attempt++) {
        const { data, error } = await supabase.rpc('is_subscribed_deck_active', { p_deck_id: config.deckId })
        if (!error && data != null) active = data as boolean
      }
      if (active !== true) {
        set({ phase: 'completed', subscriptionLocked: true, srsSource, queue: [], srsQueueManager: null, crammingManager: null, sessionStats: { ...initialStats, totalCards: 0 } })
        return
      }
    }

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

    // ── Archive-the-excess boundary (mig 123) ──────────────────────────────
    // Owned NON-OFFICIAL cards created AFTER the (limit)-th oldest are ARCHIVED
    // FROM STUDY once the account is over its card cap — they stay fully
    // viewable / editable / deletable, just not studyable.
    // get_active_card_threshold() returns ONE boundary value: the created_at of
    // the (limit)-th oldest owned non-official card (NULL when at/under the cap
    // → nothing archived). For OWNED decks (embedded SRS source) we range-filter
    // the queue to created_at <= threshold — an INDEXED range — so archived
    // cards never enter the session and the payload stays O(active), independent
    // of library size. Subscribed / publisher-owned / official decks
    // (progress_table source, user_card_progress) are ALWAYS active and never
    // filtered. Fetched ONCE per session here and cached in `activeThreshold`
    // for reuse across every owned-deck queue query below.
    let activeThreshold: string | null = null
    if (srsSource === 'embedded') {
      const { data: thresholdData } = await supabase.rpc('get_active_card_threshold')
      activeThreshold = (thresholdData as string | null) ?? null
    }

    // ── Merged card set for NON-OWNED decks (progress_table) ──────────────────
    // Subscribed / publisher-owned / official decks keep the VIEWER's own SRS in
    // user_card_progress, not the embedded cards row. Load the FULL card set + the
    // viewer's progress ONCE, PAGINATED — PostgREST caps a single response at
    // max_rows=1000, so the old unpaginated fetches silently truncated large decks:
    // cards 1001+ were unstudyable and >1000 progress rows were dropped, corrupting
    // the schedule (S-H1). Every mode below filters THIS merged set so it reflects
    // the viewer's progress, not the publisher's embedded state (S-M1). Owned decks
    // (embedded) keep the efficient server-side filtered queries.
    let mergedAll: Card[] | null = null
    if (srsSource === 'progress_table') {
      const [allCards, progressRows] = await Promise.all([
        fetchAllRows<Card>(() =>
          supabase.from('cards').select('*').eq('deck_id', config.deckId).order('sort_position', { ascending: true })),
        fetchAllRows<UserCardProgress>(() =>
          supabase.from('user_card_progress').select('*').eq('deck_id', config.deckId).eq('user_id', user.id)),
      ])
      const progressMap = new Map<string, UserCardProgress>()
      for (const p of progressRows) progressMap.set(p.card_id, p)
      mergedAll = allCards.map((card) => mergeCardWithProgress(card, progressMap.get(card.id)) as Card)
    }

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
        const dnl = (profile as { daily_new_limit: number } | null)?.daily_new_limit
        if (typeof dnl === 'number' && dnl >= 0) {
          newCardLimit = dnl  // honor an explicit 0 (= "no new cards today") — S-N1
        }

        // Count new cards already studied today (across all sessions)
        // Uses SRS day boundary (4AM) instead of midnight for consistency
        // prev_srs_status is written via insert_study_log RPC (bypasses PostgREST schema cache)
        const todayStart = getSrsDayStart()
        const { count: todayNewCount } = await supabase
          .from('study_logs')
          .select('*', { count: 'exact', head: true })
          .eq('deck_id', config.deckId)
          .eq('user_id', user.id)
          .eq('study_mode', 'srs')
          .eq('prev_srs_status', 'new')
          .gte('studied_at', todayStart.toISOString())

        // Remaining new cards for today
        const remainingNewToday = Math.max(0, newCardLimit - (todayNewCount ?? 0))

        if (mergedAll) {
          // Non-owned deck: partition the VIEWER's merged progress (S-M1). Due
          // cards ordered by next_review_at so the most-overdue surface first,
          // matching the embedded path (S-L1).
          const byDue = (a: Card, b: Card) => (a.next_review_at ?? '').localeCompare(b.next_review_at ?? '')
          const learning = mergedAll
            .filter((c) => c.srs_status === 'learning' && c.next_review_at && c.next_review_at <= now)
            .sort(byDue)
          const review = mergedAll
            .filter((c) => c.srs_status === 'review' && c.next_review_at && c.next_review_at <= now)
            .sort(byDue)
          const newC = mergedAll.filter((c) => c.srs_status === 'new').slice(0, remainingNewToday)

          cards = [...learning, ...review, ...newC]
        } else {
          // Embedded (owned): server-filtered. Paginate learning/review so a deck
          // with >1000 due cards is not truncated at max_rows (S-H1).
          const learning = await fetchAllRows<Card>(() => withArchiveBoundary(
            supabase
              .from('cards')
              .select('*')
              .eq('deck_id', config.deckId)
              .eq('srs_status', 'learning')
              .lte('next_review_at', now),
            activeThreshold,
          ).order('next_review_at', { ascending: true }))

          const review = await fetchAllRows<Card>(() => withArchiveBoundary(
            supabase
              .from('cards')
              .select('*')
              .eq('deck_id', config.deckId)
              .eq('srs_status', 'review')
              .lte('next_review_at', now),
            activeThreshold,
          ).order('next_review_at', { ascending: true }))

          // New cards are bounded by the daily limit (small) — a single .limit() is safe.
          const { data: newCards } = await withArchiveBoundary(
            supabase
              .from('cards')
              .select('*')
              .eq('deck_id', config.deckId)
              .eq('srs_status', 'new'),
            activeThreshold,
          ).order('sort_position', { ascending: true }).limit(remainingNewToday)

          cards = [
            ...learning,
            ...review,
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

        // Non-owned → the merged set (viewer progress, S-M1); owned → paginated
        // server fetch (S-H1). buildSequentialReviewQueue reads srs_status, which
        // the merged set carries from user_card_progress.
        const allCards = mergedAll ?? await fetchAllRows<Card>(() => withArchiveBoundary(
          supabase
            .from('cards')
            .select('*')
            .eq('deck_id', config.deckId),
          activeThreshold,
        ).order('sort_position', { ascending: true }))

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
        let pool: Card[]
        if (mergedAll) {
          pool = mergedAll.filter((c) => c.srs_status !== 'suspended')
          if (config.uploadDateStart) pool = pool.filter((c) => c.created_at >= config.uploadDateStart!)
          if (config.uploadDateEnd) pool = pool.filter((c) => c.created_at <= config.uploadDateEnd!)
        } else {
          // Paginate + stable .order() so no page is truncated at max_rows (S-H1).
          pool = await fetchAllRows<Card>(() => {
            let q = supabase
              .from('cards')
              .select('*')
              .eq('deck_id', config.deckId)
              .neq('srs_status', 'suspended')
            if (config.uploadDateStart) q = q.gte('created_at', config.uploadDateStart)
            if (config.uploadDateEnd) q = q.lte('created_at', config.uploadDateEnd)
            return withArchiveBoundary(q, activeThreshold).order('sort_position', { ascending: true })
          })
        }
        const shuffled = shuffleArray(pool)
        cards = shuffled.slice(0, config.batchSize)
        break
      }

      case 'sequential': {
        if (!typedStudyState) break

        if (mergedAll) {
          // Non-owned: filter the merged set (viewer progress → suspended, S-M1).
          const nonSusp = mergedAll.filter((c) => c.srs_status !== 'suspended')  // already sort_position asc
          let seq = nonSusp.filter((c) => c.sort_position >= typedStudyState.sequential_pos).slice(0, config.batchSize)
          if (seq.length < config.batchSize) {
            const ids = new Set(seq.map((c) => c.id))
            const wrap = nonSusp.filter((c) => !ids.has(c.id)).slice(0, config.batchSize - seq.length)
            seq = [...seq, ...wrap]
          }
          cards = seq
          break
        }

        // Embedded: bounded .limit() (batchSize ≤ MAX_BATCH_SIZE) — no truncation risk.
        const { data: seqCards } = await withArchiveBoundary(
          supabase
            .from('cards')
            .select('*')
            .eq('deck_id', config.deckId)
            .neq('srs_status', 'suspended')
            .gte('sort_position', typedStudyState.sequential_pos),
          activeThreshold,
        ).order('sort_position', { ascending: true }).limit(config.batchSize)

        cards = (seqCards ?? []) as Card[]

        // Wrap around: fill remaining from beginning if partial batch
        if (cards.length < config.batchSize) {
          const remaining = config.batchSize - cards.length
          const existingIds = new Set(cards.map(c => c.id))
          const { data: wrapCards } = await withArchiveBoundary(
            supabase
              .from('cards')
              .select('*')
              .eq('deck_id', config.deckId)
              .neq('srs_status', 'suspended'),
            activeThreshold,
          ).order('sort_position', { ascending: true }).limit(remaining)

          const uniqueWrapCards = ((wrapCards ?? []) as Card[]).filter(c => !existingIds.has(c.id))
          cards = [...cards, ...uniqueWrapCards]
        }
        break
      }

      case 'by_date': {
        if (mergedAll) {
          let pool = mergedAll.filter((c) => c.srs_status !== 'suspended')  // sort_position asc
          if (config.uploadDateStart) pool = pool.filter((c) => c.created_at >= config.uploadDateStart!)
          if (config.uploadDateEnd) pool = pool.filter((c) => c.created_at <= config.uploadDateEnd!)
          cards = pool
          break
        }
        // Paginate so a large date range is not truncated at max_rows (S-H1).
        cards = await fetchAllRows<Card>(() => {
          let q = supabase
            .from('cards')
            .select('*')
            .eq('deck_id', config.deckId)
            .neq('srs_status', 'suspended')
          if (config.uploadDateStart) q = q.gte('created_at', config.uploadDateStart)
          if (config.uploadDateEnd) q = q.lte('created_at', config.uploadDateEnd)
          return withArchiveBoundary(q, activeThreshold).order('sort_position', { ascending: true })
        })
        break
      }

      case 'cramming': {
        // Non-owned → merged set (viewer progress, S-M1); owned → paginated fetch
        // (S-H1). filterCardsForCramming drops suspended + applies the filter.
        const pool = mergedAll ?? await fetchAllRows<Card>(() => withArchiveBoundary(
          supabase
            .from('cards')
            .select('*')
            .eq('deck_id', config.deckId)
            .neq('srs_status', 'suspended'),
          activeThreshold,
        ).order('sort_position', { ascending: true }))

        const crammingFilter = config.crammingFilter ?? { type: 'all' as const }
        cards = filterCardsForCramming(pool, crammingFilter)
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
      sessionSaved: false,
    })

    } catch (err) {
      console.error('[study-store] initSession failed:', err)
      set({ phase: 'completed', queue: [], sessionStats: { ...initialStats, totalCards: 0 } })
    }
  },

  flipCard: () => {
    const { isRating, phase } = get()
    if (isRating || phase !== 'studying') return
    set((state) => ({ isFlipped: !state.isFlipped }))
  },

  rateCard: async (rating: string) => {
    const { queue, currentIndex, config, cardStartTime, sessionStats, srsSettings, srsSource, srsQueueManager, crammingManager, isRating, studyState, userId } = get()
    if (!config || isRating || !userId) return

    const isSrsMode = config.mode === 'srs' && srsQueueManager
    const isCrammingMode = config.mode === 'cramming' && crammingManager

    // Determine current card based on mode (needed for undo snapshot)
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

    // Save undo state before rating (including queue manager snapshots)
    set({
      isRating: true,
      exitDirection: getRatingExitDirection(rating),
      lastRatedCard: {
        cardId: card.id,
        previousCard: { ...card },
        rating,
        previousIndex: currentIndex,
        previousStats: { ...sessionStats, ratings: { ...sessionStats.ratings } },
        timestamp: Date.now(),
        srsQueueSnapshot: srsQueueManager?.snapshot() ?? null,
        crammingSnapshot: crammingManager?.snapshot() ?? null,
      },
    })

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

    // (S-L3) sequential_review positions are computed authoritatively in
    // endSession from the studied queue — NOT written per-card. The old per-card
    // fire-and-forget UPDATEs had no ordering guarantee, so a delayed earlier write
    // could regress the saved position. Keep studyState at its session-start value
    // so endSession's computeSequentialReviewPositions has the right baseline.
    const updatedStudyState = studyState

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
        isFlipped: false,
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

    // Study log — use RPC to bypass PostgREST schema cache miss (PGRST204) for prev_srs_status
    const studyLogParams = {
      p_user_id: userId,
      p_card_id: card.id,
      p_deck_id: config.deckId,
      p_study_mode: config.mode,
      p_rating: rating,
      p_prev_interval: card.interval_days,
      p_new_interval: newInterval,
      p_prev_ease: card.ease_factor,
      p_new_ease: newEase,
      p_review_duration_ms: durationMs,
      p_prev_srs_status: card.srs_status,
    }
    console.log('[study-store] INSERT study_log via RPC:', JSON.stringify(studyLogParams))
    dbWrites.push(supabase.rpc('insert_study_log', studyLogParams))

    Promise.all(dbWrites).then((results) => {
      // Supabase never rejects — errors come in resolved { error } objects
      for (const r of results) {
        const res = r as { error?: { message: string; code?: string } } | undefined
        if (res?.error) {
          console.error('[study-store] DB write error:', res.error.message, res.error.code)
        }
      }
    }).catch(err => console.error('[study-store] DB write failed:', err))

    // endSession also fire-and-forget
    if (isComplete) {
      get().endSession().catch(err => console.error('[study-store] endSession failed:', err))
    }
  },

  endSession: async () => {
    const { config, queue, studyState, sessionStats, sessionStartedAt, maxCardPosition, crammingManager, userId, sessionSaved } = get()
    if (!config || !userId) return
    // Prevent duplicate session recording (race between rateCard completion and crammingTimeUp)
    if (sessionSaved) return
    set({ sessionSaved: true })

    // SRS for this deck just changed via study (which writes cards/user_card_progress
    // directly, bypassing card-store) → drop the cached card list so DeckDetail's
    // srs_status filter reflects it on next open. Cramming doesn't change SRS.
    if (config.mode !== 'cramming') {
      useCardStore.getState().invalidateCards(config.deckId)
    }

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
        // Only consider cards actually studied (sequential processes in order, so slice is exact)
        const studiedCards = queue.slice(0, sessionStats.cardsStudied)

        if (studiedCards.length > 0) {
          const wrappedCards = studiedCards.filter(c => c.sort_position < typedState.sequential_pos)

          let nextPos: number
          if (wrappedCards.length > 0) {
            nextPos = Math.max(...wrappedCards.map(c => c.sort_position)) + 1
          } else {
            const maxPos = Math.max(...studiedCards.map(c => c.sort_position))
            nextPos = maxPos + 1
          }

          await supabase
            .from('deck_study_state')
            .update({
              sequential_pos: nextPos > maxCardPosition ? 0 : nextPos,
            } as Record<string, unknown>)
            .eq('id', studyState.id)
        }
      } else if (config.mode === 'sequential_review' && queue.length > 0) {
        // (S-L3) Authoritative single write of the final position from the cards
        // actually studied this session — replaces the removed per-card writes.
        const typedState = studyState as DeckStudyState
        const studiedCards = queue.slice(0, sessionStats.cardsStudied)
        if (studiedCards.length > 0) {
          const positions = computeSequentialReviewPositions(
            studiedCards.map(c => ({ sort_position: c.sort_position, srs_status: c.srs_status })),
            { new_start_pos: typedState.new_start_pos, review_start_pos: typedState.review_start_pos },
            maxCardPosition,
          )
          await supabase
            .from('deck_study_state')
            .update(positions as Record<string, unknown>)
            .eq('id', studyState.id)
        }
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

  undoLastRating: () => {
    const { lastRatedCard, queue, phase, srsQueueManager, crammingManager } = get()
    if (!lastRatedCard || (phase !== 'studying' && phase !== 'completed')) return
    const wasCompleted = phase === 'completed'

    // Restore queue manager internal state from snapshots
    if (lastRatedCard.srsQueueSnapshot && srsQueueManager) {
      srsQueueManager.restore(lastRatedCard.srsQueueSnapshot)
    }
    if (lastRatedCard.crammingSnapshot && crammingManager) {
      crammingManager.restore(lastRatedCard.crammingSnapshot)
    }

    // Restore the card's previous state in the queue
    const updatedQueue = queue.map(c =>
      c.id === lastRatedCard.cardId ? { ...lastRatedCard.previousCard } : c
    )

    set({
      phase: 'studying',
      queue: updatedQueue,
      currentIndex: lastRatedCard.previousIndex,
      isFlipped: false,
      isRating: false,
      exitDirection: null,
      sessionStats: lastRatedCard.previousStats,
      lastRatedCard: null,
      cardStartTime: Date.now(),
      // Undoing from the completion screen must let endSession record a fresh,
      // corrected session — otherwise the sessionSaved guard makes re-completion a
      // no-op and leaves a stale study_sessions row (S-L4).
      ...(wasCompleted ? { sessionSaved: false } : {}),
    })
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
      lastRatedCard: null,
      sessionSaved: false,
    })
  },
}))

/**
 * Range-filter an OWNED-deck (`cards` table) query to the ACTIVE side of the
 * archive boundary (mig 123). When `threshold` is non-null, only cards with
 * created_at <= threshold (the un-archived ones, under the card cap) stay in the
 * query — an INDEXED range, so archived cards never enter the study queue and
 * the payload stays O(active). When null the account is at/under its limit → no
 * filter (every owned card is active). MUST be applied while the query is still
 * a filter builder (before .order()/.limit()). Only ever used on OWNED (embedded
 * SRS) decks — subscribed / publisher-owned / official cards are always active
 * and are never passed here.
 */
function withArchiveBoundary<Q>(query: Q, threshold: string | null): Q {
  if (!threshold) return query
  return (query as unknown as { lte(column: string, value: string): Q }).lte('created_at', threshold)
}

/**
 * Fetch EVERY row of a query, defeating PostgREST's max_rows (1000) response cap
 * by paging with .range(). `makeQuery` MUST return a fresh builder each call (a
 * supabase query is a one-shot thenable) with its .order() already applied so the
 * pages are stable. Without this, large decks silently truncated the study queue —
 * cards past row 1000 were unstudyable and progress rows were dropped (S-H1). The
 * 500k backstop caps runaway loops far above any real deck size.
 */
async function fetchAllRows<T>(makeQuery: () => unknown, pageSize = 1000): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; offset < 500_000; offset += pageSize) {
    const builder = makeQuery() as { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> }
    const { data, error } = await builder.range(offset, offset + pageSize - 1)
    if (error) break
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}
