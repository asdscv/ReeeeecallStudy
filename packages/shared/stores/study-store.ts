import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { modeFeedsSrsSchedule } from '../lib/study-mode-scheduling'
import { calculateSRS, getSrsDayStart, type SrsRating } from '../lib/srs'
import { buildSequentialQueue, buildSequentialReviewQueue, computeSequentialPosition, computeSequentialReviewPositions } from '../lib/study-session-utils'
import { SrsQueueManager, type QueueCard, type SrsQueueSnapshot } from '../lib/study-queue'
import { CrammingQueueManager, filterCardsForCramming, type CrammingFilter, type CrammingRating, type CrammingQueueSnapshot } from '../lib/cramming-queue'
import { getRatingExitDirection, type ExitDirection } from '../lib/study-exit-direction'
import { guard } from '../lib/rate-limit-instance'
import { getSrsSource, mergeCardWithProgress, type SrsSource, type UserCardProgress } from '../lib/srs-access'
import { fetchAllRows } from '../lib/fetch-all-rows'
import { newPersistenceId } from '../lib/persistence-id'
import { normalizeRatingForMode, normalizeStudyConfig } from '../lib/study-validation'
import { useCardStore } from './card-store'
import type { Card, CardTemplate, StudyMode, DeckStudyState, SrsSettings } from '../types/database'

type Phase = 'idle' | 'loading' | 'studying' | 'completed'

/**
 * The plan-item facts `record_answer_attempt` asserts an attempt against.
 *
 * Carried rather than re-read: the RPC compares these three against the row's own snapshot and
 * raises P0007 on any mismatch, so they have to be the values the screen is actually showing.
 */
export interface PlanItemRef {
  id: string
  activity_type: string
  response_type: string
  evaluator_type: string
}

/**
 * Study exactly this deck's share of a daily plan, in the order the planner ranked it.
 *
 * A study session is deck-scoped all the way down — `finalize_study_session` takes one
 * `p_deck_id` and refuses a session whose events span decks — so a plan covering three decks is
 * three sessions, not one heterogeneous queue. The caller splits it; this store studies one
 * deck's share and reports back which cards it finished.
 */
export interface PlanSelection {
  goalId: string
  /** Ordered card ids — the planner's ranking, preserved. */
  cardIds: readonly string[]
  /** card_id → its plan item. */
  items: Readonly<Record<string, PlanItemRef>>
}

interface StudyConfig {
  deckId: string
  mode: StudyMode
  batchSize: number
  uploadDateStart?: string
  uploadDateEnd?: string
  crammingFilter?: CrammingFilter
  crammingTimeLimitMinutes?: number | null
  crammingShuffle?: boolean
  /**
   * Present when this session IS the day's plan for one deck.
   *
   * Only meaningful with `mode: 'srs'`. The other five modes send no SRS payload and move no
   * schedule (`modeFeedsSrsSchedule`), so completing plan items from one of them would mark the
   * day done while leaving every input the planner reads untouched — tomorrow's plan would come
   * back identical. `apply_plan_study_rating` refuses anything but the four SRS ratings.
   */
  planSelection?: PlanSelection
  /**
   * Study exactly these cards, in this order.
   *
   * The diagnostics panel's "다시 볼 카드" button. Unlike `planSelection` this completes no plan
   * item — these cards were not on today's plan, which is rather the point: a card the learner
   * keeps failing is usually not due, so the ordinary queue below would never serve it.
   * Ratings take the normal `apply_study_rating` path and move the schedule like any other.
   */
  cardSelection?: string[]
  /**
   * Where this session came from, so its ending can go back there.
   *
   * A goal id when the session was started from that goal's learning plan — either the daily
   * plan or the diagnostics panel's 다시 볼 카드. Absent for an ordinary deck session.
   *
   * Separate from `planSelection`/`cardSelection` on purpose: those say WHICH CARDS to serve,
   * this says WHERE THE LEARNER WAS. Mobile had neither — finishing a plan session landed on
   * StudySetup, the top of the deck stack, so a learner who studied one weak card from the plan
   * was shown 학습 완료! / 덱으로 돌아가기 and walked out of the plan. Web carried it as a
   * `?goalId=` query param and only for the daily plan, so its weak-card link had the same
   * ending.
   */
  fromGoalId?: string
}

/** PostgREST puts `.in()` values in the query string, so a 500-item plan would blow the URL. */
const PLAN_CARD_FETCH_CHUNK = 100

