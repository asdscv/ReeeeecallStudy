/**
 * Prompt builders for the five quiz operations — three generations, two gradings.
 *
 * Sits beside `ai-prompts.ts` rather than inside it: that file is byte-parity-locked against the
 * client builder in `packages/shared/lib/ai/prompts.ts`, and these have no client twin (the client
 * sends structured refs; the server holds the cards). `ai-remediation.ts` set the same precedent.
 * Pure TS, no imports beyond the contract, loadable by Deno and vitest.
 *
 * ## The line these prompts have to hold, and where it is actually held
 *
 * "Use only the card's content" is not enforced by asking. It is enforced by what is in the
 * payload and by what the response is ALLOWED to contain:
 *
 *   * The payload is three strings per card — id, prompt, answer — plus any extra fields. No deck
 *     name, no tags, no template name, no other card. A model cannot draw on deck context it was
 *     not given, and the topic-shaped hints ("HSK 1", "Pharmacology 2") that invite recall from
 *     training data never enter the request.
 *   * The correct answer is never requested. MCQ returns distractors; short answer returns a
 *     question and an angle; essay returns a question and a rubric of quoted terms. In no
 *     operation does the model type the thing the learner is graded against.
 *   * Every generated string is bounded by a containment check it cannot see (`ai-quiz.ts`), so
 *     an instruction it ignores is caught rather than shipped.
 *
 * The instructions below therefore exist to raise the YIELD — to make fewer items get dropped —
 * not to make the feature safe. That is the correct division: an instruction is a hope, and a
 * validator is a guarantee.
 *
 * ## Eight languages, and why there is no language branch here
 *
 * `buildTemplatePrompt` and friends branch `uiLang.startsWith('ko') ? Korean : English`, so six
 * of the eight locales get English instructions — the defect `weak-themes.ts` names. None of
 * these builders takes a `uiLang` at all, and that is by construction, not by omission:
 *
 *   * Grading returns enum members and integers. Nothing in it is prose, so there is nothing to
 *     write in the learner's language. Every rendered sentence is a hand-translated string keyed
 *     off the verdict, which makes the Thai screen exactly as good as the Korean one.
 *   * Generation returns questions, which ARE prose — but their language is fixed by the card,
 *     not by the interface. A question is required to contain its anchor text verbatim, so it is
 *     already in that text's script before any instruction is read; "write in the same language
 *     as anchorText" is a restatement of a constraint the validator enforces. A Korean learner
 *     working a Japanese deck should be asked in the language their card asks in, and the UI
 *     locale is not evidence about that either way.
 *
 * So the prompt is English for everyone, and no locale is second-class, because no locale's text
 * comes from here.
 */

import {
  answerParts,
  DEFAULT_DIFFICULTY, type QuizDifficulty,
  ESSAY_ASPECTS, ESSAY_LENGTH_BANDS, ESSAY_MAX_CRITERIA, ESSAY_MENTIONS_PER_CRITERION,
  ESSAY_MIN_CRITERIA, ESSAY_WEIGHT_TOTAL, MAX_DISTRACTOR_CHARS, MAX_QUESTION_CHARS, MAX_SPAN_CHARS,
  MCQ_DISTRACTOR_COUNT, MCQ_DISTRACTOR_FLAWS, MAX_GAPS_PER_GRADE, SHORT_ANSWER_ANGLES,
  SHORT_ANSWER_BANDS, SHORT_ANSWER_GAPS, SHORT_ANSWER_VERDICTS, ESSAY_LEVELS,
  type EssayCriterion, type QuizCardSource, type QuizGradeInput,
} from './ai-quiz.ts'

/**
 * Serialised card payload ceiling.
 *
 * `buildRemediationPrompt` truncates at 64KB, which for that feature is a last resort. Here it is
 * a budget: a batch is at most 10 cards and a card is at most a few hundred characters, so 16KB
 * is roughly 4x headroom and anything past it means a card carries a pasted document in a field.
 * Truncating THAT would hand the model half a sentence and ask it to write a quiz about it, so
 * the oversized card is dropped from the batch instead — by the caller, before this is called.
 */
export const MAX_QUIZ_PAYLOAD_BYTES = 16 * 1024

/** Most cards per generation call. Beyond this the output token count, not the input, binds. */
export const MAX_QUIZ_BATCH: Readonly<Record<'multiple_choice' | 'short_answer' | 'essay', number>> = {
  multiple_choice: 10,
  short_answer: 10,
  // Essays are the one type a learner does not do ten of. Three is a session, and the rubric
  // triples this type's output tokens per item.
  essay: 3,
}

