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
}

export interface QuizRun {
  run_id: string
  set_id: string
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

  fetchSets: () => Promise<void>
  countQuizzable: (deckId: string, scope?: QuizScopeKind, tags?: string[], cardIds?: string[]) => Promise<QuizzableCount>
  difficultyLevels: () => Promise<QuizDifficultyBand[]>
  quote: (action: QuizAction, count: number) => Promise<QuizQuote>
  grantTrial: () => Promise<number>

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
   * Today's check: how many of the cards studied today can be checked.
   *
   * Separate from building it so a screen can decide whether to offer the button, and
   * say a real number, without creating a set the learner may never open.
   */
  countDailyCheck: (timezone: string) => Promise<{ studiedToday: number; checkable: number }>
  /**
   * Build (or reuse) today's check and return its set id.
   *
   * Costs nothing: the question is the card's own prompt and the reference is its own
   * declared answer field, so no model is called. The learner is charged only later, and
   * only for answers a string comparison could not settle.
   */
  buildDailyCheck: (input: { goalId?: string; timezone: string; limit?: number }) => Promise<string>

  startRun: (setId: string) => Promise<string>
  loadRun: (runId: string) => Promise<void>
  submit: (itemId: string, response: Record<string, unknown>, durationMs?: number) => Promise<QuizSubmitResult>
  gradeWithAi: (itemId: string, answer: string, maxPriceMicro: number) => Promise<void>
  override: (itemId: string, score: number) => Promise<void>
  finishRun: (runId: string) => Promise<void>
}

export const useQuizStore = create<QuizState>((set, get) => ({
  sets: [],
  run: null,
  loading: false,
  generating: false,
  grading: false,

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
    const { data, error } = await supabase.rpc('count_quizzable_cards', {
      p_deck_id: deckId, p_scope_kind: scope, p_tags: tags, p_card_ids: cardIds,
    })
    if (error) throw error
    return (data ?? { total: 0, eligible: 0 }) as QuizzableCount
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
          : createError.code === '42501' ? 'FORBIDDEN' : 'UNKNOWN')
      }
      const result = created as {
        set_id: string
        cards: Array<{ card_id: string }>
        near_max?: number
        /** Other answers from the deck, used to fill the FAR slots a band leaves open. */
        fillers?: string[]
      }

      const { error: genError } = await supabase.functions.invoke('ai-generate', {
        body: {
          kind: 'quiz_generate',
          setId: result.set_id,
          questionType: input.questionType,
          cardIds: result.cards.map((c) => c.card_id),
          fillers: result.fillers ?? [],
          clientRef: newClientRef(),
          maxPriceMicro: input.maxPriceMicro,
        },
      })
      if (genError) throw new QuizError(await quizErrorCode(genError))

      await get().fetchSets()
      return result.set_id
    } finally {
      set({ generating: false })
    }
  },

  countDailyCheck: async (timezone) => {
    const { data, error } = await supabase.rpc('count_daily_check_cards', { p_timezone: timezone })
    if (error) throw error
    const row = data as { studied_today: number; checkable: number }
    return { studiedToday: row.studied_today, checkable: row.checkable }
  },

  buildDailyCheck: async ({ goalId, timezone, limit }) => {
    const { data, error } = await supabase.rpc('build_daily_check', {
      p_goal_id: goalId ?? null,
      p_timezone: timezone,
      p_limit: limit ?? 8,
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
}))

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