interface SessionStats {
  totalCards: number
  cardsStudied: number
  ratings: Record<string, number>
  totalDurationMs: number
}

interface LastRatedCard {
  cardId: string
  /** Server rating-event id (apply_study_rating) so undo can compensate the DB. */
  ratingEventId: string | null
  /**
   * The attempt this rating also recorded — a plan item's, or a goal's.
   *
   * Undo has to reverse BOTH halves or it recreates the split `apply_plan_study_rating`
   * exists to prevent, backwards: the card goes back to its old schedule while the plan
   * keeps claiming it is done, and the item can never be completed again.
   *
   * For a goal attempt with no plan item (mig 244) there is nothing to reopen, but the
   * retracted answer must still not sit in the learner's diagnostics scoring a card they
   * un-rated. `undo_plan_study_rating` finds it by this id and deletes it.
   */
  planAttemptId: string | null
  previousCard: Card
  rating: string
  previousIndex: number
  previousStats: SessionStats
  timestamp: number
  srsQueueSnapshot: SrsQueueSnapshot | null
  crammingSnapshot: CrammingQueueSnapshot | null
}

interface PersistenceError {
  scope: 'rating' | 'session' | 'undo'
  code: string | null
  message: string
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
  /** Idempotency key for this study session's rating events and finalize call. */
  clientSessionId: string | null
  /** Last persistence failure surfaced by the atomic RPCs (fail-visible, no silent retry). */
  persistenceError: PersistenceError | null
  /** Serializes the persistence RPCs so finalize/undo can never overtake the apply
   *  they depend on. A finalize that commits first would drop the last rating from the
   *  server aggregate and make the late apply fail as "session already closed". */
  persistenceChain: Promise<void>
  /** 'pending' while a server undo is in flight. Undo is only reflected locally after
   *  the server accepts it, so the UI must block competing actions meanwhile. */
  undoState: 'idle' | 'pending'
  /** True once finalize_study_session has created this session's row. A second
   *  finalize is a no-op server-side (idempotent by session id), so a session that
   *  undo reopened must be corrected through refresh_study_session instead. */
  sessionFinalized: boolean

  initSession: (config: StudyConfig) => Promise<void>
  flipCard: () => void
  rateCard: (rating: string) => Promise<void>
  undoLastRating: () => Promise<void>
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
  clientSessionId: null,
  persistenceError: null,
  persistenceChain: Promise.resolve(),
  undoState: 'idle',
  sessionFinalized: false,

  initSession: async (config: StudyConfig) => {
    // Prevent double-init (React StrictMode / effect re-runs)
    if (get().phase === 'loading') return

    try {
      config = normalizeStudyConfig(config)
    } catch (err) {
      console.error('[study-store] invalid study config:', err)
      const now = Date.now()
      set({
        phase: 'completed',
        config: null,
        template: null,
        srsSettings: null,
        userId: null,
        srsSource: 'embedded',
        subscriptionLocked: false,
        queue: [],
        currentIndex: 0,
        isFlipped: false,
        isRating: false,
        exitDirection: null,
        cardStartTime: now,
        sessionStartedAt: now,
        sessionStats: { ...initialStats },
        studyState: null,
        srsQueueManager: null,
        crammingManager: null,
        maxCardPosition: 0,
        lastRatedCard: null,
        sessionSaved: false,
        clientSessionId: null,
        persistenceError: null,
        persistenceChain: Promise.resolve(),
        undoState: 'idle',
        sessionFinalized: false,
      })
      return
    }

    const check = guard.check('study_session_start', 'study_sessions_daily')
    if (!check.allowed) { set({ phase: 'idle' }); return }

    set({
      phase: 'loading',
      config,
      subscriptionLocked: false,
      // One idempotency key per session: rating events and finalize share it.
      clientSessionId: newPersistenceId(),
      persistenceError: null,
      persistenceChain: Promise.resolve(),
      undoState: 'idle',
      sessionFinalized: false,
    })

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
      let progressMap = new Map<string, UserCardProgress>()
      for (const p of progressRows) progressMap.set(p.card_id, p)

      // (P5B) apply_study_rating writes the EXISTING progress row and rejects a
      // missing one — the pre-cutover client papered over this with an upsert. A
      // publisher can add cards between subscriber syncs, so seed the gaps once per
      // session with the idempotent init RPC; otherwise those ratings would be lost.
      if (allCards.some(card => !progressMap.has(card.id))) {
        const { error: seedError } = await supabase.rpc('init_subscriber_progress', {
          p_user_id: user.id,
          p_deck_id: config.deckId,
        })
        if (seedError) {
          console.error('[study-store] init_subscriber_progress failed:', seedError.message)
        } else {
          const reloaded = await fetchAllRows<UserCardProgress>(() =>
            supabase.from('user_card_progress').select('*').eq('deck_id', config.deckId).eq('user_id', user.id))
          progressMap = new Map<string, UserCardProgress>()
          for (const p of reloaded) progressMap.set(p.card_id, p)
        }
      }

      mergedAll = allCards.map((card) => mergeCardWithProgress(card, progressMap.get(card.id)) as Card)
    }

