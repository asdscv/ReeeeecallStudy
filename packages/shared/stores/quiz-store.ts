// ─── Quiz store — generate a set, take it, see the result ───────────────────
//
// Quiz is its own feature, not a study mode. Card study is six ways of ordering one
// interaction (show, flip, self-rate); quiz is a different act, where the learner
// produces an answer and something else judges it. So it has its own tables (193), its
// own meter (194), its own RPCs (195), and this store.
//
// Two rules shape everything here:
//
//   1. THE CLIENT NEVER SEES AN ANSWER IT HAS NOT EARNED. `get_quiz_run_items` returns
//      the stem and the shuffled options and nothing else; `reference_answer`, the
//      distractor flaws and the essay rubric arrive only after the item is answered.
//      There is no client-side grading to be tampered with, and nothing to hide.
//   2. THE LEARNER APPROVES A PRICE BEFORE ANYTHING IS SPENT. `quote()` is a read; the
//      number it returns is passed back as `maxPriceMicro`, and the server refuses the
//      reservation if the price moved (P0008). No spending happens without a gesture.
import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { newPersistenceId } from '../lib/persistence-id'

export type QuizQuestionType = 'mcq' | 'short' | 'essay'
export type QuizScopeKind = 'deck' | 'tags' | 'cards'

/** Mirrors `ai_quiz_price_units.action`. `grade_mcq` is absent because it is free. */
export type QuizAction = 'generate_mcq' | 'generate_short' | 'generate_essay'
  | 'grade_short' | 'grade_essay'

/**
 * Cards per generation call, mirroring `MAX_QUIZ_BATCH` in `ai-quiz-prompts.ts`.
 *
 * Kept slightly UNDER the server's cap on purpose. The server refuses at 10/10/3; sending
 * exactly that leaves no room for a card list that grew between the quote and the call, and
 * a refusal there costs the learner the whole batch. The essay figure is 3 because a rubric
 * triples the output tokens per item — it is not a guess, it is the same number the server
 * enforces.
 *
 * If this ever exceeds the server's cap, every batch fails with AI_REQUEST_TOO_LARGE — which
 * is exactly the bug this batching exists to fix, so `quiz-batch-size.test.ts` pins the two
 * together.
 */
export const QUIZ_BATCH_SIZE: Record<QuizQuestionType, number> = {
  mcq: 8,
  short: 8,
  essay: 3,
}

export const QUIZ_GENERATE_ACTION: Record<QuizQuestionType, QuizAction> = {
  mcq: 'generate_mcq', short: 'generate_short', essay: 'generate_essay',
}
/** Multiple choice is missing on purpose: it is graded by index comparison, for free. */
export const QUIZ_GRADE_ACTION: Record<Exclude<QuizQuestionType, 'mcq'>, QuizAction> = {
  short: 'grade_short', essay: 'grade_essay',
}

export interface QuizQuote {
  action: string
  count: number
  units_each: number
  units_total: number
  trial_units: number
  free_units: number
  paid_units: number
  unit_price_micro: number
  price_micro: number
  balance_micro: number
  held_micro: number
  free_remaining_today: number
  trial_remaining: number
  max_units_per_call: number
  sufficient: boolean
}

export interface QuizzableCount { total: number; eligible: number }

/**
 * What 오늘의 확인 found, and — when it found nothing usable — why.
 *
 * `blocked` exists because the check's most common outcome on a real deck is not "nothing
 * studied" but "studied plenty, none of it resolvable": a template that names two primary
 * back fields cannot say which one is the answer, so every card of it is refused. Refusing is
 * correct; refusing invisibly is what made the section look like it did not exist.
 *
 * Only meaningful together with `studiedToday > 0 && checkable === 0`. A template that blocks
 * some cards while others work is not a thing to interrupt a learner about.
 */
