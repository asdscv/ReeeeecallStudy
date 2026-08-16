// ─── Which ONE field a quiz grades, and which fields are merely context ──────
//
// `resolveCardAnswerFaces` (./card-answer.ts) answers "which fields are the answer" — plural —
// and `cardReferenceAnswer` joins them with ' / '. That is the right contract for its caller,
// and the wrong one for a quiz, in four separate ways. Against the seeded 영어 단어 template,
// whose `back_layout` is [primary, hint, detail], it produces:
//
//     "빌려주다 / tuː lend / He lent me a book."
//
//   1. Grading. A learner who types 빌려주다 has answered correctly and would be compared
//      against a string they were never asked to produce.
//   2. Distractors. Four choices built around that string CONTAIN the answer, so the
//      pronunciation and the example sentence are handed over with it.
//   3. Length. One option three times longer than the others is pickable without knowing
//      anything, which is the failure mode multiple choice exists to avoid.
//   4. Coverage. It returns null unless EVERY back field is text, so the seeded 중국어
//      template — which puts audio in `back_layout` — yields no quizzable cards at all.
//
// So quiz resolves its own field, and the declaration it reads was already there:
// `LayoutItem.style` is a closed type ('primary' | 'secondary' | 'hint' | 'detail' | 'media'),
// and the seeded templates, `buildPresetTemplate`, and the AI template prompt all populate it.
// The author already said which field is the real answer. This reads that, and refuses when it
// was not said unambiguously.
//
// Measured against production before this was written — 377,031 cards across 672 decks:
//
//     resolvable       376,544  (99.9%)      decks with 4+ resolvable   652 (97%)
//     no text prompt        36               decks with 0 resolvable     18
//     two or more primary  321
//     no primary, ambiguous 130
//     answer is the prompt    0
//
// `resolveCardAnswerFaces` is deliberately left alone: `compare` depends on its stated contract,
// and changing that is a different job from adding this one.
import type { Card } from '../types/database'
import type { CardAnswerTemplate } from './card-answer'

export type { CardAnswerTemplate }

/**
 * A template plus the one thing its layout could not say: which back field a quiz grades, when
 * the author marked two as primary or none at all.
 *
 * Migration 219 added the column and taught `_quiz_eligible_cards` to read it, which made the
 * ambiguous decks countable — and they still failed to generate, because this module refused them
 * a second time from the same layout the SQL had stopped refusing. Both sides resolve the same
 * card, so both sides must read the same tie-breaker.
 *
 * Optional, because it is null on every unambiguous template and always will be.
 */
export type QuizAnswerTemplate = CardAnswerTemplate & {
  readonly quiz_answer_key?: string | null
}

export interface QuizCardFaces {
  /** Text fields shown as the question. At least one, or the card is unresolvable. */
  readonly promptKeys: readonly string[]
  /** The single field a learner's answer is graded against. */
  readonly answerKey: string
  /**
   * The remaining back-of-card text fields — a hint, a pronunciation, an example.
   *
   * Passed to a grader as context so it can tell a near-miss from a wrong answer, and never
   * required of the learner. Nothing here can lower a score, because nothing here was asked for.
   */
  readonly contextKeys: readonly string[]
}

interface Candidate {
  readonly key: string
  readonly style: string
}

/**
 * Layout entries naming a non-empty `text` value on this card, in layout order, de-duplicated.
 *
 * Non-text entries are skipped rather than fatal. That is the one intentional difference from
 * `resolveCardAnswerFaces`, which nulls the whole card when any reference field is non-text —
 * correct there, because its reference is the entire back. Here the reference is a single field,
 * so an audio clip sitting beside it changes nothing about what the learner must produce.
 */
function presentTextEntries(
  layout: readonly { field_key: string; style: string }[] | null | undefined,
  fieldValues: Record<string, string>,
  typeByKey: ReadonlyMap<string, string>,
): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const item of layout ?? []) {
    if (seen.has(item.field_key)) continue
    if (typeByKey.get(item.field_key) !== 'text') continue
    const value = fieldValues[item.field_key]
    if (typeof value !== 'string' || value.trim() === '') continue
    seen.add(item.field_key)
    out.push({ key: item.field_key, style: item.style })
  }
  return out
}

/**
 * The back-layout text fields a template DECLARES, whether or not this card fills them in.
 *
 * Deliberately not `presentTextEntries`: what the author meant cannot depend on which values one
 * card happens to have. See the comment at the call site for what reading presence instead did.
 */
function declaredTextKeys(template: QuizAnswerTemplate): Candidate[] {
  const typeByKey = new Map((template.fields ?? []).map((field) => [field.key, field.type]))
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const item of template.back_layout ?? []) {
    if (seen.has(item.field_key)) continue
    if (typeByKey.get(item.field_key) !== 'text') continue
    seen.add(item.field_key)
    out.push({ key: item.field_key, style: item.style })
  }
  return out
}

