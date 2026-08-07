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
export type QuizErrorCode =
  | 'AI_INSUFFICIENT_CREDITS' | 'AI_PRICE_CHANGED' | 'AI_REQUEST_TOO_LARGE'
  | 'QUIZ_NOT_ENOUGH_CARDS' | 'AI_RATE_CAP' | 'FORBIDDEN' | 'AI_EMPTY_RESULT'
  | 'QUIZ_UNGRADEABLE' | 'QUIZ_GRADE_REFUSED' | 'QUIZ_ITEM_GONE' | 'UNKNOWN'

const KNOWN_CODES = new Set<QuizErrorCode>([
  'AI_INSUFFICIENT_CREDITS', 'AI_PRICE_CHANGED', 'AI_REQUEST_TOO_LARGE',
  'QUIZ_NOT_ENOUGH_CARDS', 'AI_RATE_CAP', 'FORBIDDEN', 'AI_EMPTY_RESULT',
  'QUIZ_UNGRADEABLE', 'QUIZ_GRADE_REFUSED', 'QUIZ_ITEM_GONE',
])

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

/** A gesture id. One per user action, so a retried request reserves nothing new. */
function newClientRef(): string {
  return crypto.randomUUID()
}

interface QuizState {
  sets: QuizSetRow[]
  run: QuizRun | null
  loading: boolean
  generating: boolean
  grading: boolean

  fetchSets: () => Promise<void>
  countQuizzable: (deckId: string, scope?: QuizScopeKind, tags?: string[], cardIds?: string[]) => Promise<QuizzableCount>
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
    maxPriceMicro: number
  }) => Promise<string>

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
      })
      if (createError) {
        throw new QuizError(createError.code === 'P0010' ? 'QUIZ_NOT_ENOUGH_CARDS'
          : createError.code === 'P0009' ? 'AI_REQUEST_TOO_LARGE'
          : createError.code === '42501' ? 'FORBIDDEN' : 'UNKNOWN')
      }
      const result = created as { set_id: string; cards: Array<{ card_id: string }> }

      const { error: genError } = await supabase.functions.invoke('ai-generate', {
        body: {
          kind: 'quiz_generate',
          setId: result.set_id,
          questionType: input.questionType,
          cardIds: result.cards.map((c) => c.card_id),
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