export interface DailyCheckCount {
  /** Cards in the window that were studied. Named for 205's key; see `windowDays`. */
  studiedToday: number
  /** Of those, how many have a resolvable answer field. */
  checkable: number
  /** 1 = today. Larger means the server widened, and the copy must stop saying "today". */
  windowDays: number
  blocked: Array<{ template_id: string; name: string; cards: number }>
}

/**
 * A difficulty band, as the server lists them.
 *
 * Deliberately NOT an enum. The bands are rows in `quiz_difficulty_levels`, so adding or
 * retuning one is an INSERT, and this client renders whatever it is given. `nearRequired` is
 * how many of the three wrong options are near-misses — 0 is "recognise the subject area",
 * 3 is "you must know the answer".
 */
export interface QuizDifficultyBand {
  level: number
  near_required: number
  /** Advisory only since mig 202 — the band's real content is its prompt guidance. */
  near_max: number
  /** Which question types this band has guidance for; it is not offered for the others. */
  types?: string[]
  option_count: number
  allowed_flaws: string[]
  is_default: boolean
}

export interface QuizSetRow {
  id: string
  deck_id: string
  title: string
  question_type: QuizQuestionType
  requested_count: number
  generated_count: number
  status: 'ready' | 'stale' | 'archived'
  content_locale: string
  created_at: string
}

export interface QuizRunItem {
  item_id: string
  position: number
  status: 'pending' | 'answered' | 'graded' | 'failed' | 'void'
  question_type: QuizQuestionType
  stem: string
  /** Present for mcq only, already in display order. */
  options: string[] | null
  answered: boolean
  score: number | null
  feedback: Record<string, unknown> | null
  /** All three are null until the item is answered — see rule 1 in the header. */
  meta: Record<string, unknown> | null
  rubric: unknown[] | null
  reference_answer: string | null
  /**
   * The learner's own submission — `{ text }` for written answers, `{ choice }` for multiple
   * choice. Null until they answer.
   *
   * The result screen needs it to render the grading spans it already paid for: they are
   * character ranges into the learner's own words, and a screen without those words drops every
   * one of them silently.
   */
  response: Record<string, unknown> | null
}

/**
 * One thing the learner got wrong, ready to read without opening anything.
 *
 * `card_id` is what makes the list actionable rather than a report card — it is the same id
 * `StudyConfig.cardIds` takes, so "study these again" is one call away.
 */
export interface QuizMistake {
  attempt_id: string
  card_id: string | null
  deck_id: string | null
  deck_name: string | null
  question_type: QuizQuestionType
  stem: string
  reference_answer: string | null
  response: Record<string, unknown> | null
  score: number
  answered_at: string
}

export interface QuizRun {
  run_id: string
  set_id: string
  /**
   * What the SET is aiming for, which may exceed `item_count` while a long quiz is still
   * being generated. Without it a screen cannot tell "8 questions" from "8 so far".
   */
  requested_count?: number
  status: 'in_progress' | 'completed' | 'abandoned'
  attempt_no: number
  item_count: number
  answered_count: number
  score_raw: number
  score_max: number
  items: QuizRunItem[]
}

export interface QuizSubmitResult {
  attempt_id: string
  graded: boolean
  score: number | null
  /** mcq only, and only after answering: where the right option was shown. */
  correct_display_index: number | null
  reference_answer: string | null
}

/**
 * The error codes the UI has to tell apart, kept as a union so a screen cannot render a
 * raw server string at a learner. `AI_REQUEST_TOO_LARGE` and `AI_RATE_CAP` are separate
 * because the server raises separate SQLSTATEs for them: telling someone who asked for
 * too many questions that they are rate-limited sends them away for a day for nothing.
 */
