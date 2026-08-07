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
 */
export function resolveQuizCardFaces(
  template: CardAnswerTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): QuizCardFaces | null {
  if (!template) return null
  const fieldValues = card.field_values ?? {}
  const typeByKey = new Map((template.fields ?? []).map((field) => [field.key, field.type]))

  const promptEntries = presentTextEntries(template.front_layout, fieldValues, typeByKey)
  if (promptEntries.length === 0) return null

  const candidates = presentTextEntries(template.back_layout, fieldValues, typeByKey)
  if (candidates.length === 0) return null

  const primaries = candidates.filter((c) => c.style === 'primary')
  let answerKey: string
  if (primaries.length === 1) answerKey = primaries[0].key
  else if (primaries.length === 0 && candidates.length === 1) answerKey = candidates[0].key
  else return null

  const promptKeys = promptEntries.map((entry) => entry.key)
  if (promptKeys.includes(answerKey)) return null

  return {
    promptKeys,
    answerKey,
    contextKeys: candidates.filter((c) => c.key !== answerKey).map((c) => c.key),
  }
}

/** The graded answer text itself, or `null` when the card cannot be quizzed. */
export function quizReferenceAnswer(
  template: CardAnswerTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): string | null {
  const faces = resolveQuizCardFaces(template, card)
  if (!faces) return null
  const text = card.field_values[faces.answerKey].trim()
  return text === '' ? null : text
}

/** The prompt text a question is written from, joined in layout order. Never includes the answer. */
export function quizPromptText(
  template: CardAnswerTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): string | null {
  const faces = resolveQuizCardFaces(template, card)
  if (!faces) return null
  const text = faces.promptKeys.map((key) => card.field_values[key].trim()).join(' / ')
  return text === '' ? null : text
}

/** The context lines handed to a grader, in layout order. Empty array when there are none. */
export function quizContextLines(
  template: CardAnswerTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): string[] {
  const faces = resolveQuizCardFaces(template, card)
  if (!faces) return []
  return faces.contextKeys.map((key) => card.field_values[key].trim()).filter((v) => v !== '')
}