/**
 * Sampling temperature, per operation.
 *
 * `providerRequest` currently hardcodes 0.8 for every call, which is right for card generation
 * (variety is the product) and wrong for grading, where the same answer submitted twice must
 * receive the same mark twice. A learner who resubmits an identical answer and gets a different
 * score has been shown that the grade is not real. Generation keeps some spread so ten
 * distractors are not ten rewrites of one idea.
 */
export const QUIZ_TEMPERATURE = { generate: 0.7, grade: 0 } as const

const bullets = (lines: readonly string[]) => lines.map((l) => `- ${l}`).join('\n')

/** The payload, and nothing else about the deck. See the module note. */
function cardPayload(sources: readonly QuizCardSource[]): string {
  return JSON.stringify({
    cards: sources.map((s) => ({
      cardId: s.cardId,
      prompt: s.promptText,
      answer: s.answerText,
      ...(s.extraFields.length ? { otherFields: s.extraFields.map((f) => ({ key: f.key, label: f.label, value: f.value })) } : {}),
    })),
  })
}

/** Shared preamble. Repeated verbatim in all five prompts so no operation drifts off the line. */
const GROUNDING = [
  'You are a quiz item writer for a memorisation app. You are NOT a subject expert here and must not act as one.',
  'The ONLY facts you may rely on are the `prompt` and `answer` strings supplied for each card.',
  'If a card looks wrong, incomplete, or unfamiliar, work with it exactly as written. Do not correct it,'
  + ' do not complete it, and do not substitute what you believe the right answer to be.',
  'Never mention a fact, term, person, statute, dosage, or figure that does not appear in the card you were given.',
].join('\n')

// ─── Generation ─────────────────────────────────────────────────────────────

export function buildMcqGenerationPrompt(
  sources: readonly QuizCardSource[],
  difficulty: QuizDifficulty = DEFAULT_DIFFICULTY,
) {
  const optionCount = Math.min(6, Math.max(2, difficulty.optionCount || 4))
  const distractorCount = optionCount - 1
  const nearMin = Math.min(difficulty.nearRequired, distractorCount)
  const nearMax = Math.min(difficulty.nearMax ?? nearMin, distractorCount)
  const restricted = difficulty.allowedFlaws?.length
    ? `\nOnly these flaws may be used for this band: ${difficulty.allowedFlaws.join(', ')}.`
    : ''
  // `partial` is only legal when the ANSWER has comma- or slash-separated parts, and the
  // validator rejects it otherwise. Offering it to a batch of single-part answers is offering
  // a tool that cannot be used: a weaker model reaches for it, every item loses a distractor,
  // and the batch dies `partial_not_applicable` -> `too_few_distractors`. Observed on a
  // fallback model against a plain vocabulary deck.
  const anyMultiPart = sources.some((s) => answerParts(s.answerText).length > 1)
  const flaws = bullets([
    '"opposite" — reverses the answer\'s direction or polarity. [NEAR]',
    '"adjacent_sense" — a close neighbour in meaning that this card\'s answer excludes. [NEAR]',
    '"right_category_wrong_item" — the same kind of thing, but not this one. [FAR]',
    ...(anyMultiPart
      ? ['"partial" — EXACTLY one comma- or slash-separated part of the answer, verbatim. Only for the cards whose answer HAS such parts; rejected on any other card. [NEAR]']
      : []),
    '"overgeneral" — true of a broader class, so not the answer to this prompt. [FAR]',
    '"plausible_form" — resembles the answer in spelling or sound without being it. [NEAR]',
    '"unrelated" — from a different subject area entirely; no relation to the answer. STILL WRITTEN IN THE ANSWER\'S OWN LANGUAGE AND SCRIPT — an option in another language is spotted without being read, and is rejected. [FAR]',
  ])

  // Stated as a count, not as an adjective. "Make it easy" is interpreted; "exactly one of the
  // three is a near-miss" is followed — and it is checked afterwards either way.
  // One-sided on purpose: each band binds on the end it actually promises. Asking for an
  // exact split is a target a model misses often enough to drop every item.
  // The band's own words, from `quiz_difficulty_levels.guidance`. Difficulty stopped being a
  // number the code phrases and became an instruction the band carries, because "be
  // unrelated" names no target and "use a concrete object where the answer is an action"
  // does. The fallback keeps a bandless call working rather than silently unlabelled.
  const mix = difficulty.guidance
    ?? `Write distractors a learner who half-knows the answer could believe.`

  const systemPrompt = `${GROUNDING}

For each card, write exactly ${distractorCount} WRONG options (distractors) for a multiple-choice question.
You are NOT asked for the correct option and must not write it — the app inserts the card's own answer itself.

Respond with a single JSON object:
{ "items": [ { "cardId": "...", "distractors": [ { "text": "...", "flaw": "opposite" } ] } ] }

Every distractor names the ONE way it is wrong:
${flaws}

DIFFICULTY: ${mix}${restricted}

Rules:
${bullets([
  `Exactly ${distractorCount} distractors per card. They may share a flaw label — three close neighbours of the answer is often the best set a card can have. What they must not share is substance: three ways of writing the same wrong idea is one distractor shown three times.`,
  'A distractor must be UNAMBIGUOUSLY WRONG for this card. If you cannot say which flaw it has, it is probably also correct — do not write it.',
  'Never write a distractor that restates the answer, contains the whole answer, or is contained by it (except "partial", above).',
  'Write distractors in the same language and script as the `answer`. An option in another language is spotted without being read.',
  'Match the answer\'s register and length. An answer that is longer and more careful than every alternative is the giveaway, not the knowledge.',
  `Keep each distractor under ${MAX_DISTRACTOR_CHARS} characters.`,
  'Use each cardId exactly once, and only cardIds that were given to you.',
  'Skip a card you cannot write three distinct wrong options for. A missing item is fine; a guessable one is not.',
  `Valid flaws: ${MCQ_DISTRACTOR_FLAWS.map((f) => `"${f}"`).join(', ')}.`,
])}`

  return { systemPrompt, userPrompt: `Cards:\n${cardPayload(sources)}` }
}