export const QUIZ_ERROR_CODES = [
  'AI_INSUFFICIENT_CREDITS', 'AI_PRICE_CHANGED', 'AI_REQUEST_TOO_LARGE',
  'QUIZ_NOT_ENOUGH_CARDS', 'AI_RATE_CAP', 'FORBIDDEN', 'AI_EMPTY_RESULT',
  'QUIZ_UNGRADEABLE', 'QUIZ_GRADE_REFUSED', 'QUIZ_ITEM_GONE',
  'QUIZ_CARDS_TOO_SHORT', 'AI_PROVIDER_ERROR', 'AI_PROVIDER_BUSY', 'AI_PROVIDER_DAILY_LIMIT',
  // A band with no guidance for the chosen question type. `create_quiz_set` raises P0013 for it
  // and nothing mapped the code, so it arrived as UNKNOWN: "문제가 생겼어요. 다시 시도해 주세요."
  // The one thing that would fix it — pick another difficulty — was the one thing not said, and
  // retrying with the same settings fails identically every time.
  'QUIZ_DIFFICULTY_UNAVAILABLE',
  'UNKNOWN',
] as const
export type QuizErrorCode = typeof QUIZ_ERROR_CODES[number]

// Everything except UNKNOWN, which is what an unrecognised code BECOMES rather than
// something the server sends.
const KNOWN_CODES = new Set<string>(QUIZ_ERROR_CODES.filter((c) => c !== 'UNKNOWN'))

/**
 * An edge-function failure reduced to a code this app has a translated string for.
 *
 * `supabase.functions.invoke` puts a non-2xx body behind `error.context`, so the code the
 * server chose is only reachable by reading it. Anything unrecognised becomes 'UNKNOWN' —
 * which renders as a generic message rather than as English server text in a Thai UI.
 */
async function quizErrorCode(error: unknown): Promise<QuizErrorCode> {
  const context = (error as { context?: unknown })?.context
  if (context instanceof Response) {
    try {
      const body = await context.clone().json() as { code?: string }
      if (body.code && KNOWN_CODES.has(body.code as QuizErrorCode)) return body.code as QuizErrorCode
    } catch { /* fall through */ }
  }
  return 'UNKNOWN'
}

export class QuizError extends Error {
  // A plain field, not a constructor parameter property: `erasableSyntaxOnly` is on, and
  // parameter properties emit code rather than erasing to nothing.
  readonly code: QuizErrorCode
  constructor(code: QuizErrorCode) {
    super(code)
    this.code = code
  }
}

/**
 * A gesture id. One per user action, so a retried request reserves nothing new.
 *
 * `newPersistenceId`, NOT `crypto.randomUUID` — there is no global `crypto` in React
 * Native/Hermes and this app ships no polyfill, so the direct call threw a raw
 * ReferenceError. It was not even reported as one: the throw is not a `QuizError`, so the
 * catch fell through to the generic "something went wrong", and BOTH generation and grading
 * were dead on mobile while the web path worked perfectly. Found on a simulator, not by any
 * test — every automated check runs where `crypto` exists.
 *
 * The helper existed for exactly this, and says so in its own header.
 */
const newClientRef = newPersistenceId

interface QuizState {
  sets: QuizSetRow[]
  run: QuizRun | null
  loading: boolean
  generating: boolean
  grading: boolean
  /** The 오답 노트, as last loaded. Empty until `loadMistakes` runs. */
  mistakes: QuizMistake[]

  fetchSets: () => Promise<void>
  countQuizzable: (deckId: string, scope?: QuizScopeKind, tags?: string[], cardIds?: string[]) => Promise<QuizzableCount>
  difficultyLevels: () => Promise<QuizDifficultyBand[]>
  quote: (action: QuizAction, count: number) => Promise<QuizQuote>
  grantTrial: () => Promise<number>

  /** Progress while a long quiz is being generated batch by batch. `null` when idle. */
  generateProgress: { done: number; total: number } | null

  createAndGenerate: (input: {
    deckId: string
    title: string
    questionType: QuizQuestionType
    count: number
    locale: string
    scope?: QuizScopeKind
    tags?: string[]
    cardIds?: string[]
    difficulty?: number
    maxPriceMicro: number
  }) => Promise<string>