    // Build card queue based on mode
    let cards: Card[] = []
    let srsQueueManager: SrsQueueManager | null = null
    const now = new Date().toISOString()

    switch (config.mode) {
      case 'srs': {
        // ── The day's plan for this deck ──────────────────────────────────────
        // The planner has already decided WHICH cards and HOW MANY, including its own
        // new-card intake cap, so none of the due/limit logic below applies: re-deriving
        // the queue here would silently drop rows the plan promised. Order is the
        // planner's ranking, not next_review_at.
        if (config.planSelection) {
          const wanted = config.planSelection.cardIds
          const rank = new Map(wanted.map((id, index) => [id, index]))
          let planCards: Card[]
          if (mergedAll) {
            planCards = mergedAll.filter((card) => rank.has(card.id))
          } else {
            planCards = []
            for (let i = 0; i < wanted.length; i += PLAN_CARD_FETCH_CHUNK) {
              const { data } = await supabase
                .from('cards')
                .select('*')
                .eq('deck_id', config.deckId)
                .in('id', wanted.slice(i, i + PLAN_CARD_FETCH_CHUNK) as string[])
              planCards.push(...((data ?? []) as Card[]))
            }
          }
          // A card the plan names but this deck no longer has (deleted since the plan was
          // built) simply does not appear. Its plan item stays pending, which is the honest
          // record — better than a queue entry that cannot be rendered.
          cards = planCards.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))

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

        // ── An explicit list of cards ─────────────────────────────────────────
        // The diagnostics panel names cards the learner keeps failing. They are usually NOT
        // due, so every due-date rule below would drop them — which is why this branch exists
        // rather than a filter on the ordinary queue. Same fetch shape as the plan branch;
        // the difference is downstream, where no plan item is completed.
        if (config.cardSelection) {
          const wanted = config.cardSelection
          const rank = new Map(wanted.map((id, index) => [id, index]))
          let picked: Card[]
          if (mergedAll) {
            picked = mergedAll.filter((card) => rank.has(card.id))
          } else {
            picked = []
            for (let i = 0; i < wanted.length; i += PLAN_CARD_FETCH_CHUNK) {
              const { data } = await supabase
                .from('cards')
                .select('*')
                .eq('deck_id', config.deckId)
                .in('id', wanted.slice(i, i + PLAN_CARD_FETCH_CHUNK))
              picked.push(...((data ?? []) as Card[]))
            }
          }
          // A card deleted since the diagnostics were computed simply does not appear, the
          // same way a plan names cards the deck may no longer have.
          cards = picked.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))

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
        // prev_srs_status is derived server-side by apply_study_rating from previous_srs
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

        // Use the same complete eligible set for owned and non-owned decks so a
        // server-side limit cannot split a duplicate sort_position group.
        const sequentialPool = mergedAll ?? await fetchAllRows<Card>(() => withArchiveBoundary(
          supabase
            .from('cards')
            .select('*')
            .eq('deck_id', config.deckId)
            .neq('srs_status', 'suspended'),
          activeThreshold,
        ).order('sort_position', { ascending: true }).order('id', { ascending: true }))

        cards = buildSequentialQueue(
          sequentialPool,
          typedStudyState.sequential_pos,
          config.batchSize,
        )
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
    const { queue, currentIndex, config, cardStartTime, sessionStats, srsSettings, srsSource, srsQueueManager, crammingManager, isRating, isFlipped, phase, studyState, userId, clientSessionId, undoState } = get()
    if (!config || isRating || !isFlipped || phase !== 'studying' || !userId) return
    // A rating landing while an undo is still in flight would be applied against the
    // pre-undo SRS revision and rejected (PT409), or worse, ordered after the undo and
    // silently undone with it. Wait for the undo to settle.
    if (undoState === 'pending') return