/**
 * Which field a quiz grades: the template's own decision first, this card's contents last.
 *
 * `candidates` is what this card actually has — present, non-empty, text — and the answer must be
 * one of them. The order below is the whole point:
 *
 *   1. ONE declared primary. The author said so, and their mark outranks everything, including a
 *      model's later reading of their labels. Blank on this card means the answer is missing, not
 *      that some other field is now the answer.
 *   2. No primary and one text field on the back. The answer by elimination, and again a
 *      statement about the TEMPLATE, so a blank refuses rather than promoting a neighbour.
 *   3. The stored key (219), written once by a model that read the author's field labels for a
 *      back it could not otherwise disambiguate. Terminal for the same reason as 1: it is a
 *      decision, so a card missing that field has no answer.
 *   4. Only for a still-ambiguous, never-resolved template: narrow by what this card HAS.
 *
 * Rules 1 and 2 used to be applied to the card rather than the template, and that is how an empty
 * answer promoted whatever sat beside it — back [뜻 primary, 발음 hint] with a blank 뜻 graded the
 * learner against a pronunciation, and the 영작 오답노트 shape, back [틀린 표현 primary, 맞는 표현
 * primary], graded them against their OWN MISTAKE on exactly the cards where the right answer was
 * missing. Both silent.
 *
 * Rule 4 is that same narrowing, kept because on a genuinely ambiguous template it is all there
 * is, and because it is how 429/429 cards of 착 붙는 중국어 are quizzable today: its back declares
 * two primaries and the second is empty on every card, so presence resolves it correctly. Refusing
 * the deck outright to close a hazard it does not have would be the worse trade. Once a model has
 * stored a key, rule 3 fires first and this stops being reachable.
 */
function resolveAnswerKey(
  template: QuizAnswerTemplate,
  candidates: readonly Candidate[],
): string | null {
  const present = (key: string | null | undefined) =>
    candidates.find((c) => c.key === key)?.key ?? null

  const declared = declaredTextKeys(template)
  const declaredPrimaries = declared.filter((entry) => entry.style === 'primary')
  if (declaredPrimaries.length === 1) return present(declaredPrimaries[0].key)
  if (declaredPrimaries.length === 0 && declared.length === 1) return present(declared[0].key)
  if (template.quiz_answer_key) return present(template.quiz_answer_key)

  const primaries = candidates.filter((c) => c.style === 'primary')
  if (primaries.length === 1) return primaries[0].key
  if (primaries.length === 0 && candidates.length === 1) return candidates[0].key
  return null
}

/**
 * The prompt, the graded answer, and the context of a card — or `null` when the card cannot be
 * quizzed. Every `null` below is a case where guessing would produce a confidently wrong quiz:
 *
 *   - no template, or no text field on the front: there is nothing to ask;
 *   - no text field on the back: there is nothing to grade;
 *   - two or more fields marked `primary`: the author declared two answers, and picking one
 *     would grade against a field they did not mean;
 *   - no `primary` and more than one candidate: undeclared, and layout order is not a
 *     declaration — the same positional guess `card-answer.ts` exists to refuse;
 *   - the answer field also appears on the front: the learner would be shown what to produce.
 *
 * A single candidate with no `primary` IS accepted. That is not a guess: there is exactly one
 * text field on the back, so it is the answer by elimination.
 *
 * The two ambiguous cases are no longer permanently fatal. `template.quiz_answer_key` — written
 * once by a model that read the author's own field labels, service-role only — resolves them, and
 * it is checked against the candidates found on THIS card, so a key left behind by a template
 * edit names a field that is gone and the card goes back to being refused.
 */
export function resolveQuizCardFaces(
  template: QuizAnswerTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): QuizCardFaces | null {
  if (!template) return null
  const fieldValues = card.field_values ?? {}
  const typeByKey = new Map((template.fields ?? []).map((field) => [field.key, field.type]))

  const promptEntries = presentTextEntries(template.front_layout, fieldValues, typeByKey)
  if (promptEntries.length === 0) return null

  const candidates = presentTextEntries(template.back_layout, fieldValues, typeByKey)
  if (candidates.length === 0) return null

  const answerKey = resolveAnswerKey(template, candidates)
  if (!answerKey) return null

  // Only the PRIMARY front field becomes the question. Everything else on the front is
  // context the learner is allowed to see, not part of what is being asked.
  //
  // This joined the whole front with ' / ', which on the official bilingual template —
  // front_layout [front/primary, situation/hint] — produced questions reading
  //
  //     "너 그 드라마 봤어? 완전 빠졌어 / 드라마 추천"
  //
  // The trailing fragment is a HINT field. Putting it in the stem both reads like a bug and
  // hands over the category for free. A front with no primary keeps the old behaviour: with
  // nothing declared, every field is equally the question.
  const primaryPrompts = promptEntries.filter((entry) => entry.style === 'primary')
  const stemEntries = primaryPrompts.length > 0 ? primaryPrompts : promptEntries
  const promptKeys = stemEntries.map((entry) => entry.key)
  // The answer must not appear anywhere on the front, not merely in the stem — a hint field
  // showing the answer gives it away just as completely.
  if (promptEntries.some((entry) => entry.key === answerKey)) return null

  return {
    promptKeys,
    answerKey,
    contextKeys: candidates.filter((c) => c.key !== answerKey).map((c) => c.key),
  }
}