  /**
   * Today's check: how many of the studied cards can be checked.
   *
   * Separate from building it so a screen can decide whether to offer the button, and
   * say a real number, without creating a set the learner may never open.
   *
   * `lookback` widens the window when today has nothing — today always wins, and the
   * returned `windowDays` says which window the answer came from so the copy can stop
   * claiming "today" on a day the learner did not study. 1 keeps the 205 behaviour.
   */
  countDailyCheck: (timezone: string, lookback?: number) => Promise<DailyCheckCount>
  /**
   * Build (or reuse) the check and return its set id.
   *
   * Costs nothing: the question is the card's own prompt and the reference is its own
   * declared answer field, so no model is called. The learner is charged only later, and
   * only for answers a string comparison could not settle.
   *
   * `lookback` MUST match what `countDailyCheck` was asked, or the screen offers a check
   * the server then refuses.
   */
  buildDailyCheck: (input: {
    goalId?: string; timezone: string; limit?: number; lookback?: number
    /**
     * The UI language, which decides which side of a cross-lingual card the questions address
     * the learner in. Omitted means Korean — the literal the RPC used to hardcode for everyone.
     */
    locale?: string
  }) => Promise<string>

  startRun: (setId: string) => Promise<string>
  /**
   * Pull in questions written since this run opened, then reload it.
   *
   * A long quiz is still being generated while the learner answers the first batch, so the
   * run has to be able to grow. Idempotent — safe to call on every load and every advance.
   */
  refreshRun: (runId: string) => Promise<void>
  loadRun: (runId: string) => Promise<void>
  submit: (itemId: string, response: Record<string, unknown>, durationMs?: number) => Promise<QuizSubmitResult>
  gradeWithAi: (itemId: string, answer: string, maxPriceMicro: number) => Promise<void>
  override: (itemId: string, score: number) => Promise<void>
  finishRun: (runId: string) => Promise<void>

  /**
   * What the learner has been getting wrong, newest first.
   *
   * A read over attempts that were already being recorded and never read back. It writes
   * nothing and moves no SRS schedule: a quiz answer quietly rescheduling reviews would let one
   * casual sitting rearrange weeks of study, so the misses are shown and the decision to
   * restudy them stays the learner's.
   */
  loadMistakes: (deckId?: string, limit?: number) => Promise<void>
  /** How many distinct cards are in that list — a card missed four times is one card. */
  countMistakes: (deckId?: string) => Promise<number>

  /**
   * Remove a set that has never been taken, and drop it from the list.
   *
   * Only a set with no runs. Questions, runs, run items and the attempts under them all cascade
   * from a set, so deleting one the learner has sat would destroy every answer they gave it —
   * and their 오답 노트 entries for those cards with it. A set with a run is history; a set
   * without one is a row nobody has seen the inside of.
   *
   * Resolves false when the server refuses because it HAS been taken, so a screen can say so
   * without parsing an error.
   */
  deleteSet: (setId: string) => Promise<boolean>
}

