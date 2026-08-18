/**
 * The Quiz AI contract — what the model is allowed to return, and what we do when it doesn't.
 *
 * ## The one rule everything else falls out of
 *
 * This app has no ground truth about any subject. A card, however, carries its own answer: the
 * template declares which fields are the prompt and which single field is the answer
 * (`quiz-answer-field.ts`, and it returns null rather than guessing). So every quiz operation is
 * expressible without the model ever asserting a subject fact:
 *
 *   generation — rewrite/derive around a (promptText, answerText) pair the card supplies;
 *   grading    — decide whether the learner's text means the same as `answerText`.
 *
 * Neither is a knowledge task. The moment a design needs the model to know something the card
 * does not say, it is the wrong design. Two consequences are load-bearing here and are worth
 * naming before the types:
 *
 *   1. **The model never writes the correct answer.** For multiple choice it returns only
 *      distractors; the server inserts the card's own answer as the correct option. A model that
 *      cannot type the right answer cannot mistype it, and cannot put it in a fixed position.
 *   2. **The model never writes learner-facing feedback.** It returns a verdict from a closed
 *      set and *character spans into text we already hold* — the learner's own submission, or
 *      the card's own answer. Every rendered sentence is a hand-translated string keyed off the
 *      verdict. See `QuizSpan` for why that is not a lesser kind of feedback.
 *
 * The exception, stated so it is not smuggled: **questions are model-authored prose.** A quiz
 * needs a question and there is no closed set of them. That text is constrained instead — by an
 * anchor it must contain, by the expected answer it must not contain, and by a length cap — and
 * it is the ONLY model-authored string this feature renders. `validateQuizGeneration` is the
 * whole of the containment argument.
 *
 * ## Why this file is here and imports nothing
 *
 * Same reason as `ai-remediation.ts` and `card-answer.ts`: `supabase/functions/` is what gets
 * deployed, and reaching into `packages/` from here makes the deployed bundle depend on a
 * directory that is not part of it. Pure TS, no Deno/npm APIs, no imports → loadable by both the
 * edge runtime and vitest. The validators run SERVER-side, before anything is persisted and
 * before the wallet is charged; the client renders already-validated rows and re-validates
 * nothing, because a second opinion at render time cannot un-charge a call.
 */

// ─── Vocabulary ─────────────────────────────────────────────────────────────

export const QUIZ_TYPES = ['multiple_choice', 'short_answer', 'essay'] as const
export type QuizType = typeof QUIZ_TYPES[number]

/**
 * How a distractor departs from the card's answer. A distractor must name one, and no two
 * distractors in an item may name the same one.
 *
 * This enum is the answer to "how do you stop the model returning distractors that are also
 * correct". Not by asking it not to — by making the *only* legal move a stated transformation of
 * the card's own answer. A model that must say HOW an option is wrong writes a different, and
 * much narrower, kind of option than one told to "generate three plausible alternatives", which
 * is an instruction to write things that could be right.
 *
 * Distinctness is the second half. Three variants of `adjacent_sense` is one distractor shown
 * three times, and it is also the shape most likely to contain an accidental correct answer.
 *
 * The labels describe the SHAPE of the wrongness, never its subject matter — the same discipline
 * `weak-themes.ts` applies — so they hold for a pharmacology deck as well as a JLPT one, and
 * each has one hand-translated string used to explain the option after the learner answers.
 */
export const MCQ_DISTRACTOR_FLAWS = [
  /** Reverses the answer's direction or polarity. 貸す/借りる, plaintiff/defendant, acid/base. */
  'opposite',
  /** A near neighbour in meaning that this card's answer excludes. */
  'adjacent_sense',
  /** The right kind of thing, but not this one. */
  'right_category_wrong_item',
  /** Exactly one part of a multi-part answer, so it is true but incomplete. */
  'partial',
  /** True of a wider class, and therefore not the answer to THIS prompt. */
  'overgeneral',
  /** Resembles the answer in spelling or sound without being it. affect/effect, 待つ/持つ. */
  'plausible_form',
  /**
   * From a different subject area entirely — no relation to the answer beyond both being
   * words. Exists so an EASY quiz is possible at all: a learner meeting a deck for the first
   * time is served by "which of these four is even in the right area", and every other flaw
   * here is a near-miss that assumes they are already past that.
   */
  'unrelated',
] as const
export type McqDistractorFlaw = typeof MCQ_DISTRACTOR_FLAWS[number]

/**
 * How close to the answer each flaw sits.
 *
 * This is the axis difficulty moves along. A quiz is hard when the wrong options are near the
 * answer and easy when they are far from it, so a level is expressed as HOW MANY of the three
 * distractors must be near — not as a vague "hard" the model interprets for itself.
 *
 *   near — you have to know the answer to rule it out
 *   far  — recognising the subject area is enough to rule it out
 */
export const NEAR_FLAWS: ReadonlySet<McqDistractorFlaw> = new Set([
  'opposite', 'adjacent_sense', 'partial', 'plausible_form',
])
export const FAR_FLAWS: ReadonlySet<McqDistractorFlaw> = new Set([
  'right_category_wrong_item', 'overgeneral', 'unrelated',
])

/**
 * A difficulty band, as the server resolved it.
 *
 * `nearRequired` is the only knob today, and it is a NUMBER rather than a name so new bands
 * need no code: a level is a row, and the row says how many of the three distractors must be
 * near-misses. 0 is "all far" (easiest), 3 is "all near" (hardest).
 */
export interface QuizDifficulty {
  readonly level: number
  /** MINIMUM near-miss distractors. Binding for a hard band. */
  readonly nearRequired: number
  /**
   * MAXIMUM near-miss distractors. Binding for an easy band.
   *
   * A RANGE, not an exact count. Exact was tried and dropped every item a real model
   * produced — three coin flips per question, and losing means the learner paid for
   * nothing. Only the binding side of each band is enforced, which is also all the band
   * actually promises: "easy" claims no near-misses, "hard" claims it is not winnable by
   * elimination, and neither cares about the other end.
   */
  readonly nearMax: number
  /** How many options the question shows, 2..6. Distractors are one fewer. */
  readonly optionCount: number
  /** Restrict to these flaws. Empty means all of them. */
  readonly allowedFlaws: readonly McqDistractorFlaw[]
  /**
   * The band's instruction for THIS question type, inserted into the prompt verbatim.
   *
   * This is where difficulty lives now. "Be unrelated" fails at every phrasing because it
   * names no target; "use a concrete object where the answer is an action" succeeds because
   * it names one. And because it is text, short answer and essay get a difficulty too —
   * which a near-miss count could never give them.
   */
  readonly guidance?: string
}

/** Fallback when a caller does not resolve a band — the hardest, which is what shipped first. */
export const DEFAULT_DIFFICULTY: QuizDifficulty = {
  level: 3, nearRequired: 2, nearMax: 3, optionCount: 4, allowedFlaws: [],
}

/**
 * How a short-answer question may differ from the card's front.
 *
 * The product owner rejected using the card front verbatim: it retrieves nothing the card study
 * flow does not already retrieve. But "vary the angle" cannot mean "ask something else about the
 * subject", because we do not know anything else about the subject. So every angle is a
 * REARRANGEMENT of the two texts the card already supplies, and each one fixes, without the
 * model's help, both where the expected answer comes from and what the question must be anchored
 * in. See `angleGrounding`.
 */
export const SHORT_ANSWER_ANGLES = [
  /** Give the answer, ask for the prompt. The retrieval runs the other way; expected = prompt. */
  'reverse',
  /** The answer removed from a sentence built out of the card's own text; expected = answer. */
  'cloze',
  /** The same retrieval, worded differently; expected = answer. The riskiest angle — see below. */
  'restate',
  /** Ask for a named non-answer field the card carries; expected = that field's value. */
  'field_probe',
] as const
export type ShortAnswerAngle = typeof SHORT_ANSWER_ANGLES[number]

/**
 * What an essay criterion can be about.
 *
 * A rubric whose criteria are model-written prose ("demonstrates a nuanced understanding") is the
 * free-form `blocks[]` failure wearing a different hat: unrenderable, untranslatable, and
 * unapplied — two graders reading it disagree, and one grader reading it twice disagrees with
 * itself. So a criterion is a closed aspect plus a weight plus quoted terms, and the whole
 * learner-facing rendering is `t(aspect) + the terms, which came from their own card`.
 */
export const ESSAY_ASPECTS = [
  /** States what the card's answer states. Mandatory, exactly once, and highest-weighted. */
  'covers_answer',
  /** Uses the terms the card names, rather than talking around them. */
  'uses_key_terms',
  /** Gives the reason or mechanism the card's answer implies. */
  'explains_why',
  /** Supplies an instance. */
  'gives_example',
  /** Names a boundary or exception the card mentions. */
  'states_limits',
  /** The response is organised and finished, rather than a fragment. */
  'structure',
] as const
export type EssayAspect = typeof ESSAY_ASPECTS[number]

/**
 * Target length, as a band rather than a word count.
 *
 * "About 150 words" is meaningless in Thai and Japanese, and the eight locales include both. The
 * band maps to one hand-written string per locale, which says whatever that language counts in.
 */
export const ESSAY_LENGTH_BANDS = ['short', 'medium', 'long'] as const
export type EssayLengthBand = typeof ESSAY_LENGTH_BANDS[number]

/**
 * The grader's judgement of a short answer. Closed, and each maps to one translated sentence.
 *
 * `unjudgeable` is the `no_pattern` of this enum: the model MUST have a way to decline, or it
 * will force a `different` and the learner loses a mark to our bug. Declining REFUNDS the call
 * and records no attempt — see `GRADE_REFUSALS`.
 */