    const normalizedRating = normalizeRatingForMode(config.mode, rating)
    if (!normalizedRating) return
    rating = normalizedRating

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

    // One event id per rating: it is the server idempotency key, so it must be
    // allocated before any side effect and reused by undo.
    const ratingEventId = newPersistenceId()

    /**
     * The plan item this card came from, when this session IS the day's plan.
     *
     * Resolved here rather than at persist time because the undo snapshot below has to
     * carry the attempt id: undoing a plan rating must reopen the plan item too, and the
     * only handle on that item is the attempt that completed it.
     */
    const planItem = config.planSelection?.items[card.id] ?? null
    // Minted beside the rating it describes: `p_response` is part of the RPC's idempotency
    // comparison, so an id created any earlier could be replayed against a different rating.
    const clientAttemptId = planItem ? newPersistenceId() : null
    /**
     * The goal attempt this rating records when the card is NOT on today's plan.
     *
     * The diagnostics panel picks weak cards by reading `answer_attempts` for the goal, and a
     * weak card is by definition not on today's plan — so its rating found no plan item and
     * wrote no attempt, and the panel handed back the identical five cards no matter how many
     * times they were studied. Mig 244 records the rating as goal evidence instead, keyed by
     * the rating event id itself, which is why there is no second id to mint here.
     */
    const goalAttemptId = !planItem && config.fromGoalId ? ratingEventId : null