export const useQuizStore = create<QuizState>((set, get) => ({
  sets: [],
  run: null,
  loading: false,
  generating: false,
  generateProgress: null,
  grading: false,
  mistakes: [],

  fetchSets: async () => {
    set({ loading: true })
    try {
      const { data, error } = await supabase
        .from('quiz_sets')
        .select('id, deck_id, title, question_type, requested_count, generated_count, status, content_locale, created_at')
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      set({ sets: (data ?? []) as QuizSetRow[] })
    } finally {
      set({ loading: false })
    }
  },

  countQuizzable: async (deckId, scope = 'deck', tags = [], cardIds = []) => {
    const read = async () => {
      const { data, error } = await supabase.rpc('count_quizzable_cards', {
        p_deck_id: deckId, p_scope_kind: scope, p_tags: tags, p_card_ids: cardIds,
      })
      if (error) throw error
      return (data ?? { total: 0, eligible: 0 }) as QuizzableCount
    }

    const counts = await read()
    // A deck with cards but nothing quizzable is almost always a template that declares two
    // answers on the back, or none — 342 of the 771 cards on the reporting account were refused
    // for exactly that. It is a question a model can settle from the author's own field labels,
    // once per template, so ask rather than showing a dead end and instructions to go and edit
    // a template. Free, and idempotent: a template that already has a key is not re-asked.
    if (counts.total > 0 && counts.eligible === 0) {
      try {
        const { error } = await supabase.functions.invoke('ai-generate', {
          body: { kind: 'quiz_answer_key', deckId },
        })
        if (!error) return await read()
      } catch {
        // The deck was unquizzable before and still is; the screen's own message covers it.
      }
    }
    return counts
  },

  difficultyLevels: async () => {
    const { data, error } = await supabase.rpc('get_quiz_difficulty_levels')
    if (error) throw error
    return (data ?? []) as QuizDifficultyBand[]
  },

  quote: async (action, count) => {
    const { data, error } = await supabase.rpc('get_ai_quiz_quote', {
      p_action: action, p_count: count,
    })
    if (error) throw error
    return data as QuizQuote
  },

  grantTrial: async () => {
    // Called when quiz is opened, not at signup: an allowance that expires unseen buys
    // nothing. The RPC is once-per-account, so calling it every visit is free.
    const { data, error } = await supabase.rpc('grant_ai_quiz_trial')
    if (error) throw error
    return (data as { units_remaining?: number })?.units_remaining ?? 0
  },

  createAndGenerate: async (input) => {
    set({ generating: true })
    try {
      // The set is created FIRST, and it chooses the cards — by the same eligibility rule
      // that counted them for the quote. Letting the edge function re-select would be a
      // fourth copy of that rule, free to disagree with the number the learner approved.
      const { data: created, error: createError } = await supabase.rpc('create_quiz_set', {
        p_deck_id: input.deckId,
        p_title: input.title,
        p_question_type: input.questionType,
        p_count: input.count,
        p_content_locale: input.locale,
        p_scope_kind: input.scope ?? 'deck',
        p_tags: input.tags ?? [],
        p_card_ids: input.cardIds ?? [],
        // NULL, not 3. `create_quiz_set` reads `is_default` from `quiz_difficulty_levels`
        // when this is null — hardcoding a level here meant an admin moving the default
        // band did nothing, and a deploy where band 3 is retired would 400.
        p_difficulty: input.difficulty ?? null,
      })
      if (createError) {
        throw new QuizError(createError.code === 'P0010' ? 'QUIZ_NOT_ENOUGH_CARDS'
          : createError.code === 'P0009' ? 'AI_REQUEST_TOO_LARGE'
          : createError.code === 'P0013' ? 'QUIZ_DIFFICULTY_UNAVAILABLE'
          : createError.code === '42501' ? 'FORBIDDEN' : 'UNKNOWN')
      }
      const result = created as {
        set_id: string
        cards: Array<{ card_id: string }>
        near_max?: number
        /** Other answers from the deck, used to fill the FAR slots a band leaves open. */
        fillers?: string[]
      }

      // ── Generate in batches ────────────────────────────────────────────────
      //
      // One call cannot hold a whole quiz. The edge function caps a call at
      // `QUIZ_BATCH_SIZE` cards, and that cap is real: five questions took 22.1s against a
      // 30s provider timeout. Sending everything at once is why 서술형 failed at EVERY
      // count the screen offered — its cap is 3 and the smallest option was 4.
      //
      // Each batch reserves, generates and settles on its own, so a batch that fails costs
      // nothing and leaves the ones that succeeded in place. `persist_quiz_questions`
      // appends (mig 207), so the set accumulates.
      const allCards = result.cards.map((c) => c.card_id)
      const size = QUIZ_BATCH_SIZE[input.questionType]
      const batches: string[][] = []
      for (let i = 0; i < allCards.length; i += size) batches.push(allCards.slice(i, i + size))

      set({ generateProgress: { done: 0, total: batches.length } })
      let firstError: unknown = null
      let delivered = 0

      /**
       * What the learner approved, drawn down as batches spend it.
       *
       * It used to be `maxPriceMicro / batches.length` — an even split of a quote whose free
       * units are anything but even. `reserve_ai_quiz` allocates trial, then today's free
       * units, then paid, PER CALL, so the free units all land on the first batch and the
       * paid units pile onto the later ones. The server refuses a call whose true price
       * exceeds the ceiling it was handed (P0008 -> AI_PRICE_CHANGED), and it checks that
       * BEFORE the balance, so a full wallet does not help.
       *
       * Measured against production with the free allowance spent and $50 in the wallet:
       * 12 multiple-choice questions quote 120,000 micro, the even split hands each batch
       * 60,000, and the first batch of eight really costs 80,000. Refused. Zero of twelve
       * questions delivered. Of the eight sizes the setup screen offers — 4, 6, 8, 10, 12,
       * 20, 30, 50 — everything above one batch failed the same way.
       *
       * A budget, not a quota: each batch is authorised for whatever is left of the total the
       * learner agreed to. The sum across batches still cannot exceed it, which is the
       * property the division was reaching for.
       */
      let budgetLeft = input.maxPriceMicro

      // The FIRST batch is awaited; the rest are not.
      //
      // Fifty multiple-choice questions is seven calls at roughly fifteen seconds each, so
      // waiting for all of them means about a hundred seconds of staring at a button. Worse,
      // it bills for questions nobody has seen yet: a learner who stops at question ten has
      // paid for fifty. Returning after the first batch lets the quiz be opened immediately
      // and lets the rest arrive while it is being answered — and a learner who abandons
      // early simply never requests the batches they would not have reached.
      /** This batch's cost if every unit in it were paid — the worst case, for drawdown. */
      const batchCeiling = (cards: number) =>
        Math.ceil((input.maxPriceMicro / Math.max(1, allCards.length)) * cards)

      const runBatch = async (cardIds: string[], index: number) => {
        const { error: genError } = await supabase.functions.invoke('ai-generate', {
          body: {
            kind: 'quiz_generate',
            setId: result.set_id,
            questionType: input.questionType,
            cardIds,
            fillers: result.fillers ?? [],
            clientRef: newClientRef(),
            // Whatever is left of the total the learner approved. The server prices this
            // call itself and refuses if it exceeds this, so the ceiling only has to be an
            // honest remaining budget — not a guess at this batch's share.
            maxPriceMicro: budgetLeft,
          },
        })
        if (genError) {
          // Keep going. A later batch may well succeed, and a quiz of 40 is worth more to
          // the learner than an error because question 12 could not be written. The first
          // failure is remembered in case NOTHING lands.
          if (firstError === null) firstError = genError
        } else {
          delivered += 1
          // Draw down by what this batch could have cost at the full paid rate. The server
          // does not report what it actually charged here, and over-estimating is the safe
          // direction: it can only stop us early, never overspend what was approved.
          budgetLeft = Math.max(0, budgetLeft - batchCeiling(cardIds.length))
        }
        set({ generateProgress: { done: index + 1, total: batches.length } })
      }

      await runBatch(batches[0], 0)

      // Only a total failure is an error, and only the FIRST batch can produce one: if
      // nothing at all was written there is no quiz to open. Anything later is
      // under-delivery, which the set list already discloses.
      if (delivered === 0 && firstError !== null) {
        throw new QuizError(await quizErrorCode(firstError))
      }

      if (batches.length > 1) {
        // Deliberately not awaited. The caller navigates now; these land behind it and are
        // picked up by `refreshRun`. Errors are swallowed for the same reason a later batch
        // failing is not fatal.
        void (async () => {
          for (let i = 1; i < batches.length; i++) {
            try { await runBatch(batches[i], i) } catch { /* under-delivery, not failure */ }
          }
          set({ generateProgress: null })
          await get().fetchSets().catch(() => {})
        })()
      }

      await get().fetchSets()
      return result.set_id
    } finally {
      set({ generating: false, generateProgress: null })
    }
  },

  countDailyCheck: async (timezone, lookback) => {
    const { data, error } = await supabase.rpc('count_daily_check_cards', {
      p_timezone: timezone,
      p_lookback: lookback ?? 1,
    })
    if (error) throw error
    const row = data as {
      studied_today: number; checkable: number
      window_days?: number
      blocked?: Array<{ template_id: string; name: string; cards: number }>
    }
    return {
      studiedToday: row.studied_today,
      checkable: row.checkable,
      // A server on 205 does not send it. Absent means today, which is what 205 did.
      windowDays: row.window_days ?? 1,
      // Absent on 205/209. An empty list is also the normal answer whenever the check works.
      blocked: row.blocked ?? [],
    }
  },

  buildDailyCheck: async ({ goalId, timezone, limit, lookback, locale }) => {
    const { data, error } = await supabase.rpc('build_daily_check', {
      p_goal_id: goalId ?? null,
      p_timezone: timezone,
      p_limit: limit ?? 8,
      p_lookback: lookback ?? 1,
      p_locale: locale ?? 'ko',
    })
    // P0010 is the only outcome a screen has to phrase: nothing was studied today, so
    // there is nothing to check. Everything else is a real fault.
    if (error) {
      throw new QuizError((error as { code?: string }).code === 'P0010'
        ? 'QUIZ_NOT_ENOUGH_CARDS' : 'UNKNOWN')
    }
    return (data as { set_id: string }).set_id
  },

  startRun: async (setId) => {
    const { data, error } = await supabase.rpc('start_quiz_run', { p_set_id: setId })
    if (error) throw error
    return (data as { run_id: string }).run_id
  },

  refreshRun: async (runId) => {
    // Failure here is not worth surfacing: the learner still has the questions they have,
    // and the next advance tries again.
    const { data } = await supabase.rpc('append_quiz_run_items', { p_run_id: runId })
    if ((data as { added?: number } | null)?.added) await get().loadRun(runId)
  },

  loadRun: async (runId) => {
    set({ loading: true })
    try {
      const { data, error } = await supabase.rpc('get_quiz_run_items', { p_run_id: runId })
      if (error) throw error
      set({ run: data as QuizRun })
    } finally {
      set({ loading: false })
    }
  },

  submit: async (itemId, response, durationMs) => {
    const { data, error } = await supabase.rpc('submit_quiz_answer', {
      p_run_item_id: itemId, p_response: response, p_duration_ms: durationMs ?? null,
    })
    if (error) {
      throw new QuizError(error.code === 'P0012' ? 'QUIZ_ITEM_GONE'
        : error.code === '42501' ? 'FORBIDDEN' : 'UNKNOWN')
    }
    return data as QuizSubmitResult
  },

  gradeWithAi: async (itemId, answer, maxPriceMicro) => {
    set({ grading: true })
    try {
      const { error } = await supabase.functions.invoke('ai-generate', {
        body: {
          kind: 'quiz_grade',
          runItemId: itemId,
          answer,
          clientRef: newClientRef(),
          maxPriceMicro,
        },
      })
      if (error) throw new QuizError(await quizErrorCode(error))
      const run = get().run
      if (run) await get().loadRun(run.run_id)
    } finally {
      set({ grading: false })
    }
  },

  override: async (itemId, score) => {
    const { error } = await supabase.rpc('override_quiz_grade', {
      p_run_item_id: itemId, p_score: score,
    })
    if (error) throw error
    const run = get().run
    if (run) await get().loadRun(run.run_id)
  },

  finishRun: async (runId) => {
    const { error } = await supabase.rpc('finish_quiz_run', { p_run_id: runId })
    if (error) throw error
    await get().loadRun(runId)
  },

  loadMistakes: async (deckId, limit) => {
    set({ loading: true })
    try {
      const { data, error } = await supabase.rpc('get_quiz_mistakes', {
        p_deck_id: deckId ?? null, p_limit: limit ?? 50,
      })
      if (error) throw error
      set({ mistakes: (data ?? []) as QuizMistake[] })
    } finally {
      set({ loading: false })
    }
  },

  countMistakes: async (deckId) => {
    const { data, error } = await supabase.rpc('count_quiz_mistakes', { p_deck_id: deckId ?? null })
    if (error) throw error
    return (data as number | null) ?? 0
  },

  deleteSet: async (setId) => {
    const { error } = await supabase.rpc('delete_quiz_set', { p_set_id: setId })
    // P0014 is "it has been taken", which is a refusal the learner should understand rather
    // than a fault. Anything else is real.
    if (error) {
      if ((error as { code?: string }).code === 'P0014') return false
      throw error
    }
    set({ sets: get().sets.filter((row) => row.id !== setId) })
    return true
  },
}))