export const SHORT_ANSWER_VERDICTS = [
  'equivalent',
  'equivalent_with_error',
  'partial',
  'different',
  'empty',
  'unjudgeable',
] as const
export type ShortAnswerVerdict = typeof SHORT_ANSWER_VERDICTS[number]

/**
 * The score range each verdict permits, as [lo, hi] inclusive.
 *
 * The model returns both a verdict and a score, and they can disagree. The verdict wins: it is
 * drawn from a closed set and is what renders, so a score outside its band is clamped into it
 * rather than the item being dropped. Clamping cannot invent a grade — the band was already
 * fixed by a validated enum member — and dropping would leave a learner who paid for a grade
 * with nothing, which is the worse of the two failures.
 */
export const SHORT_ANSWER_BANDS: Readonly<Record<ShortAnswerVerdict, readonly [number, number]>> = {
  equivalent: [0.9, 1],
  equivalent_with_error: [0.7, 0.9],
  partial: [0.3, 0.7],
  different: [0, 0.3],
  empty: [0, 0],
  unjudgeable: [0, 0],
}

/** The specifics under the verdict. Closed, ≤3 per grade, each one translated string. */
export const SHORT_ANSWER_GAPS = [
  /** The reference states something the answer does not. */
  'missing_part',
  /** The answer states something the reference does not. Not automatically wrong; shown as-is. */
  'extra_claim',
  /** The answer inverts the relation. lend/borrow, cause/effect. */
  'wrong_direction',
  /** The answer names a broader class than the reference does. */
  'too_vague',
  /** Surface error only — the meaning arrived. */
  'spelling',
  /** Answered in a language other than the reference's. Advisory unless the item is cross-lingual. */
  'wrong_language',
] as const
export type ShortAnswerGap = typeof SHORT_ANSWER_GAPS[number]

/** Per-criterion outcome for an essay. The overall score is derived from these, never returned. */
export const ESSAY_LEVELS = ['met', 'partial', 'not_met', 'unjudgeable'] as const
export type EssayLevel = typeof ESSAY_LEVELS[number]

const ESSAY_LEVEL_SCORE: Readonly<Record<Exclude<EssayLevel, 'unjudgeable'>, number>> = {
  met: 1,
  partial: 0.5,
  not_met: 0,
}

/**
 * Why a grading call produced no grade. Every one of these REFUNDS.
 *
 * There is no "default to 0" and no "default to 0.5". `normalized_score` feeds the planner, so a
 * fabricated grade does not merely mislead the learner for one screen — it steers what they are
 * shown tomorrow. Refusing is the same call `SERVED_REMEDIATION_ACTIONS` makes about `evaluate`,
 * and it is the reason `evaluate` can now be served at all.
 */
export const GRADE_REFUSALS = [
  /** Nothing was submitted, or too little to grade. Caught BEFORE the model call — no charge. */
  'empty_response',
  /** Over the input cap. Rejected, not truncated: grading half an essay is grading a different one. */
  'response_too_long',
  /** The model declined, or declined on most of an essay's weight. Refund. */
  'model_declined',
  /** The response did not satisfy the contract. Refund, do NOT retry — see the module note. */
  'invalid_result',
] as const
export type GradeRefusal = typeof GRADE_REFUSALS[number]

// ─── Bounds ─────────────────────────────────────────────────────────────────

/**
 * Four options: one correct, three distractors.
 *
 * Not five. The cost difference is noise at $0.10/$0.40 per Mtok; the binding constraint is a
 * 375pt phone screen, where a fifth option pushes the last one under the fold and turns "read all
 * the options" into "scroll, which most learners will not do". Dropping the guess rate from 25%
 * to 20% does not buy that back. Fixed rather than configurable so the renderer is a fixed grid
 * and the validator is an equality check.
 */
/** The band's default. A band may set 2..6; nothing below assumes this number. */
export const MCQ_OPTION_COUNT = 4
export const MCQ_DISTRACTOR_COUNT = MCQ_OPTION_COUNT - 1

/**
 * How much longer the correct option may be than the mean distractor before the item is dropped.
 *
 * Length cueing is the oldest way to pass a multiple-choice test without knowing anything: the
 * long, hedged, careful option is the written one. Our correct option is the card's answer
 * verbatim, so we cannot shorten it — we drop the item and let the deck's other cards carry the
 * quiz instead.
 */
export const MCQ_MAX_LENGTH_CUE_RATIO = 1.8

export const ESSAY_MIN_CRITERIA = 2
/** Four is the most a grader applies consistently and a learner reads. Beyond it, weights are noise. */
export const ESSAY_MAX_CRITERIA = 4
export const ESSAY_MENTIONS_PER_CRITERION = 3
export const ESSAY_WEIGHT_TOTAL = 100

export const MAX_QUESTION_CHARS = 400

/**
 * 모범답안의 상한.
 *
 * 채점이 끝난 뒤에만 보여 주는 글입니다. 서술형에서 학습자가 받는 것이 점수와 지적뿐이면
 * "그럼 뭐라고 썼어야 하나"에 답할 것이 없고, 그 답을 다시 사게 만드는 것(해설 $0.03)은
 * 이미 산 문항이 못 한 일을 또 파는 것입니다.
 *
 * 600자인 이유는 출력 예산입니다. 한 번의 호출이 서술형 3문항까지 만들고(`MAX_QUIZ_BATCH`),
 * 문항당 600자면 최악이 1,800자 — 문항·루브릭까지 합쳐 `OUTPUT_CAP.quiz_generate` 안쪽입니다.
 */
export const MODEL_ANSWER_MAX_CHARS = 600
export const MAX_DISTRACTOR_CHARS = 200
/** A span covering the whole essay is not evidence of anything. */
export const MAX_SPAN_CHARS = 200
export const MAX_GAPS_PER_GRADE = 3
/** How many span candidates are examined before the rest are ignored. Bounds work, not quality. */
export const MAX_SPANS_CONSIDERED = 16

/**
 * The learner controls this text, and therefore our token bill. Rejected over the cap, not
 * truncated — grading the first 2,000 characters of a 4,000-character essay grades something
 * they did not write, and charges them for it.
 *
 * The cap is what makes the FLAT price safe, so it is worth knowing what the worst case actually
 * costs. Measured against the real grader (same prompt, same model, a three-criterion rubric,
 * Korean text — the densest case, since Korean spends more tokens per character than English):
 *
 *        300 chars   input   860 / output 162 tokens   $0.000458
 *      1,000 chars   input 1,180 / output 195          $0.000588
 *      2,000 chars   input 1,634 / output 195          $0.000701
 *      4,000 chars   input 2,543 / output 162          $0.000879   ← the cap
 *
 * At the cap the grade costs $0.0009 against a $0.10 price — 114x, where `price-floor.test.ts`
 * demands 10x. Answer length barely moves it: the rubric, the question and the system prompt
 * dominate. The cap is about bounding a pathological paste, not about the price.
 */
export const MAX_LEARNER_CHARS: Readonly<Record<Exclude<QuizType, 'multiple_choice'>, number>> = {
  short_answer: 300,
  // 카드 한 장이 4,000자까지인데(`CARD_MAX_CHARS`, mig 257) 그 카드에 대한 답이 2,000자에서
  // 막히면 학습자가 납득할 수 있는 규칙이 아닙니다. 원가로도 막을 이유가 없습니다 — 위 표의
  // 4,000자 줄이 $0.000879, 값 $0.10 의 114분의 1입니다.
  essay: 4000,
}
/**
 * Below this there is nothing to grade, and no model call is made. Zero cost, zero charge.
 *
 * ONE character. Not forty.
 *
 * Essay used to require 40, and that was us deciding what counts as an answer. It is not our
 * call: the learner writes what they write and the grader grades it. A three-word answer to a
 * three-criterion rubric is a real answer that scores badly — which is information — and the
 * rubric produces that verdict without any help from a length rule.
 *
 * What the 40 actually produced was worse than a low score. `gradeGate` refuses before the model
 * is called, the refusal reached the screen as "처리하지 못했어요 · 다시 시도" (see `refusalFrom`),
 * and the retry could never work because the answer was unchanged. A learner who wrote a short
 * true answer was told the app was broken, forever.
 *
 * The floor stays at 1 so that an EMPTY submission still costs nothing: there is no answer to
 * grade in an empty box, and that is a fact about the string rather than a judgement about the
 * learner.
 */
export const MIN_GRADEABLE_CHARS: Readonly<Record<Exclude<QuizType, 'multiple_choice'>, number>> = {
  short_answer: 1,
  essay: 1,
}

/**
 * Serve a generation batch only if this fraction of the requested items survived validation.
 *
 * Dropping bad items is free — validation runs before `charge_ai_generation` — but serving two
 * items when ten were asked for is a worse outcome than failing, because the learner has started
 * a quiz that ends immediately. Below the floor the whole job is released (`release_ai_job`) and
 * the call answers `AI_EMPTY_RESULT`, exactly as the empty-result guard already does.
 */
export const QUIZ_MIN_SERVED_FRACTION = 0.5

// ─── Guards ─────────────────────────────────────────────────────────────────