export function buildShortAnswerGenerationPrompt(
  sources: readonly QuizCardSource[],
  difficulty: QuizDifficulty = DEFAULT_DIFFICULTY,
) {
  const angles = bullets([
    '"reverse" — quote the ANSWER text and ask what it corresponds to on the front of the card, worded the way a learner would ask it. Expected answer: the card\'s prompt.',
    '"cloze" — write one sentence containing the card\'s PROMPT text verbatim, with the answer replaced by "____". Expected answer: the card\'s answer.',
    '"restate" — ask for the same thing the card asks for, worded differently. Expected answer: the card\'s answer.',
    '"field_probe" — ask for one of the extra fields USING ITS LABEL as the learner would say it ("What is the pronunciation of X?"); set "probeFieldKey" to that field\'s key. Expected answer: that field\'s value. Only available when the card has extra fields.',
  ])

  const systemPrompt = `${GROUNDING}

For each card, write ONE short-answer question. You do not write the expected answer — the app takes it from the card.
The point of this feature is to retrieve the same knowledge from a DIFFERENT direction than the flashcard already does,
so a question that is the card's front reworded is worthless. Change the angle.

Respond with a single JSON object:
{ "items": [ { "cardId": "...", "angle": "cloze", "question": "...", "probeFieldKey": "..." } ] }
("probeFieldKey" only for "field_probe".)

Angles — each one fixes where the expected answer comes from:
${angles}

DIFFICULTY: ${difficulty.guidance ?? ''}

Rules:
${bullets([
  'The question must NEVER contain the expected answer, in any spelling, spacing, or script. This is checked; a leaked question is discarded.',
  'Plain text only. No HTML, no markdown, no <b> or ** — the question is rendered as text and a learner would read the tags.',
  'Write TO a learner, never ABOUT the data. The words "prompt", "answer field", "card", "field", "otherFields" and "cardId" are our internal names for this JSON — a question containing one of them shows the learner our schema. This is checked; such a question is discarded.',
  'For "reverse", "cloze" and "field_probe" the question MUST contain its source text verbatim (the answer, the prompt, and the prompt respectively). This is checked too.',
  'Write the question in the same language as the text it quotes.',
  'Ask for something the card can settle. Never ask for an opinion, a comparison with material outside the card, or anything the card does not state.',
  `Vary the angle across the batch: use at least two different angles, and use "restate" for at most half the items.`,
  `Keep the question under ${MAX_QUESTION_CHARS} characters, and short enough to read on a phone.`,
  'Use each cardId exactly once, and only cardIds that were given to you.',
  `Valid angles: ${SHORT_ANSWER_ANGLES.map((a) => `"${a}"`).join(', ')}.`,
])}`

  return { systemPrompt, userPrompt: `Cards:\n${cardPayload(sources)}` }
}