/**
 * What the learner actually wrote, or the option they picked, as one readable line.
 *
 * The response shape is the submission payload — `{ text }` or `{ choice }` — and a mistakes
 * list that printed raw JSON would be unreadable. A choice INDEX is deliberately not resolved
 * to its option text here: the options were shuffled for that sitting and the stored order is
 * canonical, so an index off this row would name the wrong answer more often than not.
 */
export function mistakeResponseText(m: Pick<QuizMistake, 'response'>): string | null {
  const text = m.response?.text
  return typeof text === 'string' && text.trim() !== '' ? text.trim() : null
}

export interface MistakeDeckGroup {
  readonly deckId: string
  readonly deckName: string
  readonly items: readonly QuizMistake[]
}

/**
 * The misses, one row per card, bucketed by deck.
 *
 * Grouped because the deck is the unit a study session takes — cards from two decks cannot be one
 * session, so a flat list would offer a "study these again" button that cannot work.
 *
 * One row per card because a card missed four times is one card to restudy, not four copies of
 * the same stem. The input is newest-first, so the row kept is the most recent attempt: the
 * learner's latest answer is the one worth showing them.
 *
 * A miss whose card has been deleted is dropped. There is nothing to restudy and no deck to open,
 * and listing it would be a row whose only action is broken.
 */
export function groupMistakesByDeck(
  mistakes: readonly QuizMistake[],
): MistakeDeckGroup[] {
  const seen = new Set<string>()
  const byDeck = new Map<string, { deckId: string; deckName: string; items: QuizMistake[] }>()
  for (const m of mistakes) {
    if (!m.card_id || !m.deck_id) continue
    if (seen.has(m.card_id)) continue
    seen.add(m.card_id)
    const bucket = byDeck.get(m.deck_id)
    if (bucket) bucket.items.push(m)
    else byDeck.set(m.deck_id, { deckId: m.deck_id, deckName: m.deck_name ?? '', items: [m] })
  }
  return [...byDeck.values()]
}

/**
 * Why each wrong option is wrong, in the order the options were served.
 *
 * The model labels every distractor with a closed flaw name (never prose — see the
 * generation contract), and `get_quiz_run_items` permutes those labels through the same
 * shuffle as the options and withholds them until the learner has answered. `null` marks
 * the correct option. Anything that is not a string is dropped rather than rendered.
 */
export function optionFlaws(item: QuizRunItem): (string | null)[] {
  const raw = item.meta?.flaws
  if (!Array.isArray(raw)) return []
  return raw.map((f) => (typeof f === 'string' ? f : null))
}