const inSet = <T extends string>(set: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (set as readonly string[]).includes(v)

export const isQuizType = (v: unknown): v is QuizType => inSet(QUIZ_TYPES, v)
export const isMcqDistractorFlaw = (v: unknown): v is McqDistractorFlaw => inSet(MCQ_DISTRACTOR_FLAWS, v)
export const isShortAnswerAngle = (v: unknown): v is ShortAnswerAngle => inSet(SHORT_ANSWER_ANGLES, v)
export const isEssayAspect = (v: unknown): v is EssayAspect => inSet(ESSAY_ASPECTS, v)
export const isEssayLengthBand = (v: unknown): v is EssayLengthBand => inSet(ESSAY_LENGTH_BANDS, v)
export const isShortAnswerVerdict = (v: unknown): v is ShortAnswerVerdict => inSet(SHORT_ANSWER_VERDICTS, v)
export const isShortAnswerGap = (v: unknown): v is ShortAnswerGap => inSet(SHORT_ANSWER_GAPS, v)
export const isEssayLevel = (v: unknown): v is EssayLevel => inSet(ESSAY_LEVELS, v)

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// ─── Text primitives ────────────────────────────────────────────────────────

/**
 * The comparison form of a piece of study content.
 *
 * NFKC first, because half-width カナ and full-width ＡＢＣ are the same content typed on a
 * different keyboard, and a learner should never lose a mark to an IME. Then case-folded, then
 * stripped of everything that is not a letter, digit, or mark.
 *
 * Whitespace goes with the punctuation on purpose. Half the eight locales do not write spaces
 * between words, so a containment check that respects them is a containment check that works in
 * English and not in Japanese — and dropping them also defeats the "a n s w e r" spacing dodge in
 * a leaked question. The cost is that `the cat` and `thecat` compare equal, which for a
 * memorisation app is the answer we want anyway.
 */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '')
}

/**
 * Whether `haystack` contains `needle`, both normalized.
 *
 * `minChars` exists because a one-character reference answer (漢, "a") is a substring of almost
 * every sentence, so an unguarded leak check would reject every question ever written for a kanji
 * deck. Below the floor the check abstains — it reports `false`, and the item is judged on its
 * other constraints — rather than pretending to a certainty it does not have.
 *
 * ── 이 함수를 근거 검사에 쓰지 마십시오 ────────────────────────────────────
 *
 * 여기서 `false` 는 "포함되지 않았다"가 아니라 **"판단하지 않았다"** 입니다. 유출 검사
 * (`answer_leaked_in_question`)에서는 그 기권이 문항을 살리는 쪽으로 작동합니다 — 못 판단했으니
 * 유출이라고 하지 않는다.
 *
 * 그런데 같은 `false` 가 근거 검사에서는 문항을 **죽입니다**: "카드에서 베꼈다는 이 용어가
 * 카드에 없다". 그래서 한 글자 용어는 카드에 **있어도** 근거 없음으로 처리됐습니다. 중국어 덱
 * 429장 중 140장(32.6%)이 한 글자 답이고, 그 카드들은 서술형 문항이 한 번도 나올 수
 * 없었습니다. "요청은 3문항인데 2문항만 온다"의 정체가 이것입니다.
 *
 * 규칙: **판단 불가는 언제나 문항을 살리는 쪽으로.** 근거는 `mentionsTerm`, 앵커는
 * `anchorSatisfied` 를 쓰십시오.
 */
export function containsNormalized(haystack: string, needle: string, minChars = 2): boolean {
  const n = normalizeAnswer(needle)
  if (n.length < minChars) return false
  return normalizeAnswer(haystack).includes(n)
}

/**
 * 모델이 "카드에서 베꼈다"고 한 용어가 **정말 카드에 있는가**.
 *
 * 길이 하한이 없습니다. 여기서 haystack 은 모델의 산문이 아니라 **우리 카드의 글**이라,
 * 한 글자가 우연히 섞여 들 걱정이 없습니다 — 카드에 `吗` 가 있으면 그건 정말 그 카드의
 * 내용입니다. 하한을 그대로 쓰면 한 글자 답을 가진 카드는 영원히 근거를 못 댑니다.
 */
export function mentionsTerm(cardText: string, term: string): boolean {
  const t = normalizeAnswer(term)
  if (t === '') return false
  return normalizeAnswer(cardText).includes(t)
}

/**
 * 문항이 카드의 질문면을 담고 있는가 — **판단할 수 있을 때만** 따집니다.
 *
 * 앵커가 한 글자면 "담겼는지"를 모델 산문 위에서 신뢰할 수 없습니다. 그때는 요구하지 않습니다.
 * 못 판단한 것을 근거로 문항을 떨어뜨리면, 짧은 카드를 가진 학습자만 조용히 손해를 봅니다.
 */
export function anchorSatisfied(question: string, anchor: string): boolean {
  const a = normalizeAnswer(anchor)
  if (a.length < 2) return true
  return normalizeAnswer(question).includes(a)
}

/** The separators human deck authors use inside a single answer field. */
const PART_SEPARATORS = /\s*[/;,、，；]\s*|\s+\/\s+/g

/**
 * The parts of a multi-part answer, normalized and de-duplicated.
 *
 * The answer is ONE field — `quiz-answer-field.ts` resolves the single `primary` back-layout
 * field and leaves the hint and the example behind as context — so a multi-part answer here is
 * one a human wrote that way: "sodium, potassium", "설립하다 / 세우다". Returns a single-element
 * list for an answer with no separators, which is what makes `partial` unavailable for such an
 * answer below.
 */
export function answerParts(answer: string): string[] {
  const parts = answer.split(PART_SEPARATORS).map(normalizeAnswer).filter((p) => p.length > 0)
  return [...new Set(parts.length > 0 ? parts : [normalizeAnswer(answer)])].filter((p) => p.length > 0)
}

/**
 * Inline markup a model reaches for when it wants to emphasise a word.
 *
 * A real generation returned `When you <b>pledge</b> something, you ____.` The screens render a
 * question as TEXT — React escapes it — so the learner sees the tags. That is the same failure
 * as the AI feature that printed raw JSON at people, arriving by a narrower door.
 *
 * Stripped rather than rejected: the question is good, and discarding it would throw away an
 * item the learner paid for over a formatting slip. A WHITELIST of tag names, not a general
 * `<[^>]*>`, so a maths card asking about `x<y>z` keeps its text.
 */
const MARKUP_TAG = /<\/?(?:b|i|u|em|strong|br|p|span|div|code|mark|small|sub|sup)\b[^>]*>/gi

/** A model-authored question with inline markup removed and whitespace collapsed. */
export function stripQuestionMarkup(question: string): string {
  return question.replace(MARKUP_TAG, '').replace(/\s+/g, ' ').trim()
}

/**
 * Words that name OUR data rather than the learner's subject.
 *
 * A real generation produced "What is the prompt for '빌려주다'?" — the model copied the noun
 * out of the instruction that described the angle. The instruction is fixed too, but a rule the
 * model is asked to follow is not the same as one it cannot break, and this is the only
 * model-authored string this feature renders.
 *
 * Deliberately short and English-only: these are the identifiers in our JSON, and a question in
 * any language that contains one of them was written about the payload rather than the subject.
 * A learner's own card could legitimately contain "card" (a deck about poker, say) — so this is
 * matched on WORD BOUNDARIES and only in the question, never in an answer or a distractor.
 */
const SCHEMA_WORDS = /\b(prompt|cardId|otherFields|probeFieldKey|answer field|field_\d+)\b/i

/** Whether a model-authored question is talking about our JSON instead of the learner's cards. */
export function leaksSchemaWord(question: string): boolean {
  return SCHEMA_WORDS.test(question)
}

export type ScriptClass =
  | 'han' | 'kana' | 'hangul' | 'thai' | 'cyrillic' | 'arabic' | 'devanagari' | 'latin' | 'unknown'

const SCRIPT_PATTERNS: ReadonlyArray<readonly [Exclude<ScriptClass, 'unknown'>, RegExp]> = [
  ['han', /[㐀-䶿一-鿿豈-﫿]/gu],
  ['kana', /[぀-ヿｦ-ﾝ]/gu],
  ['hangul', /[ᄀ-ᇿ㄰-㆏가-힯]/gu],
  ['thai', /[฀-๿]/gu],
  ['cyrillic', /[Ѐ-ӿ]/gu],
  ['arabic', /[؀-ۿݐ-ݿ]/gu],
  ['devanagari', /[ऀ-ॿ]/gu],
  ['latin', /[A-Za-zÀ-ɏ]/gu],
]

/** The script most of a string is written in, or `unknown` when nothing dominates. */
export function dominantScript(text: string): ScriptClass {
  let best: ScriptClass = 'unknown'
  let bestCount = 0
  let total = 0
  for (const [name, pattern] of SCRIPT_PATTERNS) {
    const count = (text.match(pattern) ?? []).length
    total += count
    if (count > bestCount) { best = name; bestCount = count }
  }
  // A tie or a near-tie is not dominance. Half the characters is the floor.
  return total > 0 && bestCount * 2 >= total ? best : 'unknown'
}

/**
 * Whether two strings are written in compatible scripts.
 *
 * `unknown` on either side abstains — a two-digit answer has no script and must not be rejected
 * for it. Han and kana are compatible because Japanese is written in both, and rejecting a kana
 * distractor against a kanji answer would refuse the single most useful distractor a Japanese
 * deck can have.
 */
export function scriptCompatible(a: string, b: string): boolean {
  const sa = dominantScript(a)
  const sb = dominantScript(b)
  if (sa === 'unknown' || sb === 'unknown' || sa === sb) return true
  const cjk = new Set<ScriptClass>(['han', 'kana'])
  return cjk.has(sa) && cjk.has(sb)
}