export function buildEssayGenerationPrompt(
  sources: readonly QuizCardSource[],
  difficulty: QuizDifficulty = DEFAULT_DIFFICULTY,
) {
  const aspects = bullets([
    '"covers_answer" — states what the card\'s answer states. REQUIRED on every card, exactly once, and must carry the highest weight.',
    '"uses_key_terms" — uses the card\'s own terms rather than talking around them.',
    '"explains_why" — gives the reason or mechanism the card\'s answer implies.',
    '"gives_example" — supplies an instance.',
    '"states_limits" — names a boundary or exception the card mentions.',
    '"structure" — the response is organised and finished.',
  ])

  const systemPrompt = `${GROUNDING}

For each card, write ONE essay question and a grading rubric for it.
The rubric is applied by an automatic grader and is also SHOWN TO THE LEARNER before they write, so it must be
concrete enough to act on and short enough to read. It is not prose: it is ${ESSAY_MIN_CRITERIA}-${ESSAY_MAX_CRITERIA} weighted criteria,
each naming a fixed aspect and quoting terms from the card.

Respond with a single JSON object:
{ "items": [ {
  "cardId": "...",
  "question": "...",
  "lengthBand": "medium",
  "criteria": [ { "aspect": "covers_answer", "weight": 60, "mustMention": ["..."] } ]
} ] }

Aspects — a closed list; anything else is discarded:
${aspects}

DIFFICULTY: ${difficulty.guidance ?? ''}

Rules:
${bullets([
  'The question MUST contain the card\'s prompt text verbatim, and must NOT contain its answer. Both are checked.',
  'Ask the learner to reconstruct and explain what the card says. Never ask them to bring in material the card does not contain.',
  `Between ${ESSAY_MIN_CRITERIA} and ${ESSAY_MAX_CRITERIA} criteria. Each aspect at most once.`,
  `"weight" is a whole number; the weights of one card's criteria must sum to exactly ${ESSAY_WEIGHT_TOTAL}.`,
  `"mustMention" holds 1-${ESSAY_MENTIONS_PER_CRITERION} terms COPIED from that card's prompt or answer. A term that does not appear in the card is discarded, and a criterion with no surviving term is discarded with it.`,
  `"lengthBand" is one of ${ESSAY_LENGTH_BANDS.map((b) => `"${b}"`).join(', ')}. Choose by how much the card's answer actually contains — a one-word answer is never a "long".`,
  'Do not write criteria the card cannot settle ("shows insight", "engages critically"). The grader cannot check them and the learner cannot act on them.',
  'Use each cardId exactly once, and only cardIds that were given to you.',
  `Valid aspects: ${ESSAY_ASPECTS.map((a) => `"${a}"`).join(', ')}.`,
])}`

  return { systemPrompt, userPrompt: `Cards:\n${cardPayload(sources)}` }
}

// ─── Grading ────────────────────────────────────────────────────────────────

/**
 * The sentence that decides whether this feature is honest.
 *
 * A grader asked "is this answer correct?" answers from its training data, and then a learner
 * with an idiosyncratic card — a mnemonic, a company-internal definition, a translation their
 * teacher gave them — is marked wrong by a model that has never seen their syllabus. Asked "do
 * these two texts mean the same thing?", it is doing a comparison it can actually do, on two
 * strings it was handed. The card is the authority; the model is the comparator.
 */
const EQUIVALENCE = [
  'You are an equivalence checker, not a subject expert and not an examiner.',
  'Decide ONE thing: does the learner\'s response mean the same as `reference`?',
  '`reference` is the answer this card declares. It is correct BY DEFINITION for this task, even if you'
  + ' believe otherwise. If you think it is wrong or incomplete, that changes nothing — grade against it as written.',
  'Never introduce a fact, term, or correction that is in neither `reference` nor the learner\'s response.',
  'Different wording that means the same thing is CORRECT. The learner is being tested on recall, not phrasing.',
].join('\n')

/** Reused by both graders: what a span is and why it is not a quotation the model writes. */
const SPANS = [
  'A span is `{ "from": "learner" | "reference", "start": <int>, "end": <int> }` — a half-open character range into'
  + ' the text named by "from", counted from 0.',
  'Do NOT write out the text. The app already has both strings and renders the range as a highlight; anything you'
  + ' type instead is discarded.',
  `Point at the smallest range that makes the point, at most ${MAX_SPAN_CHARS} characters. Omit the span if none applies.`,
].join('\n')

export function buildShortAnswerGradePrompt(input: QuizGradeInput) {
  const verdicts = bullets([
    '"equivalent" — means the same as the reference.',
    '"equivalent_with_error" — the meaning arrived, with a spelling or inflection error.',
    '"partial" — part of the reference, missing a part of it.',
    '"different" — does not mean the reference.',
    '"empty" — nothing was written.',
    '"unjudgeable" — you genuinely cannot tell. Use it rather than guessing; the learner is refunded and no mark is recorded.',
  ])
  const gaps = bullets([
    '"missing_part" — the reference says something the response does not.',
    '"extra_claim" — the response says something the reference does not.',
    '"wrong_direction" — the response inverts the relation.',
    '"too_vague" — the response names a broader class than the reference does.',
    '"spelling" — surface error only.',
    '"wrong_language" — answered in a language other than the reference\'s.',
  ])
  const bands = Object.entries(SHORT_ANSWER_BANDS)
    .map(([v, [lo, hi]]) => `${v}: ${lo}-${hi}`)
    .join(', ')

  const systemPrompt = `${EQUIVALENCE}