/** The graded answer text itself, or `null` when the card cannot be quizzed. */
export function quizReferenceAnswer(
  template: QuizAnswerTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): string | null {
  const faces = resolveQuizCardFaces(template, card)
  if (!faces) return null
  const text = card.field_values[faces.answerKey].trim()
  return text === '' ? null : text
}

/** The prompt text a question is written from, joined in layout order. Never includes the answer. */
export function quizPromptText(
  template: QuizAnswerTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): string | null {
  const faces = resolveQuizCardFaces(template, card)
  if (!faces) return null
  const text = faces.promptKeys.map((key) => card.field_values[key].trim()).join(' / ')
  return text === '' ? null : text
}

/** The context lines handed to a grader, in layout order. Empty array when there are none. */
export function quizContextLines(
  template: QuizAnswerTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): string[] {
  const faces = resolveQuizCardFaces(template, card)
  if (!faces) return []
  return faces.contextKeys.map((key) => card.field_values[key].trim()).filter((v) => v !== '')
}

/**
 * The context fields with the names their template gave them.
 *
 * `quizContextLines` returns values only, which is enough for a grader but not for a question:
 * a `field_probe` built from an unnamed field asks "what is the context0 of lend?". The template
 * already names every field, so the name travels with the value.
 */
export function quizContextFields(
  template: QuizAnswerTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): Array<{ key: string; label: string; value: string }> {
  const faces = resolveQuizCardFaces(template, card)
  if (!faces || !template) return []
  const nameByKey = new Map((template.fields ?? []).map((field) => [field.key, field.name]))
  return faces.contextKeys
    .map((key) => ({ key, label: nameByKey.get(key) ?? key, value: card.field_values[key].trim() }))
    .filter((entry) => entry.value !== '')
}

/**
 * The same card, resolved for a model that can read the whole back.
 *
 * `resolveQuizCardFaces` refuses a card whose answer is ambiguous — two fields marked primary,
 * or none marked and several to choose from — and refusing was right when a deterministic rule
 * had to pick. It is why four of the five decks on the reporting account could not make a quiz
 * at all: 342 of 771 cards, every one of them refused for a declaration the author made twice
 * rather than for anything wrong with the card.
 *
 * The rule was picking blind. A model is not: it sees the field LABELS the author wrote and the
 * values, so on a template whose back is [틀린 표현, 맞는 표현] it can tell which one a learner
 * is supposed to produce — and getting that backwards is exactly the failure a positional guess
 * would have shipped.
 *
 * So this refuses much less: a front with text, a back with text, and an answer that is not
 * already on the front. When exactly one candidate is declared, `answerKey` is set and the
 * caller needs no model. When several are, `answerKey` is null and `candidates` is what the
 * model chooses from — and the choice is bounded to fields that exist, so the worst case is the
 * wrong field rather than an invented answer.
 */
export interface QuizCardCandidates {
  readonly promptKeys: readonly string[]
  /** Set when the template declares one unambiguously; null when the model must choose. */
  readonly answerKey: string | null
  /** Every back text field with a value, in layout order. Never empty. */
  readonly candidates: ReadonlyArray<{ key: string; label: string; value: string }>
}

export function resolveQuizCardCandidates(
  template: QuizAnswerTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): QuizCardCandidates | null {
  if (!template) return null
  const fieldValues = card.field_values ?? {}
  const typeByKey = new Map((template.fields ?? []).map((field) => [field.key, field.type]))
  const nameByKey = new Map((template.fields ?? []).map((field) => [field.key, field.name]))

  const promptEntries = presentTextEntries(template.front_layout, fieldValues, typeByKey)
  if (promptEntries.length === 0) return null

  const backEntries = presentTextEntries(template.back_layout, fieldValues, typeByKey)
  if (backEntries.length === 0) return null

  // Anything also on the front is not a candidate — showing the learner what to produce is the
  // one failure that makes a question worthless rather than merely imperfect.
  const frontKeys = new Set(promptEntries.map((entry) => entry.key))
  const usable = backEntries.filter((entry) => !frontKeys.has(entry.key))
  if (usable.length === 0) return null

  // Same precedence as the strict resolver, over the candidates that are not already on the
  // front. A stored key resolving here is what stops the caller paying a model for the same
  // choice on every generation.
  const primaries = usable.filter((entry) => entry.style === 'primary')
  const answerKey = resolveAnswerKey(template, usable)

  const primaryPrompts = promptEntries.filter((entry) => entry.style === 'primary')
  const stemEntries = primaryPrompts.length > 0 ? primaryPrompts : promptEntries

  return {
    promptKeys: stemEntries.map((entry) => entry.key),
    answerKey,
    // When the author declared primaries, only those are offered — they narrowed it, and
    // widening past their declaration would ignore the one signal they did give.
    candidates: (primaries.length > 0 ? primaries : usable).map((entry) => ({
      key: entry.key,
      label: nameByKey.get(entry.key) ?? entry.key,
      value: fieldValues[entry.key].trim(),
    })),
  }
}