/** FNV-1a over UTF-16 code units. Deterministic, dependency-free, and enough to place an option. */
function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Where the correct option sits, derived from the item's own id.
 *
 * Not `Math.random()`. The position has to survive a reload — a learner who backgrounds the app
 * mid-question and returns to find the answer has moved is being told the quiz is not real — and
 * it has to be reproducible in a test. A uuid is uniform, so `hash32 mod 4` is uniform, and the
 * model has no input to it whatsoever: position bias is not mitigated here, it is unreachable.
 */
export function correctOptionIndex(itemId: string, optionCount = MCQ_OPTION_COUNT): number {
  return hash32(itemId) % Math.max(2, optionCount)
}

// ─── Generation: what the server assembles, per card ────────────────────────

/**
 * One card, reduced to the only thing quiz generation is allowed to see.
 *
 * Built server-side from `quiz-answer-field.ts`, which returns null rather than guessing which
 * field is the answer. A card it cannot resolve is EXCLUDED from the batch — never included with
 * a positional guess, which for the official word templates is inverted and would build a whole
 * quiz around the wrong half of every card.
 *
 * `answerText` is ONE field — the one the template marked `primary` — not the whole back of the
 * card. That distinction is load-bearing three times over: a learner typing the word alone is
 * correct, four options built from it do not contain the answer inside one of them, and the right
 * option is not the conspicuously longest.
 */
export interface QuizCardSource {
  readonly cardId: string
  /** The card's declared prompt fields, joined. */
  readonly promptText: string
  /** The card's single graded field. The correct MCQ option, and the grading reference. */
  readonly answerText: string
  /**
   * Everything else on the card: the back-face hint and example that are no longer part of the
   * answer, plus any field on neither layout. Available to `field_probe`, and passed to a grader
   * as context. Nothing here can cost a learner marks, because nothing here was asked for.
   */
  readonly extraFields: ReadonlyArray<{ readonly key: string; readonly label: string; readonly value: string }>
  /**
   * Other answers from the same deck, to fill the FAR slots a band leaves open.
   *
   * A model will not write a deliberately unrelated wrong answer — asked for wrong options
   * for `lend → 빌려주다` it returns 빌리다, 갚다, 임대하다 at every phrasing of the
   * instruction, because everything it knows pulls toward the prompt's neighbourhood.
   * Fighting that cost three deploys and dropped every item on bands 1 and 2.
   *
   * So the model is only ever asked for the NEAR distractors it is good at, and the rest
   * come from here: guaranteed wrong (they answer a different card), guaranteed in the
   * answer's own language and script, and free.
   */
  readonly fillers: readonly string[]
  /**
   * Prompt and answer are in different scripts — so producing the answer IN ITS OWN LANGUAGE is
   * plausibly the point of the card.
   *
   * Derived from the card's own text, never from a belief about the subject. It is the only thing
   * that lets `wrong_language` cost a learner marks, and only on the cards where it can.
   */
  readonly crossLingual: boolean
}

export function buildQuizCardSource(
  cardId: string,
  promptText: string,
  answerText: string,
  extraFields: ReadonlyArray<{ key: string; label: string; value: string }> = [],
  fillers: readonly string[] = [],
): QuizCardSource | null {
  const prompt = promptText.trim()
  const answer = answerText.trim()
  if (prompt === '' || answer === '') return null
  return {
    cardId,
    promptText: prompt,
    answerText: answer,
    extraFields: extraFields.filter((f) => f.value.trim() !== ''),
    // Never this card's own answer, never blank, never a duplicate.
    fillers: [...new Set(fillers.map((f) => f.trim()).filter(
      (f) => f !== '' && normalizeAnswer(f) !== normalizeAnswer(answer)))],
    crossLingual: !scriptCompatible(prompt, answer),
  }
}

// ─── Generation: the validated items ────────────────────────────────────────

export interface QuizItemMultipleChoice {
  readonly type: 'multiple_choice'
  readonly itemId: string
  readonly cardId: string
  /**
   * The question the learner answers.
   *
   * Model-authored, then checked: it may not leak the answer, name our JSON keys, or run past
   * `MAX_QUESTION_CHARS`. A stem that fails any of those falls back to the card's own prompt —
   * which is what this field held for every item until then, and reads as a title rather than a
   * question on any card whose front is a heading ("인수분해 공식(1) - 완전제곱식", four formulas
   * below it and no word about which to pick).
   */
  readonly question: string
  /** Exactly `MCQ_OPTION_COUNT`, assembled server-side with the card's answer at `correctIndex`. */
  readonly options: readonly string[]
  readonly correctIndex: number
  /** Parallel to `options`; null at `correctIndex`. Renders the post-answer explanation. */
  readonly flaws: ReadonlyArray<McqDistractorFlaw | null>
  /**
   * What separates each wrong option from the answer. Parallel to `options`, null at
   * `correctIndex`.
   *
   * Written HERE, with the question, rather than bought per answer afterwards. The axis depends
   * on which option was picked, so 245 computed it after the fact — one extra provider call per
   * answered question, at $0.05, with its own latency and its own way to fail after the learner
   * had already committed. Writing one axis per distractor at generation time makes all four
   * possible answers explained in advance: the learner picks, and the explanation is already
   * there, free and instant. `grade_mcq` is gone with it.
   */
  readonly axes: ReadonlyArray<McqExplanationAxis | null>
  /**
   * The near-miss count fell outside the band's advisory range.
   *
   * Recorded, not enforced — enforcing it dropped every item on the easy bands. It exists so
   * a band whose instruction has stopped working shows up in the logs rather than only to
   * someone reading the questions.
   */
  readonly offBand?: boolean
}

export interface QuizItemShortAnswer {
  readonly type: 'short_answer'
  readonly itemId: string
  readonly cardId: string
  readonly angle: ShortAnswerAngle
  /** Model-authored. Validated to contain its anchor and to not contain `expected`. */
  readonly question: string
  /** Server-filled from the card, per `angleGrounding`. The model never writes this. */
  readonly expected: string
  readonly crossLingual: boolean
}

export interface EssayCriterion {
  readonly id: string
  readonly aspect: EssayAspect
  /** Integer, 1..100. Weights across an item's criteria sum to `ESSAY_WEIGHT_TOTAL`. */
  readonly weight: number
  /** Terms quoted out of the card's own prompt/answer. Never model-invented — each is grounded. */
  readonly mustMention: readonly string[]
}

export interface QuizItemEssay {
  readonly type: 'essay'
  readonly itemId: string
  readonly cardId: string
  readonly question: string
  readonly lengthBand: EssayLengthBand
  readonly criteria: readonly EssayCriterion[]
  /** The card's answer. What the grader compares against; shown to the learner after they submit. */
  readonly reference: string
  /**
   * 모범답안. 채점 뒤에만 보여 줍니다.
   *
   * **없을 수 있습니다.** 모델이 못 쓰거나 검사를 통과 못 하면 이 필드만 버리고 문항은 그대로
   * 살립니다 — 모범답안 하나 때문에 문항을 떨어뜨리면, 이 저장소가 이미 두 번 겪은
   * "검증이 너무 빡세서 아무것도 안 남는" 실패를 세 번째로 만드는 것입니다.
   */
  readonly modelAnswer: string | null
}

export type QuizItem = QuizItemMultipleChoice | QuizItemShortAnswer | QuizItemEssay

/**
 * Where a short-answer angle takes its expected answer from, and what its question must contain.
 *
 * Fixed by the angle, not chosen by the model, which is what keeps the expected answer out of the
 * model's hands entirely. `restate` has no anchor — it is the one angle that may reword freely,
 * and so the one whose only guarantee is that it does not leak the answer. It is included because
 * without it every short-answer quiz on a two-field deck is a cloze, and rejected as the default
 * for the same reason: `buildShortAnswerPrompt` asks for a spread of angles.
 */
export function angleGrounding(
  angle: ShortAnswerAngle,
  card: QuizCardSource,
  probeFieldKey?: string,
): { expected: string; anchor: string | null } | null {
  switch (angle) {
    case 'reverse':
      return { expected: card.promptText, anchor: card.answerText }
    case 'cloze':
      return { expected: card.answerText, anchor: card.promptText }
    case 'restate':
      return { expected: card.answerText, anchor: null }
    case 'field_probe': {
      const field = card.extraFields.find((f) => f.key === probeFieldKey)
      // No such field on this card — the model named one it was not given. Same refusal
      // `validateWeakThemes` makes for an unknown card id, and for the same reason.
      if (!field) return null
      return { expected: field.value, anchor: card.promptText }
    }
    default:
      return null
  }
}

/** Why an item was dropped. Logged per drop; a batch's drop reasons are the prompt's report card. */
export const QUIZ_DROP_REASONS = [
  'unknown_card', 'duplicate_card', 'bad_shape', 'bad_enum', 'question_too_long',
  'answer_leaked_in_question', 'anchor_missing', 'too_few_distractors', 'distractor_equals_answer',
  'distractor_duplicated', 'distractor_contains_answer', 'partial_not_applicable',
  'schema_word_leaked', 'wrong_difficulty_mix',
  'length_cue', 'script_mismatch', 'bad_weights', 'bad_criteria', 'ungrounded_mention',
] as const
export type QuizDropReason = typeof QUIZ_DROP_REASONS[number]

export interface QuizGenerationOutcome {
  readonly items: readonly QuizItem[]
  readonly dropped: ReadonlyArray<{ readonly cardId: string | null; readonly reason: QuizDropReason }>
  /** False → release the job and answer AI_EMPTY_RESULT. The learner is charged nothing. */
  readonly servable: boolean
}

/** Deterministic item ids, so a re-parse of the same response yields the same option order. */
export type ItemIdFactory = (cardId: string, index: number) => string