Respond with a single JSON object:
{ "verdict": "equivalent", "score": 0.95, "gaps": ["missing_part"], "spans": [ { "from": "learner", "start": 0, "end": 12 } ] }

Verdicts — a closed list:
${verdicts}

"score" must fall inside its verdict's range (${bands}). Use it to grade within the verdict, not to override it.

"gaps" — at most ${MAX_GAPS_PER_GRADE}, from this closed list, most important first:
${gaps}

${SPANS}
Point "learner" spans at the words that carry the problem, and "reference" spans at what was missed.

${input.crossLingual
    ? 'This card\'s prompt and answer are written in different scripts, so producing the answer IN THE'
      + ' REFERENCE\'S LANGUAGE is part of what is being tested. An answer that means the right thing in another'
      + ' language is "partial" at best — set "wrong_language".'
    : 'This card\'s prompt and answer are in the same language, so the language the learner chose is not part of'
      + ' what is being tested. If they answered in another language and the meaning is right, that is'
      + ' "equivalent" — you may note "wrong_language", but do not lower the verdict for it.'}

Never write any other field. Explanations, corrections, and encouragement are discarded — the app renders its own
text from the verdict and gaps, already translated into the learner's language.
Valid verdicts: ${SHORT_ANSWER_VERDICTS.map((v) => `"${v}"`).join(', ')}. Valid gaps: ${SHORT_ANSWER_GAPS.map((g) => `"${g}"`).join(', ')}.`

  const userPrompt = JSON.stringify({
    question: input.question,
    reference: input.reference,
    learnerResponse: input.learner,
  })

  return { systemPrompt, userPrompt }
}

export function buildEssayGradePrompt(input: QuizGradeInput, criteria: readonly EssayCriterion[]) {
  const systemPrompt = `${EQUIVALENCE}

You are grading a longer written response against a rubric. Grade EACH criterion separately.
Do NOT return an overall score — the app computes it from your levels and the rubric's weights.

Respond with a single JSON object:
{ "criteria": [ { "criterionId": "...", "level": "met", "span": { "from": "learner", "start": 0, "end": 40 } } ] }

Levels — a closed list:
${bullets([
  '"met" — the response satisfies this criterion.',
  '"partial" — partly.',
  '"not_met" — it does not.',
  '"unjudgeable" — you genuinely cannot tell for this criterion. Its weight is removed from the total rather than scored zero, so use it instead of guessing.',
])}

Rules:
${bullets([
  'Return one entry for every criterionId in the rubric, and no others. An omitted criterion is treated as "unjudgeable" — do not rely on that to avoid a decision.',
  'A criterion\'s "mustMention" terms are quoted from the learner\'s own card. Treat a synonym or a translation of one as present; the terms are the point, not the spelling.',
  'Judge only what the criterion asks. Do not lower a content criterion for grammar, or a structure criterion for content.',
  'Length is not a criterion. A short response that satisfies a criterion satisfies it.',
])}

${SPANS}
For "met" and "partial", point at the part of the LEARNER's response that satisfies the criterion. For "not_met",
point at what in the REFERENCE was missed, or omit the span.

Never write any other field. The app renders the rubric and the outcome from its own translated strings.
Valid levels: ${ESSAY_LEVELS.map((l) => `"${l}"`).join(', ')}.`

  const userPrompt = JSON.stringify({
    question: input.question,
    reference: input.reference,
    rubric: criteria.map((c) => ({ criterionId: c.id, aspect: c.aspect, weight: c.weight, mustMention: c.mustMention })),
    learnerResponse: input.learner,
  })

  return { systemPrompt, userPrompt }
}