    // Save undo state before rating (including queue manager snapshots)
    set({
      isRating: true,
      exitDirection: getRatingExitDirection(rating),
      lastRatedCard: {
        cardId: card.id,
        ratingEventId,
        planAttemptId: clientAttemptId ?? goalAttemptId,
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
    // One timestamp for the optimistic queue update and the persisted payload so
    // local and server SRS state cannot disagree by a few milliseconds.
    const ratedAt = new Date().toISOString()
    // (P5B) prev/new interval + ease are derived server-side from previous_srs/new_srs
    // inside apply_study_rating, so the client no longer tracks them for the log row.
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
          last_reviewed_at: ratedAt,
        }
      }

      if (srsQueueManager) {
        srsQueueManager.rateCard(rating as SrsRating, srsResult)
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

    // ★ Background persistence — ONE atomic, idempotent RPC ★
    // apply_study_rating commits the SRS row, the rating event, and the study log
    // in a single transaction (migration 160). Splitting them (the pre-P5B path)
    // allowed partial success, duplicate logs, and stale overwrites.
    const isSrsPersist = modeFeedsSrsSchedule(config.mode) && srsResult !== null
    const persistSource = isSrsPersist ? srsSource : 'none'
    const expectedRevision = isSrsPersist ? (card.srs_revision ?? 0) : null
    const newSrsPayload = isSrsPersist && srsResult
      ? {
          srs_status: srsResult.srs_status,
          ease_factor: srsResult.ease_factor,
          interval_days: srsResult.interval_days,
          repetitions: srsResult.repetitions,
          next_review_at: srsResult.next_review_at,
          last_reviewed_at: ratedAt,
        }
      : null

    // initSession always assigns the session key; if it is somehow missing, mint and
    // store one rather than dropping the rating — losing a user's study data is worse
    // than a session row that starts mid-session. Storing it keeps every later rating
    // of this session under the same aggregate.
    let persistSessionId = clientSessionId
    if (!persistSessionId) {
      console.warn('[study-store] client session id missing; issuing a replacement')
      persistSessionId = newPersistenceId()
      set({ clientSessionId: persistSessionId })
    }

    // `planItem` / `clientAttemptId` are resolved with the undo snapshot above: present means
    // the rating goes through `apply_plan_study_rating`, which runs the same
    // `apply_study_rating` body AND completes the plan item in one transaction. Two separate
    // calls cannot be made safe from a client: whichever half fails second leaves the plan and
    // the schedule disagreeing. A card the plan does not name (an SRS requeue can only replay
    // cards already in the queue, so this is defensive) falls back to the plain rating.
    const applyRating = async () => {
      const { data, error } = planItem && config.planSelection && isSrsPersist
        ? await supabase.rpc('apply_plan_study_rating', {
          p_event_id: ratingEventId,
          p_client_session_id: persistSessionId,
          p_card_id: card.id,
          p_deck_id: config.deckId,
          p_rating: rating,
          p_srs_source: persistSource,
          p_client_attempt_id: clientAttemptId,
          p_goal_id: config.planSelection.goalId,
          p_plan_item_id: planItem.id,
          p_activity_type: planItem.activity_type,
          p_response_type: planItem.response_type,
          p_evaluator_type: planItem.evaluator_type,
          p_expected_revision: expectedRevision,
          p_new_srs: newSrsPayload,
          p_review_duration_ms: durationMs,
        }).then((r) => ({
          // The wrapper nests the rating result so the caller can see both halves; unwrap it
          // here so everything downstream reads the same shape as the plain path.
          data: (r.data as { rating?: unknown } | null)?.rating ?? null,
          error: r.error,
        }))
        : await supabase.rpc('apply_study_rating', {
          p_event_id: ratingEventId,
          p_client_session_id: persistSessionId,
          p_card_id: card.id,
          p_deck_id: config.deckId,
          p_study_mode: config.mode,
          p_rating: rating,
          p_srs_source: persistSource,
          p_expected_revision: expectedRevision,
          p_new_srs: newSrsPayload,
          p_review_duration_ms: durationMs,
          // Only when the learner came from a goal. The server records evidence for it only
          // if the card has no pending plan item — where a plan item exists it is still the
          // plan half that runs, unchanged (mig 244).
          p_goal_id: config.fromGoalId ?? null,
        })

      if (error) {
        // Never retry here: PT409 means another device already advanced the card and
        // re-sending would clobber it; 22023/42501/55000 are not retryable either.
        console.error(
          `[study-store] ${planItem ? 'apply_plan_study_rating' : 'apply_study_rating'} failed:`,
          error.message, error.code,
        )
        set({
          persistenceError: {
            scope: 'rating',
            code: (error as { code?: string }).code ?? null,
            message: error.message,
          },
        })
        return
      }

      // Keep the local expected revision in step with the server so the next
      // rating of this card is not rejected as stale.
      const appliedRevision = (data as { applied_revision?: number | null } | null)?.applied_revision
      if (typeof appliedRevision === 'number') {
        set({
          queue: get().queue.map(c => (c.id === card.id ? { ...c, srs_revision: appliedRevision } : c)),
        })
      }
    }

    // Never let the chain reject: a failed link must not block later persistence.
    set({
      persistenceChain: get().persistenceChain
        .then(applyRating)
        .catch(err => console.error('[study-store] persistence chain error:', err)),
    })


    // endSession also fire-and-forget
    if (isComplete) {
      get().endSession().catch(err => console.error('[study-store] endSession failed:', err))
    }
  },

  endSession: async () => {
    const { config, studyState, sessionStats, sessionStartedAt, maxCardPosition, crammingManager, userId, sessionSaved, clientSessionId, sessionFinalized, phase } = get()
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

    // ★ Atomic finalize — server aggregates + cursor in ONE transaction ★
    // finalize_study_session is idempotent per (user, client session id) and rejects a
    // cursor that no longer matches the DB, so a retry cannot double-count a session
    // or move the cursor twice. Client stats stay UI-only; the server recomputes them
    // from the applied rating events.
    if (sessionStats.cardsStudied > 0 && clientSessionId) {
      // Drain queued rating writes first: finalize_study_session aggregates the events
      // the server already has, and it closes the session against later applies.
      await get().persistenceChain

      // An undo can settle while this finalize waits its turn in the chain, so the
      // cursor inputs are re-read: the entry-time snapshot would push the cursor past
      // cards the user just took back.
      const { sessionStats: settledStats, queue: settledQueue } = get()
      if (settledStats.cardsStudied === 0) {
        // Everything was undone: there is nothing to record. Same phase rule as below.
        if (phase === 'studying' || get().phase !== 'studying') set({ phase: 'completed' })
        return
      }

      let cursorBefore: Record<string, number> | null = null
      let cursorAfter: Record<string, number> | null = null

      if (config.mode === 'sequential' && studyState && settledQueue.length > 0) {
        const typedState = studyState as DeckStudyState
        cursorBefore = { sequential_pos: typedState.sequential_pos }
        cursorAfter = {
          sequential_pos: computeSequentialPosition(
            settledQueue,
            settledStats.cardsStudied,
            typedState.sequential_pos,
            maxCardPosition,
          ),
        }
      } else if (config.mode === 'sequential_review' && studyState && settledQueue.length > 0) {
        // (S-L3) Authoritative single write of the final position. Passing the
        // full queue retains a partially studied duplicate-position group.
        const typedState = studyState as DeckStudyState
        cursorBefore = {
          new_start_pos: typedState.new_start_pos,
          review_start_pos: typedState.review_start_pos,
        }
        cursorAfter = computeSequentialReviewPositions(
          settledQueue.map(c => ({ sort_position: c.sort_position, srs_status: c.srs_status })),
          { new_start_pos: typedState.new_start_pos, review_start_pos: typedState.review_start_pos },
          maxCardPosition,
          settledStats.cardsStudied,
        )
      }

      const { error } = sessionFinalized
        // (P6) The row already exists, so finalize would return the FIRST result and
        // leave the aggregate describing the attempt the user undid. refresh
        // recomputes from the applied events and re-advances the cursor undo rewound.
        ? await supabase.rpc('refresh_study_session', {
          p_client_session_id: clientSessionId,
          p_cursor_before: cursorBefore,
          p_cursor_after: cursorAfter,
          p_metadata: metadata ?? null,
        })
        : await supabase.rpc('finalize_study_session', {
          p_client_session_id: clientSessionId,
          p_deck_id: config.deckId,
          p_study_mode: config.mode,
          p_started_at: new Date(sessionStartedAt).toISOString(),
          p_cursor_before: cursorBefore,
          p_cursor_after: cursorAfter,
          // (P5C) study_sessions is server-written only now; analytics ride along in the
          // same transaction and are merged UNDER the server's study_persistence key.
          p_metadata: metadata ?? null,
        })

      if (error) {
        const rpcName = sessionFinalized ? 'refresh_study_session' : 'finalize_study_session'
        console.error(`[study-store] ${rpcName} failed:`, error.message, error.code)
        set({
          persistenceError: {
            scope: 'session',
            code: (error as { code?: string }).code ?? null,
            message: error.message,
          },
        })
      } else {
        // Only a confirmed write may switch later completions onto the refresh path:
        // a failed finalize left no row, and finalize is safe to retry.
        set({ sessionFinalized: true })
      }
    }

    // An undo from the completion screen can move the user back into the session
    // while this finalize is in flight; forcing 'completed' here would yank them to
    // the summary screen. A direct endSession call (exit / time-up) still completes.
    if (phase === 'studying' || get().phase !== 'studying') set({ phase: 'completed' })
  },

  exitSession: async () => {
    const { phase, isRating, sessionStats, cardStartTime, undoState } = get()
    if (phase !== 'studying' || isRating) return
    // Ending mid-undo would finalize against stats the undo is about to take back.
    if (undoState === 'pending') return
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
    const { config, phase, isRating, sessionStats, cardStartTime, undoState } = get()
    if (!config || config.mode !== 'cramming') return
    // Guard: skip if already completed or a rating is in progress
    if (phase !== 'studying' || isRating) return
    // Ending mid-undo would finalize against stats the undo is about to take back.
    if (undoState === 'pending') return

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

  undoLastRating: async () => {
    const { lastRatedCard, phase, isRating, undoState } = get()
    if (!lastRatedCard || (phase !== 'studying' && phase !== 'completed')) return
    // A rating mid-flight owns the snapshot we would restore, and a second undo
    // would send the same event twice while the first is still deciding.
    if (isRating || undoState === 'pending') return
    const wasCompleted = phase === 'completed'

    set({ undoState: 'pending' })

    // Compensate the persisted rating BEFORE touching the UI: a local rollback the
    // server refuses leaves the screen claiming an undo the DB never made, and the
    // next rating of that card would then be recorded twice.
    // undo_study_rating is idempotent and only accepts the session's latest event.
    const undoEventId = lastRatedCard.ratingEventId
    // The attempt this rating also recorded, when the session is a plan. Undoing only the
    // schedule half would leave the plan claiming a card is done that has just been put back
    // on its old due date — and the item could never be completed again, because
    // `record_answer_attempt` only acts on a 'pending' row.
    const undoAttemptId = lastRatedCard.planAttemptId
    let restoredRevision: number | null = null

    if (undoEventId) {
      let accepted = true
      const undoRating = async () => {
        const { data, error } = undoAttemptId
          ? await supabase.rpc('undo_plan_study_rating', {
            p_event_id: undoEventId,
            p_client_attempt_id: undoAttemptId,
            // The wrapper nests the rating result; unwrap so everything below reads the
            // same shape as the plain path.
          }).then((r) => ({
            data: (r.data as { rating?: unknown } | null)?.rating ?? null,
            error: r.error,
          }))
          : await supabase.rpc('undo_study_rating', { p_event_id: undoEventId })
        if (error) {
          accepted = false
          console.error(
            `[study-store] ${undoAttemptId ? 'undo_plan_study_rating' : 'undo_study_rating'} failed:`,
            error.message, error.code,
          )
          set({
            persistenceError: {
              scope: 'undo',
              code: (error as { code?: string }).code ?? null,
              message: error.message,
            },
          })
          return
        }
        // undo restores the previous SRS values but keeps the revision moving
        // forward. Adopting it prevents the next rating of this card from being
        // rejected as stale (PT409). An already-undone event returns the same
        // payload, so a retry is a success too.
        const revision = (data as { applied_revision?: number | null } | null)?.applied_revision
        if (typeof revision === 'number') restoredRevision = revision
      }

      // Queued behind the apply for this event; otherwise undo can arrive first and
      // fail with P0002 while the UI has already rolled back.
      const queued = get().persistenceChain
        .then(undoRating)
        .catch(err => {
          accepted = false
          console.error('[study-store] persistence chain error:', err)
        })
      set({ persistenceChain: queued })
      await queued

      if (!accepted) {
        // Keep the rated state: it is what the server still holds, and lastRatedCard
        // stays so the user can retry the undo.
        set({ undoState: 'idle' })
        return
      }
    }

    // Restore queue manager internal state from snapshots
    const { queue, srsQueueManager, crammingManager } = get()
    if (lastRatedCard.srsQueueSnapshot && srsQueueManager) {
      srsQueueManager.restore(lastRatedCard.srsQueueSnapshot)
    }
    if (lastRatedCard.crammingSnapshot && crammingManager) {
      crammingManager.restore(lastRatedCard.crammingSnapshot)
    }

    // Restore the card's previous state in the queue, carrying the revision the
    // server moved to (the snapshot predates both the apply and the undo).
    const updatedQueue = queue.map(c =>
      c.id === lastRatedCard.cardId
        ? {
          ...lastRatedCard.previousCard,
          ...(restoredRevision !== null ? { srs_revision: restoredRevision } : {}),
        }
        : c
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
      // Undoing from the completion screen must let endSession record the corrected
      // session — otherwise the sessionSaved guard makes re-completion a no-op and
      // leaves the discarded attempt's study_sessions row (S-L4). The row itself is
      // corrected through refresh_study_session, not a second finalize.
      ...(wasCompleted ? { sessionSaved: false } : {}),
    })

    // Undoing the session's ONLY rating leaves a finalized row describing a session
    // that no longer happened — a 0-card, 0-minute entry in history and analytics.
    // refresh discards it; a later completion then finalizes a fresh row. undoState
    // stays 'pending' until this settles so a new rating cannot race the delete.
    const sessionIdToDiscard = get().clientSessionId
    if (wasCompleted && get().sessionFinalized && sessionIdToDiscard
        && lastRatedCard.previousStats.cardsStudied === 0) {
      const discardSession = async () => {
        const { data, error } = await supabase.rpc('refresh_study_session', {
          p_client_session_id: sessionIdToDiscard,
          p_cursor_before: null,
          p_cursor_after: null,
          p_metadata: null,
        })
        if (error) {
          console.error('[study-store] refresh_study_session failed:', error.message, error.code)
          set({
            persistenceError: {
              scope: 'session',
              code: (error as { code?: string }).code ?? null,
              message: error.message,
            },
          })
          return
        }
        // Only an actual delete may clear the marker: if a rating slipped in, the
        // server refreshed instead, and the row still has to be corrected by refresh.
        if ((data as { status?: string } | null)?.status === 'discarded') {
          set({ sessionFinalized: false })
        }
      }
      const queued = get().persistenceChain
        .then(discardSession)
        .catch(err => console.error('[study-store] persistence chain error:', err))
      set({ persistenceChain: queued })
      await queued
    }

    set({ undoState: 'idle' })
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
      clientSessionId: null,
      persistenceError: null,
      persistenceChain: Promise.resolve(),
      undoState: 'idle',
      sessionFinalized: false,
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

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}