function outcome(
  items: QuizItem[],
  dropped: Array<{ cardId: string | null; reason: QuizDropReason }>,
  requested: number,
): QuizGenerationOutcome {
  return { items, dropped, servable: requested > 0 && items.length >= Math.ceil(requested * QUIZ_MIN_SERVED_FRACTION) }
}

/** The envelope every generation response shares. `[]` for anything that is not a list of items. */
function rawItems(raw: unknown): Record<string, unknown>[] {
  if (!isRecord(raw)) return []
  const items = raw.items
  if (!Array.isArray(items)) return []
  return items.filter(isRecord)
}

// ─── Generation: multiple choice ────────────────────────────────────────────

/**
 * Validate an MCQ generation response and assemble the options.
 *
 * The model returned distractors and nothing else. Everything a learner will see as the CORRECT
 * option comes from `sources`, so the checks below are entirely about whether the three wrong
 * options are safely wrong:
 *
 *   * normalized-equal to the answer → it is a second correct option. Drop the distractor.
 *   * normalized-equal to another distractor → the same option twice. Drop the later one.
 *   * containment either way → "a mammal" against "a mammal that lays eggs" leaves two defensible
 *     answers. Drop, EXCEPT for `partial`, whose entire definition is a proper part of a
 *     multi-part answer — and which is therefore only legal when the answer HAS parts.
 *
 * A repeated FLAW LABEL is explicitly allowed. Requiring three different labels was tried and
 * removed: on a real eight-word deck (lend / borrow / owe / repay / lease / rent …) it dropped
 * every single item, because the three best distractors for a vocabulary card genuinely are
 * three `adjacent_sense` neighbours. Worse, the rule did not prevent what it was aimed at — a
 * model with three near-synonyms simply mislabels one of them to satisfy it, which produces a
 * WRONG post-answer explanation. Substance is checked by the equality, duplication and
 * containment tests above; the label is a rendering hint, not a distinctness guarantee.
 *   * a script the answer is not written in → the classic "English distractors against a 漢字
 *     answer", which a learner spots without reading them.
 *
 * Fewer than three survivors is a DROPPED ITEM, not a three-option question: shipping the short
 * item silently changes the guess rate the learner is being scored against.
 */
export function validateMultipleChoiceGeneration(
  raw: unknown,
  sources: readonly QuizCardSource[],
  makeItemId: ItemIdFactory,
  difficulty: QuizDifficulty = DEFAULT_DIFFICULTY,
): QuizGenerationOutcome {
  const optionCount = Math.min(6, Math.max(2, difficulty.optionCount || MCQ_OPTION_COUNT))
  const distractorCount = optionCount - 1
  // Empty means "any flaw"; a non-empty list restricts the band, and the near/far split
  // still applies on top of it.
  const allowed = difficulty.allowedFlaws?.length
    ? new Set<McqDistractorFlaw>(difficulty.allowedFlaws) : null

  const byId = new Map(sources.map((s) => [s.cardId, s]))
  const used = new Set<string>()
  const items: QuizItemMultipleChoice[] = []
  const dropped: Array<{ cardId: string | null; reason: QuizDropReason }> = []
  const drop = (cardId: string | null, reason: QuizDropReason) => { dropped.push({ cardId, reason }) }

  for (const [index, entry] of rawItems(raw).entries()) {
    const cardId = typeof entry.cardId === 'string' ? entry.cardId : null
    const card = cardId ? byId.get(cardId) : undefined
    if (!cardId || !card) { drop(cardId, 'unknown_card'); continue }
    if (used.has(cardId)) { drop(cardId, 'duplicate_card'); continue }
    if (!Array.isArray(entry.distractors)) { drop(cardId, 'bad_shape'); continue }

    const answerNorm = normalizeAnswer(card.answerText)
    const parts = answerParts(card.answerText)
    const multiPart = parts.length > 1
    const seen = new Set<string>([answerNorm])
    const texts: string[] = []
    const flaws: McqDistractorFlaw[] = []
    /** One per accepted distractor, same index. `null` when the model gave none we recognise. */
    const axes: Array<McqExplanationAxis | null> = []

    for (const d of entry.distractors) {
      if (texts.length >= distractorCount) break
      if (!isRecord(d)) { drop(cardId, 'bad_shape'); continue }
      const text = typeof d.text === 'string' ? d.text.trim() : ''
      const flaw = d.flaw
      if (text === '' || text.length > MAX_DISTRACTOR_CHARS) { drop(cardId, 'bad_shape'); continue }
      if (!isMcqDistractorFlaw(flaw)) { drop(cardId, 'bad_enum'); continue }

      const norm = normalizeAnswer(text)
      if (norm === '') { drop(cardId, 'bad_shape'); continue }
      if (norm === answerNorm) { drop(cardId, 'distractor_equals_answer'); continue }
      if (seen.has(norm)) { drop(cardId, 'distractor_duplicated'); continue }

      let effectiveFlaw: McqDistractorFlaw = flaw
      if (flaw === 'partial') {
        // `partial` is legal only when it is exactly one declared part of a multi-part answer.
        // Anything looser makes "a substring of the answer" acceptable, which is the trap this
        // whole containment check exists to close.
        if (multiPart && parts.includes(norm)) {
          // legitimate
        } else if (answerNorm.includes(norm) || norm.includes(answerNorm)) {
          // Claimed `partial` AND overlaps the answer, on a card that has no parts. That is
          // the actual trap, and it stays a drop.
          drop(cardId, 'partial_not_applicable'); continue
        } else {
          // Claimed `partial` on a single-part answer, but the text does not overlap the
          // answer at all — so it is a perfectly good wrong option with the wrong LABEL.
          // Dropping it cost the whole item on real single-part vocabulary decks, because
          // losing one distractor of three fails `too_few_distractors`. The flaw is a
          // rendering hint; relabelling is honest and keeps the question.
          effectiveFlaw = 'adjacent_sense'
        }
      } else if (answerNorm.includes(norm)) {
        // The distractor is PART OF the answer — "발효" against 발효시키다. That is the trap
        // this check exists to close: the option is not wrong, it is incomplete, and a
        // learner who picks it has not made a mistake we can defend marking.
        drop(cardId, 'distractor_contains_answer'); continue
      }
      // Deliberately NOT dropped: the reverse direction, where the distractor CONTAINS the
      // answer. 빙하 (glacier) → 빙하기 (ice age); rent → rented; 항구 → 항구도시. These are
      // different words that happen to share a stem, which is the definition of a near-miss
      // — the `plausible_form` and `same_root` flaws exist to label exactly this.
      //
      // Both directions used to drop, and on a Korean noun deck that killed band 3 (the
      // DEFAULT band) outright: every item lost distractors to `distractor_contains_answer`
      // and then the item itself to `too_few_distractors`, so the whole generation returned
      // AI_EMPTY_RESULT. Korean compounds share morphemes by construction; so do English
      // inflections. Asking for near-misses and then rejecting shared stems asks for
      // something the language does not offer.
      //
      // The cosmetic case this used to guard — the answer with decoration bolted on — cannot
      // reach here: `normalizeAnswer` strips punctuation, spacing and case, so "빙하." and
      // "빙하" normalise to the same string and are caught above as `distractor_equals_answer`.
      // Surviving containment therefore means genuinely different letters.

      if (!scriptCompatible(text, card.answerText)) { drop(cardId, 'script_mismatch'); continue }

      seen.add(norm)
      texts.push(text)
      flaws.push(effectiveFlaw)
      // An unrecognised axis is dropped to null, NOT a reason to drop the option.
      //
      // The flaw label is what the item needs to be gradeable; the axis is the extra sentence.
      // Refusing the whole distractor over a missing explanation would trade a working question
      // for a nicer one, and `too_few_distractors` would then cost the learner the whole item.
      axes.push(isMcqExplanationAxis(d.axis) ? d.axis : null)
    }

    // Fill the FAR slots the band left open from the deck, rather than from the model.
    // The model was asked for `nearMax` near-misses and nothing else; everything below that
    // count is a slot this card's neighbours fill better and for free.
    if (texts.length < distractorCount) {
      for (const filler of card.fillers) {
        if (texts.length >= distractorCount) break
        const norm = normalizeAnswer(filler)
        if (norm === '' || norm === answerNorm || seen.has(norm)) continue
        if (answerNorm.includes(norm) || norm.includes(answerNorm)) continue
        // AND not a longer or shorter spelling of an option we already have.
        //
        // `seen` only catches an EXACT normalised match. A deck-mate whose answer field carries a
        // formula plus a mnemonic on a second line — `a²−b²=(a+b)(a−b)\n(제곱)−(제곱)=(합)×(차)` —
        // is not equal to a model distractor of `a²−b²=(a+b)(a−b)`, so both were shown, and two
        // options saying the same thing is one option shown twice. Reported on a maths deck.
        if (texts.some((t) => {
          const other = normalizeAnswer(t)
          return other !== '' && (other.includes(norm) || norm.includes(other))
        })) continue
        if (!scriptCompatible(filler, card.answerText)) continue
        seen.add(norm)
        texts.push(filler)
        // A deck-mate is wrong because it answers a DIFFERENT card, which is what
        // `right_category_wrong_item` means. It is also a FAR flaw, which is what makes the
        // band arithmetic come out right.
        flaws.push('right_category_wrong_item')
        // And that is exactly the `category` axis: it belongs to a different item, so no model
        // call is needed to know what separates it from this answer.
        axes.push('category')
      }
    }
    if (texts.length < distractorCount) { drop(cardId, 'too_few_distractors'); continue }


    /**
     * The QUESTION, written by the model — with the card's prompt as the fallback.
     *
     * It used to be `card.promptText`, always. On a vocabulary card that reads acceptably
     * ("timber" with four meanings under it), but on a card whose front is a heading it is not a
     * question at all: a maths deck produced the stem "인수분해 공식(1) - 완전제곱식" with four
     * formulas under it and nothing telling the learner what to do with them.
     *
     * The prompt now asks for a sentence. The fallback stays because a missing or rejected stem
     * must not cost the item — degrading to the old behaviour shows a heading, which is worse
     * than a question and better than nothing.
     */
    const offered = typeof entry.question === 'string' ? stripQuestionMarkup(entry.question) : ''
    const stemUsable = offered !== ''
      && offered.length <= MAX_QUESTION_CHARS
      && !leaksSchemaWord(offered)
      // The answer must not be in the question, by the same rule the other two types use.
      && !containsNormalized(offered, card.answerText)
    const stem = stemUsable ? offered : card.promptText

    const meanDistractor = texts.reduce((sum, t) => sum + t.length, 0) / texts.length
    if (meanDistractor > 0 && card.answerText.length > meanDistractor * MCQ_MAX_LENGTH_CUE_RATIO) {
      drop(cardId, 'length_cue'); continue
    }

    // The band, enforced rather than requested — a model told "make it easy" writes
    // near-misses anyway, because easy is the shape it has least practice at.
    //
    // A RANGE, though, not an exact count. Exact was what 197/198 asked for and it dropped
    // EVERY item across all three bands on a real deck: three coin flips per question, and
    // losing means the learner paid for nothing. Each band binds on one side only, which is
    // also all it promises.
    //
    // Checked AFTER length_cue so an item that is broken on its own terms reports that, rather
    // than reporting a band mismatch the author cannot act on.
    // Difficulty is NOT enforced here any more, and the reason is that it could not be.
    // The mechanical near-count gate dropped every item on bands 1 and 2 across three
    // deploys, it cannot be evaluated for short answer or essay at all, and "did the model
    // follow the instruction" is not a mechanically checkable property.
    //
    // What survives above IS checkable, and is what makes an item BROKEN rather than merely
    // easier than asked: the answer never appears among the wrong options, no duplicates, no
    // script mismatch, no length giveaway. The count is recorded so a drift in band quality
    // is visible in the logs rather than only to a reader.
    const near = flaws.filter((f) => NEAR_FLAWS.has(f)).length
    const nearMax = difficulty.nearMax ?? difficulty.nearRequired
    // `allowed` is enforced in the PROMPT — the model is only offered the flaws the band
    // permits — and merely recorded here. Dropping on it is the same mistake the near-count
    // gate was: it punishes the learner for a model that ignored an instruction.
    const offBand = near < difficulty.nearRequired || near > nearMax
      || (allowed !== null && flaws.some((f) => !allowed.has(f)))

    const itemId = makeItemId(cardId, index)
    const correctIndex = correctOptionIndex(itemId, optionCount)
    const options: string[] = []
    const flawSlots: Array<McqDistractorFlaw | null> = []
    const axisSlots: Array<McqExplanationAxis | null> = []
    let next = 0
    for (let slot = 0; slot < optionCount; slot++) {
      if (slot === correctIndex) { options.push(card.answerText); flawSlots.push(null); axisSlots.push(null) }
      else { options.push(texts[next]); flawSlots.push(flaws[next]); axisSlots.push(axes[next] ?? null); next++ }
    }

    used.add(cardId)
    items.push({
      type: 'multiple_choice', itemId, cardId,
      question: stem, options, correctIndex, flaws: flawSlots, axes: axisSlots, offBand,
    })
  }

  return outcome(items, dropped, sources.length)
}

// ─── Generation: short answer ───────────────────────────────────────────────

/**
 * Validate a short-answer generation response.
 *
 * Two checks carry the whole angle design:
 *
 *   * the question must NOT contain the expected answer. This is the failure the owner named —
 *     a prompt that hands over what it is asking for retrieves nothing — and it is checkable
 *     without knowing anything, because we hold the expected answer.
 *   * the question MUST contain the angle's anchor, for the three angles that have one. A cloze
 *     that does not quote the card's prompt is not a cloze of this card; it is the model writing
 *     a question about a subject it was told not to reason about. `restate` has no anchor and is
 *     therefore held to the leak check alone.
 *
 * `expected` is never read out of the response. It is filled by `angleGrounding` from the card.
 */
export function validateShortAnswerGeneration(
  raw: unknown,
  sources: readonly QuizCardSource[],
  makeItemId: ItemIdFactory,
): QuizGenerationOutcome {
  const byId = new Map(sources.map((s) => [s.cardId, s]))
  const used = new Set<string>()
  const items: QuizItemShortAnswer[] = []
  const dropped: Array<{ cardId: string | null; reason: QuizDropReason }> = []
  const drop = (cardId: string | null, reason: QuizDropReason) => { dropped.push({ cardId, reason }) }

  for (const [index, entry] of rawItems(raw).entries()) {
    const cardId = typeof entry.cardId === 'string' ? entry.cardId : null
    const card = cardId ? byId.get(cardId) : undefined
    if (!cardId || !card) { drop(cardId, 'unknown_card'); continue }
    if (used.has(cardId)) { drop(cardId, 'duplicate_card'); continue }
    if (!isShortAnswerAngle(entry.angle)) { drop(cardId, 'bad_enum'); continue }

    const question = stripQuestionMarkup(
      typeof entry.question === 'string' ? entry.question : '')
    if (question === '') { drop(cardId, 'bad_shape'); continue }
    if (question.length > MAX_QUESTION_CHARS) { drop(cardId, 'question_too_long'); continue }
    // Written about our JSON rather than about the card. See `leaksSchemaWord`.
    if (leaksSchemaWord(question)) { drop(cardId, 'schema_word_leaked'); continue }

    const probeFieldKey = typeof entry.probeFieldKey === 'string' ? entry.probeFieldKey : undefined
    const grounding = angleGrounding(entry.angle, card, probeFieldKey)
    if (!grounding) { drop(cardId, 'bad_enum'); continue }

    if (containsNormalized(question, grounding.expected)) { drop(cardId, 'answer_leaked_in_question'); continue }
    if (grounding.anchor && !anchorSatisfied(question, grounding.anchor)) {
      drop(cardId, 'anchor_missing'); continue
    }

    used.add(cardId)
    items.push({
      type: 'short_answer',
      itemId: makeItemId(cardId, index),
      cardId,
      angle: entry.angle,
      question,
      expected: grounding.expected,
      crossLingual: card.crossLingual,
    })
  }

  return outcome(items, dropped, sources.length)
}

// ─── Generation: essay ──────────────────────────────────────────────────────

/**
 * Validate an essay generation response, including its rubric.
 *
 * `mustMention` is the part worth reading twice. It is the only place a rubric gets specific, and
 * it is filled entirely with text QUOTED from the card: every mention must appear, normalized, in
 * the card's own prompt or answer. A model that wants to require a term the card never uses is
 * asserting a subject fact, and its criterion is dropped — which is why a criterion can die
 * without the item dying, as long as `covers_answer` and two criteria survive.
 *
 * Weights are handled asymmetrically on purpose. A model whose weights do not sum to 100 has
 * broken the contract and the item is dropped. Weights that stop summing to 100 because WE
 * dropped a criterion are our doing, and are renormalised by largest remainder rather than
 * charged to the learner.
 */
export function validateEssayGeneration(
  raw: unknown,
  sources: readonly QuizCardSource[],
  makeItemId: ItemIdFactory,
): QuizGenerationOutcome {
  const byId = new Map(sources.map((s) => [s.cardId, s]))
  const used = new Set<string>()
  const items: QuizItemEssay[] = []
  const dropped: Array<{ cardId: string | null; reason: QuizDropReason }> = []
  const drop = (cardId: string | null, reason: QuizDropReason) => { dropped.push({ cardId, reason }) }

  for (const [index, entry] of rawItems(raw).entries()) {
    const cardId = typeof entry.cardId === 'string' ? entry.cardId : null
    const card = cardId ? byId.get(cardId) : undefined
    if (!cardId || !card) { drop(cardId, 'unknown_card'); continue }
    if (used.has(cardId)) { drop(cardId, 'duplicate_card'); continue }
    if (!isEssayLengthBand(entry.lengthBand)) { drop(cardId, 'bad_enum'); continue }

    const question = stripQuestionMarkup(
      typeof entry.question === 'string' ? entry.question : '')
    if (question === '') { drop(cardId, 'bad_shape'); continue }
    if (question.length > MAX_QUESTION_CHARS) { drop(cardId, 'question_too_long'); continue }
    // Written about our JSON rather than about the card. See `leaksSchemaWord`.
    if (leaksSchemaWord(question)) { drop(cardId, 'schema_word_leaked'); continue }
    // An essay question may reword freely, but it must be about THIS card, and it must not hand
    // over the answer it is asking the learner to reconstruct.
    if (!anchorSatisfied(question, card.promptText)) { drop(cardId, 'anchor_missing'); continue }
    if (containsNormalized(question, card.answerText)) { drop(cardId, 'answer_leaked_in_question'); continue }

    if (!Array.isArray(entry.criteria)) { drop(cardId, 'bad_criteria'); continue }
    const rawCriteria = entry.criteria.filter(isRecord).slice(0, ESSAY_MAX_CRITERIA)

    // The contract check, on what the MODEL sent, before any of our drops.
    const declaredTotal = rawCriteria.reduce(
      (sum, c) => sum + (typeof c.weight === 'number' && Number.isFinite(c.weight) ? c.weight : Number.NaN), 0,
    )
    if (declaredTotal !== ESSAY_WEIGHT_TOTAL) { drop(cardId, 'bad_weights'); continue }

    // EVERYTHING the model was shown for this card, not just two of its fields.
  //
  // This was `promptText + answerText`, while the prompt hands the model `otherFields` too —
  // the pronunciation, the example sentence. So a criterion quoting the card's own example was
  // rejected as ungrounded, and the RICHER the card the more likely that was. Measured on a
  // ten-card deck with full example sentences: zero essay items survived at any band, every one
  // dropped `ungrounded_mention`.
  //
  // "Grounded in the card's own text" has to mean the card, or the check is testing something
  // nobody claimed.
  const grounded = [card.promptText, card.answerText, ...card.extraFields.map((f) => f.value)]
    .join(' ')
    const aspectsUsed = new Set<EssayAspect>()
    const kept: Array<{ aspect: EssayAspect; weight: number; mustMention: string[] }> = []
    let ungrounded = false

    for (const c of rawCriteria) {
      const aspect = c.aspect
      const weight = c.weight
      if (!isEssayAspect(aspect) || aspectsUsed.has(aspect)) continue
      if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 1 || weight > ESSAY_WEIGHT_TOTAL) continue
      if (!Array.isArray(c.mustMention)) continue

      const mentions: string[] = []
      let bad = false
      for (const m of c.mustMention.slice(0, ESSAY_MENTIONS_PER_CRITERION)) {
        if (typeof m !== 'string') { bad = true; break }
        const term = m.trim()
        if (term === '' || term.length > 40 || !mentionsTerm(grounded, term)) { bad = true; break }
        if (!mentions.some((existing) => normalizeAnswer(existing) === normalizeAnswer(term))) mentions.push(term)
      }
      // A criterion whose terms are invented is dropped, and the fact is remembered: an item that
      // needed that criterion to reach two will be dropped for the honest reason, not for "too few".
      if (bad || mentions.length === 0) { ungrounded = true; continue }

      aspectsUsed.add(aspect)
      kept.push({ aspect, weight, mustMention: mentions })
    }

    if (!aspectsUsed.has('covers_answer') || kept.length < ESSAY_MIN_CRITERIA) {
      drop(cardId, ungrounded ? 'ungrounded_mention' : 'bad_criteria'); continue
    }
    // `covers_answer` is what makes this a quiz about the card rather than an essay prompt, so it
    // carries the most weight. A rubric that ranks `structure` above it is grading composition.
    const coversWeight = kept.find((c) => c.aspect === 'covers_answer')!.weight
    if (kept.some((c) => c.aspect !== 'covers_answer' && c.weight > coversWeight)) {
      drop(cardId, 'bad_weights'); continue
    }

    const itemId = makeItemId(cardId, index)
    used.add(cardId)
    items.push({
      type: 'essay', itemId, cardId, question, lengthBand: entry.lengthBand,
      reference: card.answerText,
      // 모범답안은 **문항을 떨어뜨리지 않습니다.** 못 쓰거나 검사에 걸리면 null 로 두고 문항은
      // 그대로 살립니다 — 있으면 좋은 것 하나 때문에 이미 값을 치를 만한 문항을 버릴 이유가
      // 없습니다.
      modelAnswer: essayModelAnswer(entry.modelAnswer),
      criteria: renormalizeWeights(kept).map((c, i) => ({ id: `${itemId}:${i}`, ...c })),
    })
  }

  return outcome(items, dropped, sources.length)
}

/**
 * 모범답안으로 쓸 수 있는 글인가.
 *
 * 통과 못 하면 `null` 입니다 — 문항은 그대로 나갑니다. 검사는 셋뿐입니다: 문자열이고,
 * 비어 있지 않고, 상한 안이고, 우리 JSON 을 베껴 쓰지 않았을 것. 카드에 대한 근거 검사는
 * 일부러 하지 않습니다 — 모범답안은 카드를 **설명하는** 글이라 카드 문자열을 그대로 담고
 * 있을 이유가 없고, 그걸 요구했다가 서술형이 통째로 비었던 적이 있습니다(`ungrounded_mention`).
 */
function essayModelAnswer(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '') return null
  if (text.length > MODEL_ANSWER_MAX_CHARS) return null
  if (leaksSchemaWord(text)) return null
  return text
}

/** Largest-remainder rescale to `ESSAY_WEIGHT_TOTAL`, so integer weights still sum exactly. */
function renormalizeWeights<T extends { weight: number }>(criteria: T[]): T[] {
  const total = criteria.reduce((sum, c) => sum + c.weight, 0)
  if (total === ESSAY_WEIGHT_TOTAL || total <= 0) return criteria
  const scaled = criteria.map((c) => ({ c, exact: (c.weight * ESSAY_WEIGHT_TOTAL) / total }))
  const floored = scaled.map(({ c, exact }) => ({ c, weight: Math.max(1, Math.floor(exact)), rem: exact - Math.floor(exact) }))
  let slack = ESSAY_WEIGHT_TOTAL - floored.reduce((sum, f) => sum + f.weight, 0)
  for (const f of [...floored].sort((a, b) => b.rem - a.rem)) {
    if (slack <= 0) break
    f.weight++; slack--
  }
  return floored.map((f) => ({ ...f.c, weight: f.weight }))
}

// ─── Grading ────────────────────────────────────────────────────────────────

/**
 * A pointer into text the SERVER already holds, verbatim.
 *
 * This is how feedback stays closed and still says something. The tension in "closed set of
 * feedback" is that a closed set is generic — "missing a part" is true of a thousand answers and
 * useful for none of them. The resolution is not to loosen the set; it is to change what the
 * model contributes. It contributes a SELECTION, not a composition: which part of the learner's
 * own sentence, or which part of their own card's answer, the label is about.
 *
 * The screen then renders a translated label plus a highlight over text the learner already
 * trusts, and not one character the model wrote. `weak-themes.ts` does the same thing at deck
 * scale — it returns card ids, not prose — and this is that move at sentence scale.
 *
 * An out-of-range span is dropped alone; the verdict and gaps still render. A grade is not worth
 * refusing over a bad offset.
 */
export interface QuizSpan {
  readonly from: 'learner' | 'reference'
  readonly start: number
  readonly end: number
}

function validateSpan(raw: unknown, learnerLen: number, referenceLen: number): QuizSpan | null {
  if (!isRecord(raw)) return null
  const from = raw.from
  if (from !== 'learner' && from !== 'reference') return null
  const { start, end } = raw
  if (typeof start !== 'number' || typeof end !== 'number') return null
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  const limit = from === 'learner' ? learnerLen : referenceLen
  if (start < 0 || end <= start || end > limit) return null
  if (end - start > MAX_SPAN_CHARS) return null
  return { from, start, end }
}

export interface QuizGradeInput {
  /** The model-authored question, already validated at generation time. */
  readonly question: string
  /** The card's answer. The ONLY thing equivalence is judged against. */
  readonly reference: string
  /** What the learner submitted, verbatim. Spans index into this string. */
  readonly learner: string
  readonly crossLingual: boolean
}

export type QuizGradeOutcome<T> =
  | { readonly graded: true; readonly grade: T }
  /** Refund. `normalized_score` is NOT written, and no attempt is recorded as a failure. */
  | { readonly graded: false; readonly refusal: GradeRefusal }

/**
 * The pre-flight gate, run BEFORE the provider call and before the reservation is charged.
 *
 * An empty submission does not need a model to be graded 0, and must not cost one. An
 * over-length submission is refused rather than truncated, because grading the first 2000
 * characters of a 4000-character essay grades an essay the learner did not write — and charges
 * them for it. The learner can shorten it; we cannot un-grade it.
 */
export function gradeGate(
  quizType: Exclude<QuizType, 'multiple_choice'>,
  learner: string,
): { readonly ok: true } | { readonly ok: false; readonly refusal: GradeRefusal } {
  const text = learner.trim()
  if (text.length > MAX_LEARNER_CHARS[quizType]) return { ok: false, refusal: 'response_too_long' }
  if (text.length < MIN_GRADEABLE_CHARS[quizType]) return { ok: false, refusal: 'empty_response' }
  return { ok: true }
}

export interface ShortAnswerGrade {
  readonly verdict: ShortAnswerVerdict
  /** Clamped into `SHORT_ANSWER_BANDS[verdict]`. Writes straight to `normalized_score`. */
  readonly score: number
  readonly gaps: readonly ShortAnswerGap[]
  readonly spans: readonly QuizSpan[]
  /** The model's score disagreed with its own verdict. Observability, never rendered. */
  readonly clamped: boolean
}

/**
 * Validate a short-answer grade.
 *
 * Language, in full, because it is the part most likely to be got wrong quietly. Three languages
 * are in play and only one of them reaches the model:
 *
 *   * the UI locale never does. Nothing in this response is a language — verdict and gaps are
 *     enum members, spans are integers — so there is no `uiLang.startsWith('ko')` branch here and
 *     no six-locales-get-English defect. This is the payoff the closed set was bought for.
 *   * the item's language is the card's, and the grader is told to judge meaning, not script.
 *   * the learner's language is whatever they typed, and answering in another one is NOT by
 *     itself wrong — unless the card's own two faces are in different scripts, which is the only
 *     evidence we will ever have that producing the target language was the point. On such a card
 *     `wrong_language` caps the verdict at `partial`; on any other card it is advisory and costs
 *     nothing. Both branches are read off the card, never off a belief about the subject.
 */
export function validateShortAnswerGrade(raw: unknown, input: QuizGradeInput): QuizGradeOutcome<ShortAnswerGrade> {
  if (!isRecord(raw)) return { graded: false, refusal: 'invalid_result' }
  const verdict = raw.verdict
  if (!isShortAnswerVerdict(verdict)) return { graded: false, refusal: 'invalid_result' }
  if (verdict === 'unjudgeable') return { graded: false, refusal: 'model_declined' }

  const gaps: ShortAnswerGap[] = []
  if (raw.gaps !== undefined) {
    if (!Array.isArray(raw.gaps)) return { graded: false, refusal: 'invalid_result' }
    for (const g of raw.gaps) {
      if (!isShortAnswerGap(g) || gaps.includes(g)) continue
      if (gaps.length < MAX_GAPS_PER_GRADE) gaps.push(g)
    }
  }

  let effective: ShortAnswerVerdict = verdict
  if (input.crossLingual && gaps.includes('wrong_language') &&
      SHORT_ANSWER_BANDS[effective][1] > SHORT_ANSWER_BANDS.partial[1]) {
    effective = 'partial'
  }

  const [lo, hi] = SHORT_ANSWER_BANDS[effective]
  const given = raw.score
  const usable = typeof given === 'number' && Number.isFinite(given)
  // A missing or non-finite score is not a reason to refuse: the verdict already fixed the band,
  // and its midpoint is inside a range a validated enum member put there. It is the one place
  // this file fills a gap rather than dropping, and it can only ever land where the verdict says.
  const raw01 = usable ? given : (lo + hi) / 2
  const score = Math.min(hi, Math.max(lo, raw01))

  // Cap the SURVIVORS, not the candidates. Slicing first let three malformed spans starve out a
  // valid fourth — the weaker entry winning purely by position in the array, which is the same
  // defect `validateWeakThemes` sorts by confidence to avoid.
  const spans: QuizSpan[] = []
  const rawSpans = Array.isArray(raw.spans) ? raw.spans.slice(0, MAX_SPANS_CONSIDERED) : []
  for (const s of rawSpans) {
    if (spans.length >= MAX_GAPS_PER_GRADE) break
    const span = validateSpan(s, input.learner.length, input.reference.length)
    if (span) spans.push(span)
  }

  return {
    graded: true,
    grade: { verdict: effective, score, gaps, spans, clamped: !usable || raw01 !== score || effective !== verdict },
  }
}

export interface EssayCriterionGrade {
  readonly criterionId: string
  readonly level: EssayLevel
  readonly span: QuizSpan | null
}

export interface EssayGrade {
  /** One per rubric criterion, in rubric order. Every criterion is graded or explicitly declined. */
  readonly criteria: readonly EssayCriterionGrade[]
  /** Derived here, never returned by the model. Writes straight to `normalized_score`. */
  readonly score: number
  /** Share of the rubric's weight the grader declined, 0..1. Renders as "partially graded". */
  readonly unjudgeableWeight: number
}

/**
 * Fraction of an essay's weight that may be declined before the whole grade is refused.
 *
 * Scoring the 40% it could read and calling that the essay's mark is a fabrication dressed as
 * leniency. Above the threshold the learner is refunded and asked to resubmit.
 */
export const ESSAY_MAX_UNJUDGEABLE_WEIGHT = 0.5

/**
 * Validate an essay grade and DERIVE its score.
 *
 * The model returns a level per criterion and nothing numeric. This is the whole reason the
 * rubric has weights: a grader that returns an overall score can say every criterion was met and
 * then hand back 0.6, and there is no principled way to reconcile that — whereas a per-criterion
 * level composed by us is arithmetic, reproducible, and explainable to the learner criterion by
 * criterion. It also means a prompt change can never move the scale.
 *
 * A declined criterion leaves the denominator, rather than scoring 0. Charging a learner for the
 * grader's blind spot is the same error as fabricating a grade, just quieter.
 */
export function validateEssayGrade(
  raw: unknown,
  criteria: readonly EssayCriterion[],
  input: QuizGradeInput,
): QuizGradeOutcome<EssayGrade> {
  if (!isRecord(raw) || !Array.isArray(raw.criteria)) return { graded: false, refusal: 'invalid_result' }
  if (criteria.length === 0) return { graded: false, refusal: 'invalid_result' }

  const byId = new Map(raw.criteria.filter(isRecord).map((c) => [c.criterionId, c]))
  const out: EssayCriterionGrade[] = []
  let earned = 0
  let judged = 0
  let declined = 0

  for (const criterion of criteria) {
    const entry = byId.get(criterion.id)
    const level = entry?.level
    // A criterion the model simply omitted is a declined criterion, not a failed one. Silence is
    // not evidence the learner missed it.
    if (!isEssayLevel(level) || level === 'unjudgeable') {
      out.push({ criterionId: criterion.id, level: 'unjudgeable', span: null })
      declined += criterion.weight
      continue
    }
    const span = validateSpan(entry?.span, input.learner.length, input.reference.length)
    out.push({ criterionId: criterion.id, level, span })
    judged += criterion.weight
    earned += criterion.weight * ESSAY_LEVEL_SCORE[level]
  }

  const total = criteria.reduce((sum, c) => sum + c.weight, 0)
  const unjudgeableWeight = total > 0 ? declined / total : 1
  if (judged === 0 || unjudgeableWeight > ESSAY_MAX_UNJUDGEABLE_WEIGHT) {
    return { graded: false, refusal: 'model_declined' }
  }

  return {
    graded: true,
    grade: { criteria: out, score: Math.min(1, Math.max(0, earned / judged)), unjudgeableWeight },
  }
}

/**
 * What separates the right option from the one the learner picked.
 *
 * Multiple choice is scored by `submit_quiz_answer` — an integer compare against the key we
 * wrote — and that stays the authority. A model cannot make that verdict better; it can only
 * agree, disagree (a defect), or cost money to agree. So `grade_mcq` buys something else: the
 * AXIS the two options differ on, and a span into the learner's own card that settles it.
 *
 * Deliberately different from `MCQ_DISTRACTOR_FLAWS`. A flaw label is written at generation time
 * and says what the option IS ("반대", "너무 넓음"). An axis is chosen after seeing what the
 * learner actually picked and says what the DISTINCTION hinges on — which is the thing they got
 * wrong, and the thing they have to hold on to next time.
 *
 * Subject-neutral for the same reason every other closed set here is: these hold for a
 * pharmacology deck and a JLPT deck alike, and each has one hand-translated string.
 */
export const MCQ_EXPLANATION_AXES = [
  /** Who does what to whom, or which way it runs. 貸す/借りる, 원고/피고, 산/염기. */
  'direction',
  /** One covers more cases than the other. */
  'scope',
  /** Both are true, but only under different conditions. */
  'condition',
  /** They look or sound alike and mean different things. affect/effect, 待つ/持つ. */
  'form',
  /** One part of a multi-part answer differs — a term, a coefficient, a sign. */
  'component',
  /** The steps or stages come in a different order. */
  'order',
  /** Same idea, different amount, degree or count. */
  'quantity',
  /** Different subject areas entirely; recognising the area is enough to separate them. */
  'category',
] as const
export type McqExplanationAxis = typeof MCQ_EXPLANATION_AXES[number]

export const isMcqExplanationAxis = (v: unknown): v is McqExplanationAxis =>
  typeof v === 'string' && (MCQ_EXPLANATION_AXES as readonly string[]).includes(v)
const isMcqAxis = isMcqExplanationAxis

export interface McqExplanation {
  readonly axis: McqExplanationAxis
  /** Into the chosen option or the correct one. At most `MAX_GAPS_PER_GRADE`. */
  readonly spans: readonly QuizSpan[]
}

export interface McqExplanationInput {
  readonly question: string
  /** The correct option, verbatim. Spans with `from: 'reference'` index into this. */
  readonly reference: string
  /** The option the learner chose. Equal to `reference` when they were right. */
  readonly learner: string
  /** The other options, for context. Nothing indexes into these. */
  readonly alternatives: readonly string[]
  readonly correct: boolean
}

/**
 * Validate an MCQ explanation.
 *
 * There is no score here and there must never be one: `normalized_score` was written on submit
 * and `apply_quiz_explanation` does not touch it. A model that returns a score is returning a
 * field we drop.
 *
 * An unrecognised axis is a refusal rather than a default. Every other closed set in this file
 * refuses on an unknown member, and picking one for the model would put a label on the screen
 * that nothing in the answer supports — the learner would be told they confused direction when
 * the grader had no idea.
 */
export function validateMcqExplanation(
  raw: unknown,
  input: McqExplanationInput,
): QuizGradeOutcome<McqExplanation> {
  if (!isRecord(raw)) return { graded: false, refusal: 'invalid_result' }
  const axis = raw.axis
  if (!isMcqAxis(axis)) return { graded: false, refusal: 'invalid_result' }

  // Same shape as the short-answer grader: consider a bounded slice, cap the SURVIVORS, so a
  // malformed span cannot starve out a valid one behind it.
  const spans: QuizSpan[] = []
  const rawSpans = Array.isArray(raw.spans) ? raw.spans.slice(0, MAX_SPANS_CONSIDERED) : []
  for (const s of rawSpans) {
    if (spans.length >= MAX_GAPS_PER_GRADE) break
    const span = validateSpan(s, input.learner.length, input.reference.length)
    if (span) spans.push(span)
  }

  return { graded: true, grade: { axis, spans } }
}
